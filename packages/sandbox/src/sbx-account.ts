import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { addAbortListener, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { codexModelSchema, type CodexModel } from './step-file.js';

class AccountFailure extends Error {}

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scopes = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  'chatgpt.tokens.use.direct',
];
const digest = (s: string) => createHash('sha256').update(s).digest();
const fresh = () => randomBytes(32).toString('base64url');
const clientId = z.string().regex(/^oaiapp_[A-Za-z0-9_-]+$/);
export const registrationSchema = z.strictObject({
  issuer: z.literal(issuer),
  client_id: clientId,
  accountHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Registration = z.infer<typeof registrationSchema>;
export interface HostAccount {
  hostId: string;
  previous?: Registration;
  registered: (reg: Registration) => void;
  consentPage?: (url: string) => void;
}
interface Exchange {
  code: string;
  client: string;
  verifier: string;
  redirect: string;
  nonce: string;
}
async function consent(host: HostAccount, signal: AbortSignal, hint?: string): Promise<Exchange> {
  if (!host.consentPage) throw new AccountFailure('SBX_SIGN_IN_REQUIRED');
  const state = fresh(),
    nonce = fresh(),
    verifier = fresh();
  let accept!: (exchange: Exchange) => void, refuse!: (error: Error) => void;
  const result = new Promise<Exchange>((resolve, reject) => {
    accept = resolve;
    refuse = reject;
  });
  let used = false,
    origin: string,
    redirect: string,
    authorization: string;
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    if (used || req.method !== 'GET' || req.headers.host !== new URL(origin).host) {
      res.writeHead(400).end();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url!, origin);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.origin !== origin) {
      res.writeHead(400).end();
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(303, { location: authorization }).end();
      return;
    }
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404).end();
      return;
    }
    const one = (key: string) =>
      url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null;
    const supplied = one('state');
    if (!supplied || !timingSafeEqual(digest(supplied), digest(state))) {
      res.writeHead(400).end();
      return;
    }
    used = true;
    const code = one('code');
    const id = url.searchParams.has('client_id') ? one('client_id') : host.previous?.client_id;
    if (
      url.searchParams.has('error') ||
      !code ||
      !id ||
      !clientId.safeParse(id).success ||
      (host.previous && host.previous.client_id !== id)
    ) {
      res.writeHead(403).end('Authorization refused');
      refuse(new AccountFailure('SBX_CONSENT_REFUSED'));
      return;
    }
    res.end('Callback received. You can close this tab.');
    accept({ code, client: id, verifier, redirect, nonce });
  });
  const cancel = addAbortListener(signal, () => refuse(new AccountFailure('SBX_CONSENT_CANCELLED')));
  // The listener may run during the asynchronous bind.
  void result.catch(() => {});
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening', { signal });
    // This server listened on a TCP port and just emitted listening.
    const address = server.address() as AddressInfo;
    if (address.address !== '127.0.0.1') throw new AccountFailure('SBX_CALLBACK');
    origin = 'http://127.0.0.1:' + address.port;
    redirect = origin + '/auth/callback';
    const url = new URL(issuer + '/api/accounts/authorize');
    url.search = new URLSearchParams({
      client_id: host.previous?.client_id ?? 'dynamic_agent_client',
      ...(!host.previous ? { agent_name_hint: 'Architect OS' } : {}),
      ...(hint ? { id_token_hint: hint } : {}),
      ext_agent_host_id: host.hostId,
      response_type: 'code',
      redirect_uri: redirect,
      scope: scopes.join(' '),
      resource,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: digest(verifier).toString('base64url'),
    }).toString();
    authorization = url.href;
    host.consentPage(origin + '/');
    return await result;
  } finally {
    cancel[Symbol.dispose]();
    server.close();
    server.closeAllConnections();
  }
}
async function replyJson(response: Response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AccountFailure('SBX_ACCOUNT_TRANSPORT');
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new AccountFailure('SBX_ACCOUNT_BODY');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new AccountFailure('SBX_ACCOUNT_BODY');
  }
}
const tokenSchema = z.object({
  token_type: z.string().regex(/^bearer$/i),
  access_token: z.string().regex(/^[A-Za-z0-9._~+/-]+=*$/),
  refresh_token: z.string().min(1),
  expires_in: z.int().positive(),
  scope: z.string().optional(),
  id_token: z.string().min(1).optional(),
});
// Confirmed session-ending codes returned by the SIWC operator (bench/sbx/subscription-account.mjs).
const expiredCode = z.enum([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);
const expiredGrant = z.union([expiredCode, z.object({ code: expiredCode })]);
export const savedGrantSchema = z
  .strictObject({
    binding: z.strictObject({
      id: clientId,
      subject: registrationSchema.shape.accountHash,
      nonce: z.string().min(1),
      iat: z.int().nonnegative(),
      authTime: z.int().nonnegative().optional(),
    }),
    access: tokenSchema.shape.access_token,
    refresh: tokenSchema.shape.refresh_token,
    idToken: z.string().min(1),
    expires: z.int().positive(),
    scope: z.string().min(1),
    verifiedModel: codexModelSchema.optional(),
    pendingIdentity: z.strictObject({ token: z.string().min(1), received: z.int().nonnegative() }).optional(),
  })
  .refine((grant) => !grant.pendingIdentity || grant.verifiedModel === undefined);
export type SavedGrant = z.infer<typeof savedGrantSchema>;
export interface GrantChanges {
  saved(grant: SavedGrant): void;
  revoked(): void;
}
/** Protocol state is scoped to a host transaction. Only signIn can start the callback. */
export function hostAccountSession(
  host: HostAccount,
  model: CodexModel,
  io: typeof fetch = fetch,
  suppliedKeys?: JWTVerifyGetKey,
  now = Date.now,
  initial?: SavedGrant,
  changes?: GrantChanges,
) {
  const life = new AbortController();
  const keys =
    suppliedKeys ??
    createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'), {
      [customFetch]: (url, options) =>
        io(url, { ...options, signal: AbortSignal.any([options.signal, life.signal]) }),
    });
  let current = initial;
  if (
    initial &&
    (initial.binding.id !== host.previous?.client_id || initial.binding.subject !== host.previous.accountHash)
  )
    throw new AccountFailure('SBX_ACCOUNT_IDENTITY');
  let pending: Promise<void> | undefined;
  async function catalogue(access: string, signal: AbortSignal) {
    const data = await replyJson(
      await io(resource + '/models', {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: { authorization: 'Bearer ' + access },
      }),
    );
    if (
      !Array.isArray(data.models) ||
      !data.models.some(
        (m: { slug?: string; visibility?: string }) => m?.slug === model && m.visibility === 'list',
      )
    )
      throw new AccountFailure('SBX_ACCOUNT_MODEL');
    signal.throwIfAborted();
  }
  async function verifyIdentity(
    token: string,
    id: string,
    received: number,
    prior: SavedGrant['binding'] | undefined,
    nonce?: string,
  ): Promise<SavedGrant['binding']> {
    const { payload: p } = await jwtVerify(token, keys, {
      issuer,
      audience: id,
      requiredClaims: ['exp'],
      currentDate: new Date(received),
    });
    const verified = z
      .object({
        sub: z.string().min(1),
        iat: z.int().nonnegative(),
        aud: z.union([z.literal(id), z.tuple([z.literal(id)])]),
        azp: z.literal(id).optional(),
        auth_time: z.int().nonnegative().optional(),
      })
      .safeParse(p);
    if (!verified.success) throw new AccountFailure('SBX_ACCOUNT_IDENTITY');
    const subject = digest(verified.data.sub).toString('hex');
    if (prior) {
      if (
        prior.subject !== subject ||
        verified.data.iat < prior.iat ||
        (p.nonce !== undefined && p.nonce !== prior.nonce) ||
        (p.auth_time !== undefined && p.auth_time !== prior.authTime)
      )
        throw new AccountFailure('SBX_ACCOUNT_IDENTITY');
      return { ...prior, iat: verified.data.iat };
    }
    if (p.nonce !== nonce || (host.previous && subject !== host.previous.accountHash))
      throw new AccountFailure('SBX_ACCOUNT_IDENTITY');
    return { id, subject, nonce: nonce!, iat: verified.data.iat, authTime: verified.data.auth_time };
  }
  async function verifyReplacement(grant: SavedGrant) {
    const pending = grant.pendingIdentity;
    if (!pending) return;
    grant.binding = await verifyIdentity(pending.token, grant.binding.id, pending.received, grant.binding);
    grant.idToken = pending.token;
    delete grant.pendingIdentity;
  }
  async function acquire(signal: AbortSignal, signIn = false) {
    if (!signIn && !current) throw new AccountFailure('SBX_SIGN_IN_REQUIRED');
    const exchange = signIn ? await consent(host, signal, current?.idToken) : undefined;
    const prior = exchange ? undefined : current;
    let binding = prior?.binding;
    const id = exchange?.client ?? binding!.id;
    const fields: Record<string, string> = exchange
      ? {
          grant_type: 'authorization_code',
          code: exchange.code,
          code_verifier: exchange.verifier,
          redirect_uri: exchange.redirect,
        }
      : { grant_type: 'refresh_token', refresh_token: current!.refresh };
    const response = await io(issuer + '/api/accounts/oauth/token', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal,
      body: new URLSearchParams({ ...fields, client_id: id, resource }),
    });
    if (!exchange && (response.status === 400 || response.status === 401)) {
      const problem = await replyJson(new Response(response.body));
      if (expiredGrant.safeParse(problem.error).success) {
        changes?.revoked();
        throw new AccountFailure('SBX_SIGN_IN_REQUIRED');
      }
      throw new AccountFailure('SBX_ACCOUNT_TRANSPORT');
    }
    const t = tokenSchema.parse(await replyJson(response));
    const received = now(),
      scope = t.scope ?? prior?.scope;
    if (!scope) throw new AccountFailure('SBX_ACCOUNT_GRANT');
    const granted = new Set(scope.split(' '));
    if (
      !scopes.slice(3).every((s) => granted.has(s)) ||
      (prior &&
        ([...prior.scope.split(' ')].some((s) => !granted.has(s)) ||
          granted.size !== new Set(prior.scope.split(' ')).size ||
          t.refresh_token === prior.refresh))
    )
      throw new AccountFailure('SBX_ACCOUNT_GRANT');
    if (exchange) {
      if (!t.id_token) throw new AccountFailure('SBX_ACCOUNT_IDENTITY');
      binding = await verifyIdentity(t.id_token, id, received, undefined, exchange.nonce);
    }
    const expires = received + t.expires_in * 1000;
    if (!Number.isSafeInteger(expires)) throw new AccountFailure('SBX_ACCOUNT_GRANT');
    const grant: SavedGrant = {
      binding: binding!,
      access: t.access_token,
      refresh: t.refresh_token,
      idToken: prior?.idToken ?? t.id_token!,
      ...(prior && t.id_token ? { pendingIdentity: { token: t.id_token, received } } : {}),
      expires,
      scope,
    };
    // The provider has consumed the previous refresh token. Persist its replacement
    // before either JWKS or catalogue IO, but never use it before identity verification.
    if (prior) {
      changes?.saved(grant);
      await verifyReplacement(grant);
    }
    await catalogue(grant.access, signal);
    if (exchange && !host.previous)
      host.registered({ issuer, client_id: id, accountHash: grant.binding.subject });
    grant.verifiedModel = model;
    changes?.saved(grant);
    current = grant;
  }
  const close = () => {
    life.abort();
    current = undefined;
  };
  return {
    close,
    async signIn(signal: AbortSignal) {
      const active = AbortSignal.any([life.signal, signal]);
      active.throwIfAborted();
      try {
        await acquire(active, true);
      } catch (e) {
        close();
        if (e instanceof AccountFailure) throw e;
        throw new AccountFailure('SBX_ACCOUNT_UNAVAILABLE');
      }
    },
    async access(signal: AbortSignal) {
      const active = AbortSignal.any([life.signal, signal]);
      active.throwIfAborted();
      async function ensureAccess() {
        if (current?.pendingIdentity) await verifyReplacement(current);
        if (!current || now() >= current.expires) return acquire(active);
        if (current.verifiedModel !== model) {
          await catalogue(current.access, active);
          current.verifiedModel = model;
          changes?.saved(current);
        }
      }
      pending ??= ensureAccess()
        .catch((e: unknown) => {
          close();
          if (e instanceof AccountFailure) throw e;
          throw Error('SBX_ACCOUNT_UNAVAILABLE');
        })
        .finally(() => {
          pending = undefined;
        });
      await pending;
      active.throwIfAborted();
      return current!.access;
    },
  };
}
