import { createHash } from 'node:crypto';
import { addAbortListener } from 'node:events';
import { frameByteLimit, parseUniqueJson } from './json-frame.mjs';

const resource = 'https://api.openai.com/v1';
const tokenEndpoint = 'https://auth.openai.com/api/accounts/oauth/token';
// Existing host operator's maximum time for catalogue and OAuth requests.
const networkDeadline = (signal) => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
const invalidGrant = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

export async function readAccountJson(body) {
  if (!body) throw Error('SBX_ACCOUNT_BODY');
  let size = 0;
  const parts = [];
  for await (const part of body) {
    size += part.byteLength;
    if (!Number.isSafeInteger(size) || size > frameByteLimit) throw Error('SBX_ACCOUNT_BODY');
    parts.push(Buffer.from(part));
  }
  return parseUniqueJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
}

// All network IO is host-owned. Each operation uses a fixed destination.
// The caller verifies the issuer, audience, signature and expiry of a new ID token.
// https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#refreshing-tokens
export function accountSessionTransport({ verifyRefreshId, fetchImpl = fetch, now = Date.now }) {
  if (typeof verifyRefreshId !== 'function') throw Error('SBX_ACCOUNT_VERIFIER');
  const awaitingIdentity = new WeakMap();
  async function validate(replacement, signal) {
    const { tokens, clientId, accountHash } = replacement;
    if (Object.hasOwn(tokens, 'id_token')) {
      if (typeof tokens.id_token !== 'string' || !tokens.id_token) return null;
      const identity = await verifyRefreshId(tokens.id_token, clientId);
      signal.throwIfAborted();
      if (
        typeof identity?.sub !== 'string' ||
        !identity.sub ||
        createHash('sha256').update(identity.sub).digest('hex') !== accountHash
      )
        return null;
    }
    return replacement;
  }

  async function refresh({ clientId, accountHash, refreshToken, signal }) {
    signal.throwIfAborted();
    const pending = awaitingIdentity.get(signal);
    let replacement = pending?.replacement;
    if (replacement) {
      if (replacement.clientId !== clientId || replacement.accountHash !== accountHash)
        throw Error('SBX_ACCOUNT_SESSION_MISMATCH');
    } else {
      const response = await fetchImpl(tokenEndpoint, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: networkDeadline(signal),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
          resource,
        }),
      });
      if (response.status !== 200) {
        if (response.status === 400 || response.status === 401) {
          const failure = await readAccountJson(response.body);
          if (invalidGrant.has(typeof failure?.error === 'string' ? failure.error : failure?.error?.code))
            return null;
        } else await response.body?.cancel();
        throw Error('SBX_ACCOUNT_REFRESH_UNAVAILABLE');
      }
      const receivedAt = now();
      // A successful exchange can consume the previous refresh token even if the reply
      // is incomplete. An unusable replacement requires a fresh verified grant.
      let tokens;
      try {
        tokens = await readAccountJson(response.body);
      } catch {
        return null;
      }
      if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
      signal.throwIfAborted();
      replacement = { clientId, accountHash, receivedAt, tokens };
    }
    try {
      const result = await validate(replacement, signal);
      awaitingIdentity.delete(signal);
      pending?.listener[Symbol.dispose]();
      return result;
    } catch {
      signal.throwIfAborted();
      // A temporarily unavailable identity verifier must never cause reuse of a
      // consumed refresh token. Resume this verification within the same session.
      if (!pending)
        awaitingIdentity.set(signal, {
          replacement,
          listener: addAbortListener(signal, () => awaitingIdentity.delete(signal)),
        });
      throw Error('SBX_ACCOUNT_IDENTITY_UNAVAILABLE');
    }
  }

  async function readCatalog(accessToken, signal) {
    const response = await fetchImpl(resource + '/models', {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: networkDeadline(signal),
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw Error('SBX_SUBSCRIPTION_CATALOG');
    }
    return readAccountJson(response.body);
  }
  return Object.freeze({ refresh, readCatalog });
}
