import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, mkdirSync } from 'node:fs';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { refusalOf, type RequestPolicy } from './request-policy.js';

/**
 * Proxy d'authentification de l'outil 1a.0, natif, hors sandbox, sur 127.0.0.1. Seul détenteur de l'identifiant
 * Claude de l'hôte : il le lit à la demande (trousseau), le garde en mémoire, ne l'écrit ni ne le journalise jamais.
 * La sandbox ne connaît qu'un jeton de session aléatoire, refusé hors de la session (401) ; seules les routes
 * listées passent, en POST (403 sinon), avec un corps admis par la politique (`request-policy.ts`, 403 sinon), vers
 * l'amont fixe, avec l'`Authorization` remplacé. Une ligne d'`usage` par réponse (modèle, tokens, horodatage), sans
 * contenu ; un journal d'usage qui ne s'écrit plus arrête le proxy (503, cause nommée).
 *
 * Pas de renouvellement OAuth ici : le jeton de rafraîchissement tourne à chaque usage, et le renouveler hors de
 * Claude Code sur l'hôte invaliderait la connexion de l'hôte. Le proxy relit le trousseau quand le jeton
 * approche de l'expiration ; une session Claude Code de l'hôte le renouvelle.
 */
export interface Credential {
  readonly accessToken: string;
  /** Millisecondes depuis l'époque, si connu. */
  readonly expiresAt?: number;
}
export type CredentialSource = () => Promise<Credential>;

export interface AuthProxyOptions {
  readonly upstream: string;
  /** Expressions régulières sur le chemin et la requête ; méthode POST seulement. */
  readonly routes: readonly string[];
  readonly sessionToken: string;
  readonly credential: CredentialSource;
  /** Valeurs `anthropic-beta` exigées par l'identifiant (OAuth). */
  readonly betas: readonly string[];
  readonly policy: RequestPolicy;
  readonly usageLog?: string;
}

export interface AuthProxy {
  readonly port: number;
  /** Le jeton de session ne vaut plus rien : 401. */
  revoke(): void;
  close(): Promise<void>;
}

export interface UsageRecord {
  at: string;
  status: number;
  /** Chemin de la route relayée, sans requête. */
  route?: string;
  /** `error.type` d'une réponse en erreur ; jamais le message. */
  error_type?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'authorization',
  'x-api-key',
  'accept-encoding',
]);

const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Le corps entier, ou null au-delà de la limite ; au-delà, la suite est lue sans être gardée. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    // Stryker disable next-line ConditionalExpression: équivalent: seule la mémoire gardée diffère, un corps au-delà de la limite donne null de toute façon.
    if (size <= limit) chunks.push(chunk);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

/** Le corps admis par la politique, ou la raison du refus. */
async function admit(
  req: IncomingMessage,
  policy: RequestPolicy,
): Promise<{ body: Buffer } | { refusal: string }> {
  const body = await readBody(req, policy.maxBodyBytes);
  if (body === null) return { refusal: 'body too large' };
  const refusal = refusalOf(body.toString('utf8'), policy);
  return refusal === null ? { body } : { refusal };
}

const fail = (res: ServerResponse, status: number, type: string, message: string): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
};

/** Les en-têtes d'un sens à l'autre, sans ceux d'un saut (`HOP_BY_HOP`). */
const withoutHopByHop = (headers: IncomingHttpHeaders): OutgoingHttpHeaders =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name)));

function forwardHeaders(headers: IncomingHttpHeaders, token: string, betas: readonly string[]) {
  const out = withoutHopByHop(headers);
  const present = String(headers['anthropic-beta'] ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  const merged = [...present, ...betas.filter((b) => !present.includes(b))];
  if (merged.length > 0) out['anthropic-beta'] = merged.join(',');
  out['authorization'] = `Bearer ${token}`;
  out['accept-encoding'] = 'identity';
  return out;
}

/** Le modèle d'une réponse, s'il est une chaîne. */
const modelOf = (model: unknown): { model?: string } => (typeof model === 'string' ? { model } : {});

/** Extrait modèle et tokens d'une réponse JSON ou SSE de l'API Messages ; jamais le contenu. */
export function usageOf(contentType: string, body: string): Omit<UsageRecord, 'at' | 'status'> {
  const pick = (u: Record<string, unknown> | undefined) => {
    const out: Record<string, number> = {};
    for (const key of [
      'input_tokens',
      'output_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
    ])
      if (typeof u?.[key] === 'number') out[key] = u[key] as number;
    return out;
  };
  try {
    if (contentType.includes('text/event-stream')) {
      let record: Omit<UsageRecord, 'at' | 'status'> = {};
      for (const line of body.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const event = JSON.parse(line.slice(5)) as {
          type?: string;
          message?: { model?: unknown; usage?: Record<string, unknown> };
          usage?: Record<string, unknown>;
        };
        if (event.type === 'message_start')
          record = { ...record, ...modelOf(event.message?.model), ...pick(event.message?.usage) };
        if (event.type === 'message_delta') record = { ...record, ...pick(event.usage) };
      }
      return record;
    }
    const json = JSON.parse(body) as {
      model?: unknown;
      usage?: Record<string, unknown>;
      error?: { type?: unknown };
    };
    return {
      ...modelOf(json.model),
      ...(typeof json.error?.type === 'string' ? { error_type: json.error.type } : {}),
      ...pick(json.usage),
    };
  } catch {
    return {};
  }
}

/** Crée le journal d'usage, privé (dossier 700, fichier 600) : un journal impossible à créer empêche le démarrage. */
function openUsageLog(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, '', { mode: 0o600 });
}

