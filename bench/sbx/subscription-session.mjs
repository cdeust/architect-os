import { addAbortListener } from 'node:events';
import { confirmSubscriptionCatalog, requestNativeSubscriptionText } from './subscription-exchange.mjs';

const requiredScopes = ['offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'];
const reauthorize = Symbol('invalid SIWC session');
const cancelled = (signal) =>
  Error(signal.reason === reauthorize ? 'SBX_SUBSCRIPTION_REAUTH' : 'SBX_SUBSCRIPTION_CANCELLED');

function checkActive(signal) {
  if (signal.aborted) throw cancelled(signal);
}

// A late transport result cannot re-open a closed capability. A cancelled waiter
// also leaves a rotation shared with other runs under the session's ownership.
async function whileActive(signal, operation) {
  checkActive(signal);
  const cancellation = Promise.withResolvers();
  const listener = addAbortListener(signal, () => cancellation.reject(cancelled(signal)));
  try {
    const result = await Promise.race([cancellation.promise, operation()]);
    checkActive(signal);
    return result;
  } finally {
    listener[Symbol.dispose]();
  }
}

// RFC 6749 §§5.1, 6: a refresh without a scope requests the original grant. A
// response may omit the field if unchanged. Never infer permissions at sign-in.
function grantScopes(tokens, previous) {
  if (tokens && !Object.hasOwn(tokens, 'scope') && previous) return previous;
  if (typeof tokens?.scope !== 'string') throw Error('SBX_SUBSCRIPTION_GRANT');
  const scopes = new Set(tokens.scope.split(' '));
  for (const scope of scopes) {
    if (!scope || /[^\x21\x23-\x5b\x5d-\x7e]/u.test(scope)) throw Error('SBX_SUBSCRIPTION_GRANT');
  }
  if (
    !requiredScopes.every((scope) => scopes.has(scope)) ||
    (previous && (scopes.size !== previous.size || !previous.isSubsetOf(scopes)))
  )
    throw Error('SBX_SUBSCRIPTION_GRANT');
  return scopes;
}

// The bootstrap has verified the issuer, audience, nonce and subject. Only the
// host transport receives the two opaque credentials retained by this closure.
function credentials(grant, now, previousScopes) {
  const tokens = grant?.tokens;
  const scopes = grantScopes(tokens, previousScopes);
  if (
    typeof grant?.clientId !== 'string' ||
    !/^oaiapp_[A-Za-z0-9_-]+$/u.test(grant.clientId) ||
    typeof grant.accountHash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(grant.accountHash) ||
    typeof tokens.token_type !== 'string' ||
    tokens.token_type.toLowerCase() !== 'bearer' ||
    typeof tokens.access_token !== 'string' ||
    !/^[A-Za-z0-9._~+/-]+=*$/u.test(tokens.access_token) ||
    typeof tokens.refresh_token !== 'string' ||
    !tokens.refresh_token ||
    /[^\x20-\x7e]/u.test(tokens.refresh_token) ||
    !Number.isSafeInteger(tokens.expires_in) ||
    tokens.expires_in <= 0 ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(grant.receivedAt) ||
    grant.receivedAt < 0 ||
    grant.receivedAt > now
  )
    throw Error('SBX_SUBSCRIPTION_GRANT');
  const expiresAt = grant.receivedAt + tokens.expires_in * 1000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw Error('SBX_SUBSCRIPTION_GRANT');
  return { access: tokens.access_token, refresh: tokens.refresh_token, expiresAt, scopes };
}

// The Node response is a host transport object. Neither an I/O exception nor
// bytes arriving after revocation may cross into the native exchange.
function protectedReply(reply, signal) {
  let destroyed = false;
  function destroy() {
    if (!destroyed) {
      destroyed = true;
      try {
        reply.destroy();
      } catch {
        return false;
      }
    }
    return true;
  }
  if (signal.aborted) {
    destroy();
    throw cancelled(signal);
  }
  const listener = addAbortListener(signal, destroy);
  return {
    statusCode: reply.statusCode,
    headersDistinct: reply.headersDistinct,
    destroy() {
      listener[Symbol.dispose]();
      if (!destroy()) throw Error('SBX_SUBSCRIPTION_TRANSPORT');
    },
    async *[Symbol.asyncIterator]() {
      try {
        for await (const chunk of reply) {
          checkActive(signal);
          yield chunk;
        }
      } catch {
        checkActive(signal);
        throw Error('SBX_SUBSCRIPTION_TRANSPORT');
      }
      checkActive(signal);
    },
  };
}

