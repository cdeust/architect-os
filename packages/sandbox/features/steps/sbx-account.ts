import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
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
    const session = hostAccountSession(
      {
        hostId: 'urn:uuid:00000000-0000-4000-8000-000000000000',
        previous:
          kind === 'new registration' ? undefined : { issuer, client_id: client, accountHash: sha('person') },
        registered: (r) => saved.push(r),
        consentPage: (origin) => {
          callback = (async () => {
            const page = await fetch(origin, { redirect: 'manual' });
            assert.equal(page.status, 303);
            const auth = new URL(page.headers.get('location')!);
            assert.equal(auth.origin, issuer);
            const p = auth.searchParams;
            assert.equal(p.get('client_id'), kind === 'new registration' ? 'dynamic_agent_client' : client);
            assert.equal(auth.pathname, '/api/accounts/authorize');
            assert.equal(p.get('ext_agent_host_id'), 'urn:uuid:00000000-0000-4000-8000-000000000000');
            assert.equal(p.get('agent_name_hint'), kind === 'new registration' ? 'Architect OS' : null);
            assert.equal(p.get('response_type'), 'code');
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
            if (kind === 'refused callback' || kind === 'substituted client' || kind === 'duplicate code') {
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
            if (kind === 'foreign state') {
              url.searchParams.set('state', 'other');
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
            assert.equal(form.get('refresh_token'), 'fixture-1');
            assert.equal(form.get('grant_type'), 'refresh_token');
            assert.equal(form.has('scope'), false);
          }
          const jwt = await new SignJWT({
            nonce: kind === 'wrong nonce' || (posts === 2 && kind === 'rotated nonce') ? 'foreign' : nonce,
            azp: kind === 'foreign azp' ? 'foreign' : client,
            auth_time:
              kind === 'invalid auth time' ? 'invalid' : kind === 'changed auth time' && posts === 2 ? 2 : 1,
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
            .setIssuedAt(Math.floor(clock / 1000) - (kind === 'old identity' && posts === 2 ? 10 : 0))
            .setExpirationTime(Math.floor(clock / 1000) + 30)
            .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
            .sign(privateKey);
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
                    kind === 'absent scope'
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
    );
    const signal = AbortSignal.timeout(5000);
    try {
      const work = async () => {
        assert.equal(await session.access(signal), 'access-1');
        assert.equal(await session.access(signal), 'access-1');
        clock += 1000;
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
          saved,
          kind === 'new registration' ? [{ issuer, client_id: client, accountHash: sha('person') }] : [],
        );
      } else {
        const errors: Record<string, string> = {
          'foreign state': 'SBX_CONSENT_CANCELLED',
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
      }
      await callback;
      if (callbackFailure) throw callbackFailure;
    } finally {
      session.close();
    }
    await assert.rejects(session.access(signal));
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSbxStep } from '../../src/sbx-step.js';
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
    const result = { provider: 'openai' as const, client:{version:'fixture',sha256:'c'.repeat(64)},receipts:[receipt],exitCode: 0, stopped: false, measure: measureSession('') };
    try {
      for (const path of [state, join(snapshot, 'sbx'), work])
        mkdirSync(path, { recursive: true, mode: 0o700 });
      const pin = JSON.parse(readFileSync(join(PKG, 'sbx/isolation.json'), 'utf8'));
      writeFileSync(join(snapshot, 'sbx/isolation.json'), JSON.stringify(kind === 'broken pin' ? {} : pin), {
        mode: 0o400,
      });
      if (kind !== 'new installation')
        writeFileSync(join(state, 'host-id'), kind === 'invalid host id' ? 'invalid' : preset, {
          mode: 0o600,
        });
      if (kind === 'existing registration' || kind === 'invalid registration')
        writeFileSync(
          join(state, 'registration.json'),
          kind === 'invalid registration' ? '' : JSON.stringify(reg),
          { mode: 0o600 },
        );
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
      const run = () =>
        buildSbxStep(
          request,
          snapshot,
          kind === 'writable launcher' ? work : root,
          root,
          (line) => {
            notice += line;
          },
          (host, which) => {
            sessions++;
            assert.equal(which, model);
            if (kind === 'new installation') assert.match(host.hostId, /^urn:uuid:[0-9a-f-]{36}$/);
            else assert.equal(host.hostId, preset);
            assert.equal(host.hostId, readFileSync(join(state, 'host-id'), 'utf8'));
            assert.equal(statSync(join(state, 'host-id')).mode & 0o777, 0o600);
            assert.deepEqual(host.previous, kind === 'existing registration' ? reg : undefined);
            return {
              access: async () => {
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
                host.consentPage('http://127.0.0.1:1234/');
                if (!host.previous) host.registered(reg);
                return 'test';
              },
              close: () => {
                closed++;
              },
            };
          },
          (settings) => ({
            build: async (received) => {
              launched++;
              assert.equal(received, request);
              assert.deepEqual(settings.policy, pin);
              assert.deepEqual(settings.budget, { requests: 2, tokens: 7, bytes: 4096 });
              assert.equal(settings.archive, join(root, 'cache/sbx', pin.archive));
              assert.equal(settings.guestSource, join(snapshot, 'sbx/codex-guest.py'));
              assert.equal(await settings.access(new AbortController().signal), 'test');
              if (kind === 'refused builder') throw Error('FIXTURE_BUILD');
              settings.record(receipt);
              return result;
            },
          }),
        );
      if (kind === 'new installation' || kind === 'existing registration') {
        assert.equal(await run(), result);
        assert.deepEqual(JSON.parse(readFileSync(join(state, 'registration.json'), 'utf8')), reg);
        assert.equal(readFileSync(join(state, 'usage.jsonl'), 'utf8'), JSON.stringify(receipt) + '\n');
        assert.equal(notice, 'Continue with ChatGPT: http://127.0.0.1:1234/\n');
      } else if (kind.startsWith('concurrent'))
        await assert.rejects(run(), { message: 'SBX_ACCOUNT_CHANGED' });
      else if (kind === 'refused builder') await assert.rejects(run(), { message: 'FIXTURE_BUILD' });
      else if (kind === 'invalid limits' || kind === 'invalid registration')
        await assert.rejects(run(), { message: 'SBX_INVALID_SETTING' });
      else await assert.rejects(run());
      assert.deepEqual([sessions, closed, launched], [expected, expected, expected]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
