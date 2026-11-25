import assert from 'node:assert/strict';
import http, { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import events, { getEventListeners } from 'node:events';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, SignJWT } from 'jose';
import { Then } from '@cucumber/cucumber';
import { hostAccountSession, type Registration } from '../../src/sbx-account.js';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
Then(
  'the host subscription fixture completes {string} with {string}',
  async function (kind: string, outcome: string) {
    const issuer = 'https://auth.openai.com',
      client = 'oaiapp_fixture',
      model = 'gpt-6.2-astra';
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keys = createLocalJWKSet({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture' }] });
    let clock = Date.now(),
      nonce = '',
      redirect = '',
      challenge = '',
      catalogues = 0,
      posts = 0,
      callback: Promise<void> | undefined,
      callbackFailure: unknown;
    const saved: Registration[] = [];
    const savedGrants: SavedGrant[] = [];
    const keyRequests: AbortSignal[] = [];
    const isNew = ['new registration', 'missing callback client', 'cancelled catalogue'].includes(kind);
    const session = hostAccountSession(
      {
        hostId: 'urn:uuid:00000000-0000-4000-8000-000000000000',
        previous: isNew ? undefined : { issuer, client_id: client, accountHash: sha('person') },
        registered: (r) => saved.push(r),
        consentPage: (origin) => {
          callback = (async () => {
            const page = await fetch(origin, { redirect: 'manual' });
            assert.equal(page.status, 303);
            const auth = new URL(page.headers.get('location')!);
            assert.equal(auth.origin, issuer);
            const p = auth.searchParams;
            assert.equal(p.get('client_id'), isNew ? 'dynamic_agent_client' : client);
            assert.equal(auth.pathname, '/api/accounts/authorize');
            assert.equal(p.get('ext_agent_host_id'), 'urn:uuid:00000000-0000-4000-8000-000000000000');
            assert.equal(p.get('agent_name_hint'), isNew ? 'Architect OS' : null);
            assert.equal(p.get('response_type'), 'code');
            assert.equal(p.get('id_token_hint'), kind === 'reauthorization' ? 'fixture-prior-id' : null);
            assert.equal(p.get('resource'), 'https://api.openai.com/v1');
            assert.deepEqual(p.get('scope')?.split(' '), [
              'openid',
              'profile',
              'email',
              'offline_access',
              'resource.invoke',
              'chatgpt.tokens.use.direct',
            ]);
            assert.equal(page.headers.get('cache-control'), 'no-store');
            assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
            assert.equal(
              page.headers.get('content-security-policy'),
              "default-src 'none'; frame-ancestors 'none'",
            );
            assert.equal(page.headers.get('location')?.includes('access_token='), false);
            nonce = p.get('nonce')!;
            assert.ok(nonce && p.get('state') && nonce !== p.get('state'));
            challenge = p.get('code_challenge')!;
            assert.equal(p.get('code_challenge_method'), 'S256');
            const url = new URL(p.get('redirect_uri')!);
            redirect = url.href;
            url.search = new URLSearchParams({
              code: 'fixture-code',
              state: p.get('state')!,
              client_id: client,
            }).toString();
            if (
              [
                'refused callback',
                'substituted client',
                'duplicate code',
                'missing callback client',
              ].includes(kind)
            ) {
              if (kind === 'missing callback client') url.searchParams.delete('client_id');
              if (kind === 'refused callback') url.searchParams.set('error', 'access_denied');
              if (kind === 'substituted client') url.searchParams.set('client_id', 'oaiapp_different');
              if (kind === 'duplicate code') url.searchParams.append('code', 'another');
              const denied = await fetch(url);
              assert.equal(denied.status, 403);
              assert.equal(await denied.text(), 'Authorization refused');
              return;
            }
            if (kind === 'returning') {
              assert.equal((await fetch(origin + 'unrelated')).status, 404);
              const rawStatus = (path: string, host: string) =>
                new Promise<number | undefined>((done, fail) => {
                  const req = httpRequest(
                    { hostname: '127.0.0.1', port: new URL(origin).port, path, headers: { host } },
                    (r) => {
                      r.resume();
                      done(r.statusCode);
                    },
                  );
                  req.on('error', fail);
                  req.end();
                });
              assert.equal(await rawStatus('/', 'alternate'), 400);
              assert.equal(await rawStatus('http://[', new URL(origin).host), 400);
              assert.equal(await rawStatus('http://example.invalid/path', new URL(origin).host), 400);
              assert.equal((await fetch(url, { method: 'POST' })).status, 400);
              url.searchParams.delete('client_id');
            }
            if (kind === 'foreign state' || kind === 'missing state') {
              url.searchParams.set('state', 'other');
              if (kind === 'missing state') url.searchParams.delete('state');
              assert.equal((await fetch(url)).status, 400);
              session.close();
              return;
            }
            const accepted = await fetch(url);
            assert.equal(accepted.status, 200);
            assert.equal(await accepted.text(), 'Callback received. You can close this tab.');
          })().catch((e) => {
            callbackFailure = e;
            session.close();
          });
        },
      },
      model,
      async (url, init) => {
        if (url === issuer + '/.well-known/jwks.json') {
          assert.equal(init?.method, 'GET');
          assert.equal(init?.redirect, 'manual');
          assert.ok(init?.signal);
          keyRequests.push(init.signal);
          return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture' }] });
        }
        if (url === issuer + '/api/accounts/oauth/token') {
          posts++;
          const form = init!.body as URLSearchParams;
          assert.equal(form.get('client_id'), client);
          assert.equal(init!.method, 'POST');
          assert.equal(init!.redirect, 'error');
          assert.equal(init!.cache, 'no-store');
          assert.equal(form.get('resource'), 'https://api.openai.com/v1');
          if (kind === 'unavailable issuer') return new Response(null, { status: 503 });
          if (kind === 'invalid JSON') return new Response('{');
          if (kind === 'large response') return new Response(' '.repeat(1048577));
          if (posts === 1) {
            assert.equal(form.get('grant_type'), 'authorization_code');
            assert.equal(form.get('code'), 'fixture-code');
            assert.equal(form.get('redirect_uri'), redirect);
            assert.equal(
              createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),
              challenge,
            );
          } else {
            assert.equal(form.get('refresh_token'), 'fixture-' + (posts - 1));
            assert.equal(form.get('grant_type'), 'refresh_token');
            assert.equal(form.has('scope'), false);
          }
          const signature = new SignJWT({
            nonce:
              posts === 2 && kind === 'renewal with omitted claims'
                ? undefined
                : kind === 'wrong nonce' || (posts === 2 && kind === 'rotated nonce')
                  ? 'foreign'
                  : nonce,
            azp: kind === 'foreign azp' ? 'foreign' : client,
            auth_time:
              posts === 2 && kind === 'renewal with omitted claims'
                ? undefined
                : kind === 'invalid auth time'
                  ? 'invalid'
                  : kind === 'changed auth time' && posts === 2
                    ? 2
                    : 1,
          })
            .setIssuer(kind === 'wrong issuer' ? 'foreign' : issuer)
            .setAudience(
              kind === 'wrong audience'
                ? 'foreign'
                : kind === 'extra audience'
                  ? [client, 'extra']
                  : kind === 'single audience'
                    ? [client]
                    : client,
            )
            .setSubject(
              kind === 'wrong subject' || (posts === 2 && kind === 'rotated subject') ? 'other' : 'person',
            )
            .setIssuedAt(
              Math.floor(clock / 1000) -
                (posts === 2 ? (kind === 'old identity' ? 10 : kind === 'same issue time' ? 1 : 0) : 0),
            )
            .setProtectedHeader({ alg: 'RS256', kid: 'fixture' });
          if (kind !== 'missing expiry') signature.setExpirationTime(Math.floor(clock / 1000) + 30);
          const jwt = await signature.sign(privateKey);
          const segments = jwt.split('.');
          if (kind === 'invalid signature')
            segments[2] = (segments[2]![0] === 'a' ? 'b' : 'a') + segments[2]!.slice(1);
          const tokenReply = {
            token_type:
              kind === 'invalid token type prefix'
                ? 'Bbearer'
                : kind === 'invalid token type suffix'
                  ? 'bearer1'
                  : 'bearer',
            access_token:
              kind === 'invalid bearer prefix'
                ? '!access'
                : kind === 'invalid bearer suffix'
                  ? 'access!'
                  : 'access-' + posts,
            refresh_token: 'fixture-' + (kind === 'reused refresh' ? 1 : posts),
            expires_in: kind === 'unsafe expiry' ? Number.MAX_SAFE_INTEGER : 1,
            ...(posts === 1
              ? {
                  scope:
                    kind === 'no initial scope'
                      ? undefined
                      : kind === 'absent scope'
                        ? 'openid'
                        : kind === 'partial grant'
                          ? 'offline_access'
                          : kind === 'lost scope'
                            ? 'profile offline_access resource.invoke chatgpt.tokens.use.direct'
                            : 'offline_access resource.invoke chatgpt.tokens.use.direct',
                }
              : kind === 'lost scope'
                ? { scope: 'email offline_access resource.invoke chatgpt.tokens.use.direct' }
                : kind === 'expanded scope'
                  ? { scope: 'offline_access resource.invoke chatgpt.tokens.use.direct profile' }
                  : {}),
            id_token:
              kind === 'no identity' || (kind === 'renewal without ID token' && posts === 2)
                ? undefined
                : segments.join('.'),
          };
          const text = JSON.stringify(tokenReply);
          if (kind === 'body boundary') return new Response(text.padEnd(1048576, ' '));
          if (kind === 'oversized valid grant') return new Response(text.padEnd(1048577, ' '));
          if (kind === 'invalid UTF8 grant')
            return new Response(
              Buffer.concat([
                Buffer.from(text.slice(0, -1) + ',"extra":"'),
                Buffer.from([255]),
                Buffer.from('"}'),
              ]),
            );
          if (kind === 'HTTP failure with grant') return Response.json(tokenReply, { status: 500 });
          return Response.json(tokenReply);
        }
        assert.equal(url, 'https://api.openai.com/v1/models');
        catalogues++;
        assert.equal(init?.method, 'GET');
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.cache, 'no-store');
        assert.deepEqual(init?.headers, { authorization: 'Bearer access-' + posts });
        if (kind === 'cancelled catalogue') session.close();
        return Response.json({
          models: [
            null,
            { slug: 'other', visibility: 'list' },
            {
              slug: kind === 'other model' ? 'other' : model,
              visibility: kind === 'hidden model' ? 'hidden' : 'list',
            },
          ],
        });
      },
      kind === 'returning' ? undefined : keys,
      () => clock,
      kind === 'reauthorization'
        ? {
            binding: { id: client, subject: sha('person'), iat: 1, nonce: 'prior' },
            access: 'fixture-prior',
            refresh: 'fixture-prior-refresh',
            idToken: 'fixture-prior-id',
            expires: 1,
            scope: 'offline_access resource.invoke chatgpt.tokens.use.direct',
          }
        : undefined,
      { saved: (g) => savedGrants.push(structuredClone(g)), revoked: () => assert.fail() },
    );
    const signal = AbortSignal.timeout(5000);
    try {
      const work = async () => {
        await session.signIn(signal);
        assert.equal(await session.access(signal), 'access-1');
        assert.equal(await session.access(signal), 'access-1');
        await assert.rejects(session.access(AbortSignal.abort()), { name: 'AbortError' });
        clock += 1000;
        if (kind === 'cancelled waiter') {
          const controller = new AbortController();
          const renewal = session.access(signal);
          const waiter = session.access(controller.signal);
          controller.abort();
          await assert.rejects(waiter, { name: 'AbortError' });
          assert.equal(await renewal, 'access-2');
          return;
        }
        assert.deepEqual(await Promise.all([session.access(signal), session.access(signal)]), [
          'access-2',
          'access-2',
        ]);
      };
      if (outcome === 'renewed') {
        await work();
        assert.equal(posts, 2);
        assert.equal(catalogues, 2);
        assert.deepEqual(
          savedGrants.map((g) => [g.access, g.verifiedModel]),
          [
            ['access-1', model],
            ['access-2', undefined],
            ['access-2', model],
          ],
        );
        if (kind === 'returning') {
          clock += 1000;
          assert.equal(await session.access(signal), 'access-3');
        }
        assert.deepEqual(
          saved,
          kind === 'new registration' ? [{ issuer, client_id: client, accountHash: sha('person') }] : [],
        );
      } else {
        const errors: Record<string, string> = {
          'foreign state': 'SBX_CONSENT_CANCELLED',
          'missing state': 'SBX_CONSENT_CANCELLED',
          'no initial scope': 'SBX_ACCOUNT_GRANT',
          'missing callback client': 'SBX_CONSENT_REFUSED',
          'refused callback': 'SBX_CONSENT_REFUSED',
          'substituted client': 'SBX_CONSENT_REFUSED',
          'duplicate code': 'SBX_CONSENT_REFUSED',
          'extra audience': 'SBX_ACCOUNT_IDENTITY',
          'foreign azp': 'SBX_ACCOUNT_IDENTITY',
          'invalid auth time': 'SBX_ACCOUNT_IDENTITY',
          'changed auth time': 'SBX_ACCOUNT_IDENTITY',
          'rotated nonce': 'SBX_ACCOUNT_IDENTITY',
          'old identity': 'SBX_ACCOUNT_IDENTITY',
          'no identity': 'SBX_ACCOUNT_IDENTITY',
          'wrong nonce': 'SBX_ACCOUNT_IDENTITY',
          'wrong subject': 'SBX_ACCOUNT_IDENTITY',
          'rotated subject': 'SBX_ACCOUNT_IDENTITY',
          'absent scope': 'SBX_ACCOUNT_GRANT',
          'reused refresh': 'SBX_ACCOUNT_GRANT',
          'expanded scope': 'SBX_ACCOUNT_GRANT',
          'unsafe expiry': 'SBX_ACCOUNT_GRANT',
          'other model': 'SBX_ACCOUNT_MODEL',
          'partial grant': 'SBX_ACCOUNT_GRANT',
          'lost scope': 'SBX_ACCOUNT_GRANT',
          'invalid UTF8 grant': 'SBX_ACCOUNT_BODY',
          'oversized valid grant': 'SBX_ACCOUNT_BODY',
          'HTTP failure with grant': 'SBX_ACCOUNT_TRANSPORT',
          'hidden model': 'SBX_ACCOUNT_MODEL',
          'large response': 'SBX_ACCOUNT_BODY',
          'invalid JSON': 'SBX_ACCOUNT_BODY',
          'unavailable issuer': 'SBX_ACCOUNT_TRANSPORT',
        };
        await assert.rejects(work(), { message: errors[kind] ?? 'SBX_ACCOUNT_UNAVAILABLE' });
        assert.equal(saved.length, 0);
        if (kind === 'wrong nonce') assert.equal(catalogues, 0);
        await assert.rejects(session.access(signal), { name: 'AbortError' });
      }
      await callback;
      if (callbackFailure) throw callbackFailure;
    } finally {
      session.close();
    }
    if (kind === 'returning') assert.ok(keyRequests.length > 0 && keyRequests.every((s) => s.aborted));
    await assert.rejects(session.access(signal), { name: 'AbortError' });
  },
);