// SIWC rotates the refresh token and requires serialization for each account.
// https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#refreshing-tokens
export function openSubscriptionSession({ grant, refresh, readCatalog, dispatch, now = Date.now }) {
  if (![refresh, readCatalog, dispatch, now].every((port) => typeof port === 'function'))
    throw Error('SBX_SUBSCRIPTION_PORT');
  let current = credentials(grant, now());
  const { clientId, accountHash } = grant;
  grant = undefined;
  const lifetime = new AbortController();
  let pending;

  function close(reason) {
    current = undefined;
    lifetime.abort(reason);
  }

  async function rotate() {
    checkActive(lifetime.signal);
    let replacement;
    try {
      replacement = await refresh({
        clientId,
        accountHash,
        refreshToken: current.refresh,
        signal: lifetime.signal,
      });
    } catch (error) {
      checkActive(lifetime.signal);
      // The exchange succeeded. Until its replacement identity is verified,
      // no request may use the previous bearer, even before its expiry.
      if (error?.message === 'SBX_ACCOUNT_IDENTITY_UNAVAILABLE') current.access = undefined;
      throw Error('SBX_SUBSCRIPTION_REFRESH_UNAVAILABLE');
    }
    checkActive(lifetime.signal);
    try {
      // The transport returns null on a confirmed invalid grant. An invalid
      // replacement must never leave the previous, potentially rotated set live.
      if (replacement?.clientId !== clientId || replacement.accountHash !== accountHash)
        throw Error('SBX_SUBSCRIPTION_REAUTH');
      const next = credentials(replacement, now(), current.scopes);
      if (next.refresh === current.refresh) throw Error('SBX_SUBSCRIPTION_REAUTH');
      current = next;
    } catch {
      close(reauthorize);
      throw Error('SBX_SUBSCRIPTION_REAUTH');
    }
  }

  function renewal() {
    pending ??= Promise.resolve()
      .then(rotate)
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  async function withBearer(signal, operation) {
    for (;;) {
      checkActive(signal);
      if (!pending && current.access && now() < current.expiresAt) return operation(current.access);
      await whileActive(signal, renewal);
    }
  }

  async function catalogWith(access, signal) {
    checkActive(signal);
    // A catalogue reconciliation on an in-flight native turn is bound to the
    // bearer that sent its POST. Its retirement must veto a later catalogue GET.
    if (pending || access !== current.access) throw Error('SBX_SUBSCRIPTION_CATALOG');
    try {
      const catalog = await readCatalog(access, signal);
      checkActive(signal);
      return confirmSubscriptionCatalog(catalog);
    } catch {
      checkActive(signal);
      throw Error('SBX_SUBSCRIPTION_CATALOG');
    }
  }

  function openRun(mode = 'catalog') {
    checkActive(lifetime.signal);
    if (mode !== 'catalog' && mode !== 'text') throw Error('SBX_SUBSCRIPTION_RUN_MODE');
    const run = new AbortController();
    const active = (signal) => AbortSignal.any([lifetime.signal, run.signal, signal]);
    const capability = {
      catalog(signal) {
        const linked = active(signal);
        return whileActive(linked, () => withBearer(linked, (access) => catalogWith(access, linked)));
      },
      close: () => run.abort(),
    };
    if (mode === 'catalog') return Object.freeze(capability);
    let spent = false;
    return Object.freeze({
      ...capability,
      requestText(prompt, signal, receipt) {
        const linked = active(signal);
        return whileActive(linked, () =>
          withBearer(linked, (access) => {
            if (spent) throw Error('TURN_NOT_ADMITTED');
            return requestNativeSubscriptionText(
              prompt,
              linked,
              receipt,
              async (body, id) => {
                spent = true;
                try {
                  return protectedReply(await dispatch(access, body, id, linked), linked);
                } catch {
                  checkActive(linked);
                  throw Error('SBX_SUBSCRIPTION_TRANSPORT');
                }
              },
              () => catalogWith(access, linked),
            );
          }),
        );
      },
    });
  }

  return Object.freeze({
    openRun,
    renew: (signal) => whileActive(AbortSignal.any([signal, lifetime.signal]), renewal),
    close: () => close(),
  });
}