/** Ce que le relais d'une requête admise partage avec le proxy. */
interface Relay {
  readonly upstream: URL;
  readonly betas: readonly string[];
  readonly log: (record: UsageRecord) => void;
}

/** Relaie une requête admise vers l'amont et rend sa réponse au client, en flux ; une ligne d'usage à la fin. */
function relay(relay: Relay, req: IncomingMessage, res: ServerResponse, body: Buffer, token: string): void {
  const path = String(req.url);
  const send = relay.upstream.protocol === 'https:' ? httpsRequest : httpRequest;
  const outgoing = send(
    new URL(path, relay.upstream),
    { method: 'POST', headers: forwardHeaders(req.headers, token, relay.betas) },
    (up) => {
      res.writeHead(up.statusCode ?? 502, withoutHopByHop(up.headers));
      let answer = '';
      up.on('data', (chunk: Buffer) => {
        answer += chunk.toString('utf8');
        res.write(chunk);
      });
      up.on('end', () => {
        res.end();
        relay.log({
          at: new Date().toISOString(),
          status: up.statusCode ?? 0,
          route: path.split('?')[0],
          ...usageOf(String(up.headers['content-type']), answer),
        });
      });
      up.on('error', () => res.destroy());
    },
  );
  // Avant la réponse seulement : passé ses en-têtes, Node signale une coupure sur `up`, pas sur la requête.
  outgoing.on('error', () => fail(res, 502, 'api_error', 'upstream unreachable'));
  outgoing.end(body);
}

export async function startAuthProxy(options: AuthProxyOptions): Promise<AuthProxy> {
  const routes = options.routes.map((r) => new RegExp(r));
  const { usageLog } = options;
  if (usageLog !== undefined) openUsageLog(usageLog);
  let revoked = false;
  // La cause qui arrête le proxy, dite à chaque appelant authentifié ; null tant qu'il sert.
  let stopped: string | null = null;

  // Sans journal d'usage, plus de requête : une ligne qui ne s'écrit plus arrête le proxy.
  const log = (record: UsageRecord) => {
    if (usageLog === undefined) return;
    try {
      appendFileSync(usageLog, `${JSON.stringify(record)}\n`);
    } catch {
      stopped = 'usage log unwritable: the auth proxy refuses every request until it restarts';
    }
  };
  const forward: Relay = { upstream: new URL(options.upstream), betas: options.betas, log };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (revoked || !sameSecret(String(req.headers['authorization']), `Bearer ${options.sessionToken}`))
      return fail(res, 401, 'authentication_error', 'session token required');
    if (stopped !== null) return fail(res, 503, 'api_error', stopped);
    const path = String(req.url);
    if (req.method !== 'POST' || !routes.some((r) => r.test(path)))
      return fail(res, 403, 'permission_error', 'route refused by the auth proxy');
    const admitted = await admit(req, options.policy);
    if ('refusal' in admitted) {
      log({
        at: new Date().toISOString(),
        status: 403,
        route: path.split('?')[0],
        error_type: 'refused_by_policy',
      });
      return fail(res, 403, 'permission_error', `refused by the auth proxy: ${admitted.refusal}`);
    }
    let credential: Credential;
    try {
      credential = await options.credential();
    } catch {
      return fail(res, 503, 'api_error', 'host credential unavailable: sign in with claude on the host');
    }
    relay(forward, req, res, admitted.body, credential.accessToken);
  };

  const server = createServer((req, res) => {
    // Stryker disable next-line ArrowFunction,StringLiteral,BlockStatement: équivalent: seule la lecture du corps rejette ici, quand le client a interrompu sa requête ; il ne lit plus la réponse.
    handle(req, res).catch(() => fail(res, 500, 'api_error', 'auth proxy error'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: (server.address() as AddressInfo).port,
    revoke: () => {
      revoked = true;
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/**
 * Lit l'identifiant comme Claude Code sur l'hôte : la commande du trousseau rend le JSON
 * `{ claudeAiOauth: { accessToken, expiresAt } }`. Relu quand l'expiration approche ; rien n'est écrit.
 * Une erreur ne porte jamais la sortie de la commande.
 */
export function commandCredential(
  argv: readonly string[],
  marginMs = 60_000,
  now: () => number = Date.now,
): CredentialSource {
  let cached: Credential | undefined;
  const fresh = (c: Credential | undefined): c is Credential =>
    c !== undefined && (c.expiresAt === undefined || c.expiresAt - now() > marginMs);
  const read = () =>
    new Promise<Credential>((done, reject) => {
      const [command, ...args] = argv;
      if (command === undefined) return reject(new Error('credential command empty'));
      execFile(command, args, { timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
        if (error) return reject(new Error('credential command failed'));
        try {
          const oauth = (
            JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }
          ).claudeAiOauth;
          if (typeof oauth?.accessToken !== 'string')
            return reject(new Error('credential has no access token'));
          done({
            accessToken: oauth.accessToken,
            ...(typeof oauth.expiresAt === 'number' ? { expiresAt: oauth.expiresAt } : {}),
          });
        } catch {
          reject(new Error('credential is not JSON'));
        }
      });
    });
  return async () => {
    if (fresh(cached)) return cached;
    cached = await read();
    if (!fresh(cached)) throw new Error('host credential expired');
    return cached;
  };
}