import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  linkSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSbxStep, signInCommand } from '../../src/sbx-step.js';
import { PKG } from '../../src/code-tool.js';
import { measureSession } from '../../src/measure.js';
Then(
  'the SBX Step host uses {string} and opens the fixture account {int} times',
  async function (kind: string, expected: number) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sbx-host-'))),
      work = join(root, 'work'),
      reg = {
        issuer: 'https://auth.openai.com' as const,
        client_id: 'oaiapp_fixture',
        accountHash: 'b'.repeat(64),
      };
    const state = join(root, 'state/sbx'),
      snapshot = join(root, 'snapshot'),
      limits = join(state, 'limits.json');
    const settings = { requests: 2, tokens: 7, bytes: 4096 },
      model = 'gpt-6.2-astra' as const;
    const preset = 'urn:uuid:fdc4017f-80d8-482b-a4a8-ca52699a2b13';
    let sessions = 0,
      closed = 0,
      launched = 0,
      notice = '';
    const receipt = { model, request: 1, terminal: 'completed' as const, inputTokens: 4, outputTokens: 3 };
    const result = {
      provider: 'openai' as const,
      client: { version: 'fixture', sha256: 'c'.repeat(64) },
      receipts: [receipt],
      exitCode: 0,
      stopped: false,
      measure: measureSession(''),
    };
    const spies: { mock: { restore(): void } }[] = [];
    try {
      for (const path of [state, join(snapshot, 'sbx'), join(snapshot, 'profiles'), work])
        mkdirSync(path, { recursive: true, mode: 0o700 });
      const builderProfile = JSON.parse(readFileSync(join(PKG, 'profiles/builder.json'), 'utf8'));
      if (kind === 'no registry') builderProfile.srt.network.allowedDomains.pop();
      if (kind === 'reordered registry') builderProfile.srt.network.allowedDomains.reverse();
      if (kind === 'missing proxy') builderProfile.srt.network.allowedDomains.shift();
      if (kind === 'conflicting deny') builderProfile.srt.network.deniedDomains.push('registry.npmjs.org');
      if (kind === 'unrecognized route') builderProfile.srt.network.allowedDomains.push('example.com');
      writeFileSync(join(snapshot, 'profiles/builder.json'), JSON.stringify(builderProfile), { mode: 0o400 });
      const pin = JSON.parse(readFileSync(join(PKG, 'sbx/isolation.json'), 'utf8'));
      writeFileSync(join(snapshot, 'sbx/isolation.json'), JSON.stringify(kind === 'broken pin' ? {} : pin), {
        mode: 0o400,
      });
      if (kind !== 'new installation')
        writeFileSync(
          join(state, 'host-id'),
          kind === 'invalid host prefix'
            ? '!' + preset
            : kind === 'invalid host suffix'
              ? preset + '!'
              : kind === 'padded host'
                ? preset + '\n'
                : kind === 'invalid host id'
                  ? 'invalid'
                  : preset,
          {
            mode: 0o600,
          },
        );
      if (kind === 'existing registration' || kind === 'invalid registration')
        writeFileSync(
          join(state, 'registration.json'),
          kind === 'invalid registration' ? '' : JSON.stringify(reg),
          { mode: 0o600 },
        );
      if (kind === 'public registration')
        writeFileSync(join(state, 'registration.json'), JSON.stringify(reg), { mode: 0o644 });
      if (kind === 'public registration') chmodSync(join(state, 'registration.json'), 0o644);
      if (kind.startsWith('invalid stored ')) {
        const r = { ...reg };
        if (kind.includes('client'))
          r.client_id = kind.endsWith('prefix') ? '!' + r.client_id : r.client_id + '!';
        else r.accountHash = kind.endsWith('prefix') ? '!' + r.accountHash : r.accountHash + '!';
        writeFileSync(join(state, 'registration.json'), JSON.stringify(r), { mode: 0o600 });
      }
      if (kind === 'linked limits') symlinkSync(join(state, 'host-id'), limits);
      else if (kind !== 'missing limits')
        writeFileSync(
          limits,
          kind === 'large limits'
            ? ' '.repeat(1048577)
            : kind === 'invalid limits'
              ? 'invalid-payload-marker'
              : JSON.stringify({ ...settings, tokens: kind === 'zero tokens' ? 0 : 7 }),
          { mode: 0o600 },
        );
      if (kind === 'hardlinked limits') linkSync(limits, join(root, 'other'));
      if (kind === 'public limits') chmodSync(limits, 0o644);
      const request = {
        config: { provider: 'openai' as const, model, effort: 'medium' as const, limitSeconds: 30 },
        worktree: work,
        systemPrompt: 'p',
        brief: 'b',
        maxBytes: 65536,
        onOutput: () => {},
      };
      const published: string[] = [];
      const write = mock.method(fs, 'writeFileSync');
      spies.push(write);
      if (kind === 'failed publication') {
        const link = mock.method(fs, 'linkSync', () => {
          throw Object.assign(Error('publication refused'), { code: 'EACCES' });
        });
        spies.push(link);
      }
      syncBuiltinESMExports();
      const run = () =>
        buildSbxStep(
          request,
          snapshot,
          kind === 'writable launcher' ? work : kind === 'sibling launcher' ? snapshot : root,
          root,
          (host, which) => {
            sessions++;
            assert.equal(which, model);
            if (kind === 'new installation') assert.match(host.hostId, /^urn:uuid:[0-9a-f-]{36}$/);
            else assert.equal(host.hostId, preset);
            assert.equal(host.hostId, readFileSync(join(state, 'host-id'), 'utf8').trim());
            assert.equal(statSync(join(state, 'host-id')).mode & 0o777, 0o600);
            assert.deepEqual(host.previous, kind === 'existing registration' ? reg : undefined);
            return {
              access: async () => {
                if (kind === 'temporary account transport') throw Error('SBX_ACCOUNT_TRANSPORT');
                if (kind === 'non-error refusal') throw { message: 'SBX_SIGN_IN_REQUIRED' };
                if (kind === 'sign-in required') throw Error('SBX_SIGN_IN_REQUIRED');
                if (kind.startsWith('concurrent'))
                  writeFileSync(
                    join(state, 'registration.json'),
                    JSON.stringify({
                      ...reg,
                      ...(kind.endsWith('client')
                        ? { client_id: 'oaiapp_other' }
                        : { accountHash: 'a'.repeat(64) }),
                    }),
                    { mode: 0o600 },
                  );
                assert.equal(host.consentPage, undefined);
                if (!host.previous) host.registered(reg);
                return 'test';
              },
              close: () => {
                closed++;
              },
            };
          },
          kind === 'default builder'
            ? undefined
            : (settings) => ({
                build: async (received) => {
                  launched++;
                  assert.equal(received, request);
                  assert.deepEqual(settings.policy, pin);
                  assert.equal(settings.allowRegistry, kind !== 'no registry');
                  assert.deepEqual(settings.budget, { requests: 2, tokens: 7, bytes: 4096 });
                  assert.equal(settings.archive, join(root, 'cache/sbx', pin.archive));
                  assert.equal(settings.guestSource, join(snapshot, 'sbx/codex-guest.py'));
                  if (['temporary account transport', 'non-error refusal'].includes(kind)) {
                    await assert.rejects(settings.access(new AbortController().signal));
                    return result;
                  }
                  if (kind === 'sign-in required')
                    await assert.rejects(settings.access(new AbortController().signal), {
                      message: 'SBX_SIGN_IN_REQUIRED',
                    });
                  else assert.equal(await settings.access(new AbortController().signal), 'test');
                  if (kind === 'refused builder') throw Error('FIXTURE_BUILD');
                  settings.record(receipt);
                  return result;
                },
              }),
        );
      if (
        [
          'new installation',
          'existing registration',
          'sibling launcher',
          'padded host',
          'no registry',
          'reordered registry',
        ].includes(kind)
      ) {
        assert.equal(await run(), result);
        assert.deepEqual(JSON.parse(readFileSync(join(state, 'registration.json'), 'utf8')), reg);
        assert.equal(readFileSync(join(state, 'usage.jsonl'), 'utf8'), JSON.stringify(receipt) + '\n');
      } else if (kind.startsWith('concurrent'))
        await assert.rejects(run(), { message: 'SBX_ACCOUNT_CHANGED' });
      else if (['temporary account transport', 'non-error refusal'].includes(kind))
        assert.equal(await run(), result);
      else if (kind === 'sign-in required') await assert.rejects(run(), { message: 'SBX_SIGN_IN_REQUIRED' });
      else if (kind === 'refused builder') await assert.rejects(run(), { message: 'FIXTURE_BUILD' });
      else if (kind === 'default builder') await assert.rejects(run(), { code: 'ENOENT' });
      else if (kind === 'failed publication') await assert.rejects(run(), { code: 'EACCES' });
      else if (kind === 'public registration' || kind === 'public limits')
        await assert.rejects(run(), { message: 'SBX_HOST_SETTING' });
      else if (kind === 'writable launcher')
        await assert.rejects(run(), { message: 'SBX_SEPARATE_LAUNCHER_REQUIRED' });
      else if (kind === 'invalid limits' || kind === 'invalid registration')
        await assert.rejects(run(), { message: 'SBX_INVALID_SETTING' });
      else await assert.rejects(run());
      for (const call of write.mock.calls) {
        const [file, , options] = call.arguments;
        if (
          typeof file !== 'string' ||
          !file.startsWith(state + '/') ||
          file === join(state, 'registration.json')
        )
          continue;
        assert.match(file, /\/(host-id|registration\.json)\.[a-f0-9-]{36}$/);
        assert.deepEqual(options, { mode: 0o600, flag: 'wx' });
        assert.ok(!fs.existsSync(file));
        published.push(file);
      }
      if (kind === 'new installation') assert.equal(published.length, 2);
      if (kind === 'existing registration') assert.equal(published.length, 0);
      assert.deepEqual(
        [sessions, closed, launched],
        [expected, expected, kind === 'default builder' ? 0 : expected],
      );
    } finally {
      for (const spy of spies) spy.mock.restore();
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

Then(
  'the consent listener releases its bind, callbacks and connections after {string}',
  async function (kind: string) {
    const server = new http.Server();
    const create = mock.method(
      http,
      'createServer',
      (listener: (req: IncomingMessage, res: ServerResponse) => void) => server.on('request', listener),
    );
    const wait = mock.method(events, 'once');
    syncBuiltinESMExports();
    const listen = mock.method(server, 'listen', (port: number, host: string) => {
      assert.deepEqual([port, host], [0, '127.0.0.1']);
      queueMicrotask(() => server.emit('listening'));
      return server;
    });
    const address = mock.method(server, 'address', () => ({
      port: 1234,
      family: 'IPv4',
      address: kind === 'foreign bind' ? '0.0.0.0' : '127.0.0.1',
    }));
    const close = mock.method(server, 'close', () => server);
    const connections = mock.method(server, 'closeAllConnections', () => {});
    let notices = 0;
    function request(path: string) {
      let status = 200,
        location = '';
      const response = {
        setHeader() {},
        writeHead(code: number, headers?: { location?: string }) {
          status = code;
          location = headers?.location ?? '';
          return this;
        },
        end() {},
      };
      server.emit('request', { method: 'GET', url: path, headers: { host: '127.0.0.1:1234' } }, response);
      return { status, location };
    }
    const session = hostAccountSession(
      {
        hostId: 'fixture',
        registered: () => assert.fail(),
        consentPage: () => {
          notices++;
          const auth = new URL(request('/').location);
          const params = new URLSearchParams({
            state: auth.searchParams.get('state')!,
            code: 'code',
            client_id: 'oaiapp_fixture',
          });
          const path = '/auth/callback?' + params;
          assert.equal(request(path).status, 200);
          assert.equal(request(path).status, 400);
        },
      },
      'gpt-6.2-astra',
      async () => {
        const signal = wait.mock.calls.find((c) => Object.is(c.arguments[0], server))?.arguments[2]?.signal;
        assert.ok(signal);
        assert.equal(getEventListeners(signal, 'abort').length, 0);
        return new Response(null, { status: 503 });
      },
    );
    try {
      await assert.rejects(session.signIn(new AbortController().signal), {
        message: kind === 'foreign bind' ? 'SBX_CALLBACK' : 'SBX_ACCOUNT_TRANSPORT',
      });
      assert.equal(notices, kind === 'foreign bind' ? 0 : 1);
      assert.deepEqual(
        [listen, address, close, connections].map((f) => f.mock.callCount()),
        [1, 1, 1, 1],
      );
      const bindSignal = wait.mock.calls.find((c) => Object.is(c.arguments[0], server))?.arguments[2]?.signal;
      assert.ok(bindSignal);
      assert.equal(getEventListeners(bindSignal, 'abort').length, 0);
    } finally {
      session.close();
      for (const spy of [create, wait, listen, address, close, connections]) spy.mock.restore();
      syncBuiltinESMExports();
    }
  },
);

import { keychainEntry, storedAccount } from '../../src/sbx-keychain.js';
import { savedGrantSchema, type SavedGrant } from '../../src/sbx-account.js';

Then(
  'the host credential store handles {string} without a consent or token disclosure',
  async function (kind: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rotation-')));
    const reg = {
      issuer: 'https://auth.openai.com' as const,
      client_id: 'oaiapp_fixture',
      accountHash: sha('fixture'),
    };
    const host = {
      hostId: 'fixture',
      previous: reg,
      registered: () => assert.fail(),
      consentPage: () => assert.fail('interactive Step'),
    };
    const initial: SavedGrant = {
      binding: { id: reg.client_id, subject: reg.accountHash, iat: 1, nonce: 'n' },
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      idToken: 'fixture-id',
      expires: 1,
      scope: 'offline_access resource.invoke chatgpt.tokens.use.direct',
      verifiedModel: 'gpt-6.2-astra',
    };
    initial.binding.nonce = 'fixture-nonce';
    if (kind === 'unregistered identity') delete (host as Partial<typeof host>).previous;
    if (kind === 'other identity') initial.binding.subject = sha('different');
    if (kind === 'other client') initial.binding.id = 'oaiapp_other';
    if (kind === 'next model' || kind === 'no persistence hook') {
      initial.expires = Date.now() + 60000;
      initial.verifiedModel = 'gpt-6.2-sol';
    }
    let secret: string | null =
      kind === 'missing grant'
        ? null
        : kind === 'corrupt secret'
          ? 'private-marker'
          : JSON.stringify(initial);
    let reads = 0,
      posts = 0,
      models = 0,
      deleted = 0;
    const storage = () => ({
      getPassword: () => {
        reads++;
        if (kind === 'locked store') throw Error('private-marker');
        return secret;
      },
      setPassword: (value: string) => {
        secret = value;
      },
      deletePassword: () => {
        deleted++;
        secret = null;
        return true;
      },
    });
    let signalStarted!: () => void, signalReleased!: () => void;
    const started = new Promise<void>((r) => {
      signalStarted = r;
    });
    const released = new Promise<void>((r) => {
      signalReleased = r;
    });
    const seenSignals: AbortSignal[] = [];
    const io: typeof fetch = async (url, init) => {
      seenSignals.push(init!.signal!);
      if (String(url).endsWith('/oauth/token')) {
        posts++;
        assert.equal((init!.body as URLSearchParams).get('refresh_token'), 'fixture-refresh');
        signalStarted();
        if (['concurrent refresh', 'closed waiter'].includes(kind)) await released;
        if (kind === 'unreachable provider') throw Error('private-marker');
        if (kind === 'revoked 401') return Response.json({ error: 'invalid_grant' }, { status: 401 });
        if (kind === 'revoked without store')
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        if (kind === 'unrelated nested error')
          return Response.json({ error: { code: 'retry' } }, { status: 401 });
        if (kind === 'unrelated grant error') return Response.json({ error: 'other' }, { status: 400 });
        if (kind.startsWith('revocation '))
          return Response.json({ error: { code: kind.slice(11) } }, { status: 401 });
        if (kind === 'revoked session') return Response.json({ error: 'invalid_grant' }, { status: 400 });
        if (kind === 'temporary failure') return new Response(null, { status: 503 });
        return Response.json({
          token_type: 'bearer',
          access_token: 'rotated',
          refresh_token: 'replacement',
          expires_in: 3600,
        });
      }
      models++;
      assert.equal(url, 'https://api.openai.com/v1/models');
      if (kind === 'catalogue interruption' && models === 1) return new Response(null, { status: 503 });
      return Response.json({ models: [{ slug: 'gpt-6.2-astra', visibility: 'list' }] });
    };
    const open = () => storedAccount(host, 'gpt-6.2-astra', dir, storage, io);
    const first = open(),
      second = open(),
      signal = new AbortController().signal;
    try {
      if (kind === 'unsafe lock') symlinkSync(join(dir, 'missing'), join(dir, 'rotation.lock'));
      if (['revoked without store', 'no persistence hook', 'unpersisted renewal'].includes(kind)) {
        const account = hostAccountSession(host, 'gpt-6.2-astra', io, undefined, Date.now, initial);
        try {
          if (kind === 'no persistence hook') assert.equal(await account.access(signal), 'fixture-access');
          else if (kind === 'unpersisted renewal') assert.equal(await account.access(signal), 'rotated');
          else await assert.rejects(account.access(signal), { message: 'SBX_SIGN_IN_REQUIRED' });
        } finally {
          account.close();
        }
        return;
      }
      const work = first.access(signal);
      if (kind === 'concurrent refresh' || kind === 'closed waiter') {
        await started;
        const waiter = second.access(signal);
        if (kind === 'closed waiter') {
          second.close();
          await assert.rejects(waiter, { name: 'AbortError' });
        }
        signalReleased();
        assert.equal(await work, 'rotated');
        if (kind === 'concurrent refresh') assert.equal(await waiter, 'rotated');
        assert.equal(posts, 1);
        assert.equal(models, 1);
      } else if (kind === 'next model') {
        assert.equal(await work, 'fixture-access');
        assert.equal(models, 1);
        assert.equal(posts, 0);
      } else {
        const errors: Record<string, string> = {
          'unsafe lock': 'SBX_ACCOUNT_LOCK',
          'missing grant': 'SBX_SIGN_IN_REQUIRED',
          'corrupt secret': 'SBX_KEYCHAIN_UNAVAILABLE',
          'locked store': 'SBX_KEYCHAIN_UNAVAILABLE',
          'unregistered identity': 'SBX_ACCOUNT_IDENTITY',
          'unreachable provider': 'SBX_ACCOUNT_UNAVAILABLE',
          'revoked 401': 'SBX_SIGN_IN_REQUIRED',
          'unrelated grant error': 'SBX_ACCOUNT_TRANSPORT',
          'unrelated nested error': 'SBX_ACCOUNT_TRANSPORT',
          'revoked session': 'SBX_SIGN_IN_REQUIRED',
          'temporary failure': 'SBX_ACCOUNT_TRANSPORT',
          'catalogue interruption': 'SBX_ACCOUNT_TRANSPORT',
          'other client': 'SBX_ACCOUNT_IDENTITY',
          'other identity': 'SBX_ACCOUNT_IDENTITY',
        };
        await assert.rejects(work, {
          message: kind.startsWith('revocation ') ? 'SBX_SIGN_IN_REQUIRED' : errors[kind],
        });
        if (kind === 'revoked session' || kind.startsWith('revocation ')) {
          assert.equal(deleted, 1);
          await assert.rejects(second.access(signal), { message: 'SBX_SIGN_IN_REQUIRED' });
          assert.equal(posts, 1);
        }
        if (kind === 'catalogue interruption') {
          assert.equal(await second.access(signal), 'rotated');
          assert.equal(posts, 1);
          assert.equal(models, 2);
        }
        if (kind === 'temporary failure') assert.deepEqual(JSON.parse(secret!), initial);
        if (kind === 'unsafe lock') assert.equal(reads, 0);
      }
      if (kind === 'concurrent refresh' || kind === 'catalogue interruption') {
        const saved = JSON.parse(secret!);
        assert.equal(saved.refresh, 'replacement');
        assert.equal(saved.verifiedModel, 'gpt-6.2-astra');
      }
      assert.ok(seenSignals.every((signal) => signal.aborted));
      if (kind !== 'unsafe lock') {
        assert.deepEqual(fs.readdirSync(dir), ['rotation.lock']);
        assert.ok(!readFileSync(join(dir, 'rotation.lock')).includes(Buffer.from('fixture')));
      }
    } finally {
      signalReleased();
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import timers from 'node:timers/promises';
Then('the OS credential entry uses the installation identity and the required Linux service', function () {
  const binding = createRequire(import.meta.url)('@napi-rs/keyring');
  const calls: unknown[][] = [];
  const original = binding.Entry;
  class FakeEntry {
    constructor(...args: unknown[]) {
      calls.push(args);
    }
  }
  binding.Entry = FakeEntry;
  try {
    assert.ok(keychainEntry('fixture-installation') instanceof FakeEntry);
    assert.deepEqual(calls, [
      ['architect-os.siwc', 'fixture-installation', { linux: { store: 'secret-service' } }],
    ]);
  } finally {
    binding.Entry = original;
  }
});
Then('only a complete bearer and a nonempty nonce enter the stored grant', function () {
  const binding = { id: 'oaiapp_fixture', subject: sha('fixture'), nonce: 'long-nonce', iat: 1 };
  const grant = { binding, access: 'abc~1==', refresh: 'refresh', idToken: 'id', expires: 1, scope: 'scope' };
  assert.deepEqual(savedGrantSchema.parse(grant), grant);
  const pending = { ...grant, pendingIdentity: { token: 'id-to-check', received: 0 } };
  assert.deepEqual(savedGrantSchema.parse(pending), pending);
  assert.equal(savedGrantSchema.safeParse({ ...pending, verifiedModel: 'gpt-6.2-astra' }).success, false);
  assert.equal(
    savedGrantSchema.safeParse({ ...grant, pendingIdentity: { token: '', received: 0 } }).success,
    false,
  );
  assert.equal(
    savedGrantSchema.safeParse({ ...grant, pendingIdentity: { token: 'fixture', received: -1 } }).success,
    false,
  );
  for (const access of ['?abc', 'abc?', ''])
    assert.equal(savedGrantSchema.safeParse({ ...grant, access }).success, false);
  assert.equal(savedGrantSchema.safeParse({ ...grant, binding: { ...binding, nonce: '' } }).success, false);
});
Then(
  'the account boundary refuses {string} before reading or sending a credential',
  async function (kind: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'account-lock-')));
    const lock = join(dir, 'rotation.lock');
    const spies: { mock: { restore(): void } }[] = [];
    const controller = new AbortController();
    const sentinel = Error('fixture I/O');
    let opens = 0,
      reads = 0,
      application = 0;
    const reg = {
      issuer: 'https://auth.openai.com' as const,
      client_id: 'oaiapp_fixture',
      accountHash: sha('fixture'),
    };
    const bareHost = { hostId: 'fixture', previous: reg, registered: () => assert.fail() };
    const account = storedAccount(
      bareHost,
      'gpt-6.2-sol',
      dir,
      () => {
        opens++;
        return {
          getPassword: () => {
            reads++;
            return JSON.stringify({
              binding: { id: reg.client_id, subject: reg.accountHash, nonce: 'fixture-nonce', iat: 1 },
              access: 'fixture',
              refresh: 'fixture-refresh',
              idToken: 'fixture-id',
              expires: Date.now() + 60000,
              scope: 'offline_access resource.invoke chatgpt.tokens.use.direct',
              verifiedModel: 'gpt-6.2-sol',
            });
          },
          setPassword: () => assert.fail(),
          deletePassword: () => assert.fail(),
        };
      },
      async () => {
        application++;
        throw sentinel;
      },
    );
    try {
      if (kind === 'installation without consent handler') {
        await assert.rejects(account.signIn(controller.signal), { message: 'SBX_SIGN_IN_REQUIRED' });
        assert.equal(opens, 1);
        assert.equal(reads, 1);
      } else if (kind === 'cancelled installation') {
        const session = hostAccountSession({ ...bareHost, consentPage: () => assert.fail() }, 'gpt-6.2-sol');
        const server = mock.method(http, 'createServer');
        spies.push(server);
        syncBuiltinESMExports();
        try {
          await assert.rejects(session.signIn(AbortSignal.abort()), { name: 'AbortError' });
          assert.equal(server.mock.callCount(), 0);
        } finally {
          session.close();
        }
      } else {
        if (kind === 'lock creation failure')
          spies.push(
            mock.method(fs, 'openSync', () => {
              throw sentinel;
            }),
          );
        if (kind === 'multiply linked lock') {
          writeFileSync(lock, '', { mode: 0o600 });
          linkSync(lock, join(dir, 'alias'));
        }
        if (kind === 'exposed lock') {
          writeFileSync(lock, '', { mode: 0o600 });
          chmodSync(lock, 0o640);
        }
        if (kind === 'lock of another uid')
          spies.push(mock.method(process as NodeJS.Process & { getuid(): number }, 'getuid', () => -1));
        if (kind === 'non-file lock') {
          writeFileSync(lock, '', { mode: 0o600 });
          const stat = statSync(lock);
          spies.push(mock.method(fs, 'lstatSync', () => Object.assign(stat, { isFile: () => false })));
        }
        if (kind === 'database IO failure')
          spies.push(
            mock.method(DatabaseSync.prototype, 'exec', () => {
              throw sentinel;
            }),
          );
        if (kind === 'already cancelled') controller.abort();
        if (kind === 'blocked lock cancellation') {
          spies.push(
            mock.method(DatabaseSync.prototype, 'exec', () => {
              throw Object.assign(Error(), { errcode: 5 });
            }),
          );
          spies.push(
            mock.method(
              timers,
              'setTimeout',
              async (ms: number, _value: unknown, opts: { signal: AbortSignal }) => {
                assert.equal(ms, 100);
                controller.abort();
                assert.ok(opts.signal.aborted);
                opts.signal.throwIfAborted();
              },
            ),
          );
        }
        syncBuiltinESMExports();
        const run = account.access(controller.signal);
        if (['database IO failure', 'lock creation failure'].includes(kind))
          await assert.rejects(run, (e) => e === sentinel);
        else if (['already cancelled', 'blocked lock cancellation'].includes(kind))
          await assert.rejects(run, { name: 'AbortError' });
        else await assert.rejects(run, { message: 'SBX_ACCOUNT_LOCK' });
        assert.equal(opens, 0);
        assert.equal(reads, 0);
      }
      assert.equal(application, 0);
    } finally {
      account.close();
      for (const s of spies) s.mock.restore();
      syncBuiltinESMExports();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

Then('account installation handles {string} and releases the host session', async function (kind: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'account-install-')));
  mkdirSync(join(root, 'state'), { mode: 0o700 });
  let closes = 0,
    signIns = 0;
  const logs: string[] = [],
    outputs: string[] = [];
  const model = 'gpt-6.2-sol';
  const args =
    kind === 'missing model'
      ? []
      : kind === 'extra argument'
        ? [model, 'extra']
        : [kind === 'another model' ? 'invalid' : model];
  try {
    const proc = {
      argv: ['node', 'sbx-sign-in.ts', ...args],
      env: { ARCHITECT_OS_RUNTIME_ROOT: root },
      stdout: { write: (s: string) => outputs.push(s) },
      stderr: { write: (s: string) => logs.push(s) },
    } as unknown as NodeJS.Process;
    const run = signInCommand(proc, (host, chosen, dir) => {
      assert.equal(chosen, model);
      assert.equal(dir, join(root, 'state/sbx'));
      return {
        access: () => assert.fail(),
        close: () => {
          closes++;
        },
        signIn: async (signal) => {
          assert.ok(signal instanceof AbortSignal && !signal.aborted);
          signIns++;
          host.consentPage!('http://127.0.0.1:12345/');
          if (kind === 'refused consent') throw Error('fixture refusal');
        },
      };
    });
    assert.equal(await run, kind === 'initial setup' ? 0 : 1);
    const called = kind === 'initial setup' || kind === 'refused consent';
    assert.equal(signIns, Number(called));
    assert.equal(closes, Number(called));
    assert.deepEqual(logs, [
      ...(called ? ['Continue with ChatGPT: http://127.0.0.1:12345/\n'] : []),
      ...(kind === 'initial setup' ? [] : ['SBX sign-in failed.\n']),
    ]);
    assert.deepEqual(outputs, kind === 'initial setup' ? ['SBX account ready.\n'] : []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Then(
  'a fresh host consumer verifies the {string} replacement before accessing the catalogue',
  async function (identity: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'key-verification-')));
    const client = 'oaiapp_fixture',
      model = 'gpt-6.2-astra',
      issuer = 'https://auth.openai.com';
    const initial = {
      binding: { id: client, subject: sha('person'), nonce: 'original-nonce', iat: 1 },
      access: 'old',
      refresh: 'old-refresh',
      idToken: 'old-id',
      expires: 1,
      scope: 'offline_access resource.invoke chatgpt.tokens.use.direct',
      verifiedModel: model,
    };
    let saved = JSON.stringify(initial),
      exchanges = 0,
      verifiers = 0,
      catalogues = 0;
    const now = Math.floor(Date.now() / 1000);
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = await new SignJWT({ nonce: initial.binding.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(issuer)
      .setAudience(client)
      .setSubject(identity === 'same account' ? 'person' : 'another')
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    const host = {
      hostId: 'fixture',
      previous: { issuer: 'https://auth.openai.com' as const, client_id: client, accountHash: sha('person') },
      registered: () => assert.fail(),
    };
    const store = () => ({
      getPassword: () => saved,
      setPassword: (s: string) => {
        saved = s;
      },
      deletePassword: () => assert.fail(),
    });
    const transport: typeof fetch = async (url, options) => {
      if (url === issuer + '/api/accounts/oauth/token') {
        assert.equal(++exchanges, 1);
        assert.equal((options!.body as URLSearchParams).get('refresh_token'), 'old-refresh');
        return Response.json({
          token_type: 'bearer',
          access_token: 'new',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          id_token: jwt,
        });
      }
      if (String(url) === issuer + '/.well-known/jwks.json') {
        verifiers++;
        const item = JSON.parse(saved);
        assert.equal(item.refresh, 'new-refresh');
        assert.equal(item.idToken, 'old-id');
        assert.equal(item.pendingIdentity.token, jwt);
        assert.ok(Number.isSafeInteger(item.pendingIdentity.received));
        assert.equal(item.verifiedModel, undefined);
        if (verifiers === 1) return new Response(null, { status: 503 });
        return Response.json({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256' }],
        });
      }
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.equal(options!.headers && new Headers(options!.headers).get('authorization'), 'Bearer new');
      catalogues++;
      return Response.json({ models: [{ slug: model, visibility: 'list' }] });
    };
    const consume = async () => {
      const session = storedAccount(host, model, dir, store, transport);
      try {
        return await session.access(AbortSignal.timeout(5000));
      } finally {
        session.close();
      }
    };
    try {
      await assert.rejects(consume(), { message: 'SBX_ACCOUNT_UNAVAILABLE' });
      assert.equal(catalogues, 0);
      if (identity === 'same account') {
        assert.equal(await consume(), 'new');
        const item = JSON.parse(saved);
        assert.equal(item.binding.iat, now);
        assert.equal(item.pendingIdentity, undefined);
        assert.equal(item.verifiedModel, model);
        assert.equal(item.idToken, jwt);
        assert.equal(await consume(), 'new');
        assert.equal(catalogues, 1);
      } else {
        await assert.rejects(consume(), { message: 'SBX_ACCOUNT_IDENTITY' });
        assert.equal(catalogues, 0);
      }
      assert.equal(exchanges, 1);
      assert.equal(verifiers, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
