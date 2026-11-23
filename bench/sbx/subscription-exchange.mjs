import { randomUUID } from 'node:crypto';
import { prepareSubscriptionRequest } from './subscription-request.mjs';
import { decodeNativeUpstream, decodeUpstream } from './subscription-stream.mjs';
import { model } from './text-response.mjs';

// The host consumes the bounded JSON from the fixed account catalogue. No other
// model, account data or provider-supplied field becomes part of the attestation.
export function confirmSubscriptionCatalog(catalog) {
  if (!Array.isArray(catalog?.models)) throw Error('SBX_SUBSCRIPTION_CATALOG');
  const matches = catalog.models.filter((entry) => entry?.slug === model);
  if (matches.length !== 1 || matches[0].visibility !== 'list') throw Error('SBX_SUBSCRIPTION_CATALOG');
  return { status: 200, outcome: 'visible', model };
}

// The operator binds its catalogue reader to the same credential and deadline as the POST.
// The reader receives no input from the provider. A slow or interrupted read cannot release text.
async function refreshWithinGrant(refreshCatalog, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(Error('CATALOG_CANCELLED'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const read = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return refreshCatalog();
    });
    return await Promise.race([aborted, read]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// Only the host transport owns the account credential and the fixed HTTPS destination.
// Reserve before calling it, even if the transport fails or a second caller races.
async function exchangeSubscriptionText(prompt, signal, receipt, dispatch, refreshCatalog, decode) {
  if (receipt.provider_requests !== 0) throw Error('TURN_NOT_ADMITTED');
  const { challenge, body } = prepareSubscriptionRequest(prompt);
  signal.throwIfAborted();
  const requestId = randomUUID();
  receipt.client_request_id = requestId;
  receipt.requested_at = new Date().toISOString();
  receipt.provider_requests++;
  const reply = await dispatch(body, requestId, signal);
  try {
    receipt.http_status = reply.statusCode;
    // This is the host's output acceptance limit. SIWC has no max_output_tokens parameter.
    const refresh =
      typeof refreshCatalog === 'function' ? () => refreshWithinGrant(refreshCatalog, signal) : undefined;
    const response = await decode(reply, challenge, Buffer.byteLength(prompt), receipt, refresh);
    signal.throwIfAborted();
    return response;
  } finally {
    reply.destroy();
  }
}

export function requestSubscriptionText(prompt, signal, receipt, dispatch, refreshCatalog) {
  return exchangeSubscriptionText(prompt, signal, receipt, dispatch, refreshCatalog, decodeUpstream);
}

// This port additionally returns a content-free denial for the native client,
// verified against the same complete provider response as its host receipt.
export function requestNativeSubscriptionText(prompt, signal, receipt, dispatch, refreshCatalog) {
  return exchangeSubscriptionText(prompt, signal, receipt, dispatch, refreshCatalog, decodeNativeUpstream);
}
