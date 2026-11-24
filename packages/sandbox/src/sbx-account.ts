import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { CodexModel } from './responses-proxy.js';

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
  consentPage: (url: string) => void;
}
interface Exchange {
  code: string;
  client: string;
  verifier: string;
  redirect: string;
  nonce: string;
}
async function consent(host: HostAccount, signal: AbortSignal): Promise<Exchange> {
  signal.throwIfAborted();
  const state = fresh(),
    nonce = fresh(),
    verifier = fresh();
  let accept!: (exchange: Exchange) => void, refuse!: (error: Error) => void;
  const result = new Promise<Exchange>((resolve, reject) => {
    accept = resolve;
    refuse = reject;
  });
  let used = false,
    origin = '',
    redirect = '',
    authorization = '';
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
    if (!timingSafeEqual(digest(one('state') ?? ''), digest(state))) {
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
      refuse(Error('SBX_CONSENT_REFUSED'));
      return;
    }
    res.end('Callback received. You can close this tab.');
    accept({ code, client: id, verifier, redirect, nonce });
  });
  const cancelled = () => refuse(Error('SBX_CONSENT_CANCELLED'));
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening', { signal });
    const address = server.address();
    if (typeof address !== 'object' || !address) throw Error('SBX_CALLBACK');
    origin = 'http://127.0.0.1:' + address.port;
    redirect = origin + '/auth/callback';
    const url = new URL(issuer + '/api/accounts/authorize');
    url.search = new URLSearchParams({
      client_id: host.previous?.client_id ?? 'dynamic_agent_client',
      ...(!host.previous ? { agent_name_hint: 'Architect OS' } : {}),
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
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
    host.consentPage(origin + '/');
    return await result;
  } finally {
    signal.removeEventListener('abort', cancelled);
    server.close();
    server.closeAllConnections();
  }
}
async function replyJson(response: Response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw Error('SBX_ACCOUNT_TRANSPORT');
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw Error('SBX_ACCOUNT_BODY');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw Error('SBX_ACCOUNT_BODY');
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
/** This closure lives in one host Step. Rotation and authorization share a single in-flight promise. */
export function hostAccountSession(
  host: HostAccount,
  model: CodexModel,
  io: typeof fetch = fetch,
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json')),
  now = Date.now,
) {
  const life = new AbortController();
  let current: { access: string; refresh: string; expires: number; scope: string } | undefined;
  let binding: { id: string; subject: string; nonce: string; iat: number; authTime: unknown } | undefined;
  let pending: Promise<void> | undefined;
  async function acquire(signal: AbortSignal) {
    const exchange = current ? undefined : await consent(host, signal);
    const id = exchange?.client ?? binding!.id;
    const fields: Record<string, string> = exchange
      ? {
          grant_type: 'authorization_code',
          code: exchange.code,
          code_verifier: exchange.verifier,
          redirect_uri: exchange.redirect,
        }
      : { grant_type: 'refresh_token', refresh_token: current!.refresh };
    const t = tokenSchema.parse(
      await replyJson(
        await io(issuer + '/api/accounts/oauth/token', {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal,
          body: new URLSearchParams({ ...fields, client_id: id, resource }),
        }),
      ),
    );
    const received = now(),
      scope = t.scope ?? current?.scope;
    const granted = new Set(scope?.split(' '));
    if (
      !scope ||
      !scopes.slice(3).every((s) => granted.has(s)) ||
      (current &&
        ([...current.scope.split(' ')].some((s) => !granted.has(s)) ||
          granted.size !== new Set(current.scope.split(' ')).size ||
          t.refresh_token === current.refresh))
    )
      throw Error('SBX_ACCOUNT_GRANT');
    if (exchange || t.id_token) {
      if (!t.id_token) throw Error('SBX_ACCOUNT_IDENTITY');
      const { payload: p } = await jwtVerify(t.id_token, keys, {
        issuer,
        audience: id,
        requiredClaims: ['iat', 'exp', 'sub'],
        currentDate: new Date(received),
      });
      if (
        !(p.aud === id || (Array.isArray(p.aud) && p.aud.length === 1 && p.aud[0] === id)) ||
        (p.azp !== undefined && p.azp !== id) ||
        !p.sub ||
        !Number.isFinite(p.iat) ||
        (p.auth_time !== undefined && !Number.isFinite(p.auth_time))
      )
        throw Error('SBX_ACCOUNT_IDENTITY');
      const subject = digest(p.sub).toString('hex');
      if (exchange) {
        if (p.nonce !== exchange.nonce || (host.previous && subject !== host.previous.accountHash))
          throw Error('SBX_ACCOUNT_IDENTITY');
        binding = { id, subject, nonce: exchange.nonce, iat: p.iat!, authTime: p.auth_time };
      } else if (
        !binding ||
        binding.subject !== subject ||
        p.iat! < binding.iat ||
        (p.nonce !== undefined && p.nonce !== binding.nonce) ||
        (p.auth_time !== undefined && p.auth_time !== binding.authTime)
      )
        throw Error('SBX_ACCOUNT_IDENTITY');
    }
    const expires = received + t.expires_in * 1000;
    if (!Number.isSafeInteger(expires)) throw Error('SBX_ACCOUNT_GRANT');
    const catalogue = await replyJson(
      await io(resource + '/models', {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: { authorization: 'Bearer ' + t.access_token },
      }),
    );
    if (
      !Array.isArray(catalogue.models) ||
      !catalogue.models.some(
        (m: { slug?: string; visibility?: string }) => m?.slug === model && m.visibility === 'list',
      )
    )
      throw Error('SBX_ACCOUNT_MODEL');
    signal.throwIfAborted();
    if (exchange && !host.previous) host.registered({ issuer, client_id: id, accountHash: binding!.subject });
    current = { access: t.access_token, refresh: t.refresh_token, expires, scope };
  }
  const close = () => {
    life.abort();
    current = undefined;
    binding = undefined;
  };
  return {
    close,
    async access(signal: AbortSignal) {
      const active = AbortSignal.any([life.signal, signal]);
      active.throwIfAborted();
      if (!current || now() >= current.expires) {
        pending ??= acquire(active)
          .catch(() => {
            close();
            throw Error('SBX_ACCOUNT_UNAVAILABLE');
          })
          .finally(() => {
            pending = undefined;
          });
        await pending;
      }
      active.throwIfAborted();
      return current!.access;
    },
  };
}
