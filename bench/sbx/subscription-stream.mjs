import { createHash } from 'node:crypto';
import { frameByteLimit as maxBytes } from './json-frame.mjs';
import { subscriptionFrames, streamDone } from './subscription-frames.mjs';
import { createSubscriptionControls, unknownHttpControlFingerprint } from './subscription-metadata.mjs';
import { observeSubscriptionHttpControls } from './subscription-http-observation.mjs';
import { observeSubscription } from './subscription-observation.mjs';
import { model, textResponse, verifiedText } from './text-response.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
async function collect(body) {
  const parts = [];
  let bytes = 0;
  for await (const part of body) {
    bytes += part.length;
    if (bytes > maxBytes) throw Error('PAYLOAD_LIMIT');
    parts.push(part);
  }
  return decoder.decode(Buffer.concat(parts));
}
// The SIWC and Responses references in the accompanying offline note define these public codes.
const providerCodes = new Set([
  'subscription_sharing_user_not_eligible',
  'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported',
  'subscription_sharing_invalid_user',
  'subscription_sharing_user_unavailable',
  'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context',
  'server_error',
  'rate_limit_exceeded',
  'invalid_prompt',
]);
const incompleteReasons = new Set(['max_output_tokens', 'content_filter', 'steered']);

class StreamRefusal extends Error {
  constructor(category, detail) {
    super(category);
    this.diagnostic = Object.freeze(detail);
  }
}

// Give the native client a fixed denial only for decisions made by the trusted
// decoder. Transport failures, interrupted turns and unbound streams still fail.
export async function nativeSubscriptionReply(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StreamRefusal) {
      const { kind, disposition, reason } = error.diagnostic;
      if (
        (kind === 'provider_metadata' && disposition === 'turn_moderation') ||
        kind === 'model_refusal' ||
        (kind === 'response_incomplete' && reason === 'content_filter')
      )
        return { kind: 'withheld' };
    }
    throw error;
  }
}

function known(values, value) {
  return values.has(value) ? value : 'unclassified';
}

function unknownEvent(name, started) {
  const detail = { kind: 'unknown_event', phase: started ? 'after_created' : 'before_created' };
  // An invalid event name can contain private text. Only fingerprint a machine-formatted event type.
  if (typeof name === 'string' && /^response(?:\.[a-z][a-z0-9_]*)+$/u.exec(name)?.[0] === name) {
    detail.event_name_sha256 = createHash('sha256').update(name, 'utf8').digest('hex');
  }
  return new StreamRefusal(started ? 'UNEXPECTED_EVENT' : 'SSE_START', detail);
}

function requireBoundEvent(e, started) {
  if (
    (Object.hasOwn(e, 'response_id') && e.response_id !== started) ||
    (e.response && Object.hasOwn(e.response, 'id') && e.response.id !== started) ||
    (e.response && Object.hasOwn(e.response, 'model') && e.response.model !== model)
  ) {
    throw new StreamRefusal('UPSTREAM_REFUSED', {
      kind: 'provider_metadata',
      disposition: 'unbound_metadata',
    });
  }
}

function admitResponse(wire, challenge, maxOutput, controls) {
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 1) throw Error('USAGE_REFUSED');
  let terminal;
  let started;
  let done = false;
  const simple = new Set([
    'response.in_progress',
    'response.content_part.added',
    'response.content_part.done',
    'response.output_text.delta',
    'response.output_text.done',
    'response.reasoning_text.delta',
    'response.reasoning_text.done',
    'response.reasoning_summary_part.added',
    'response.reasoning_summary_part.done',
    'response.reasoning_summary_text.delta',
    'response.reasoning_summary_text.done',
  ]);
  for (const e of subscriptionFrames(wire)) {
    if (done) throw Error('EXTRA_FRAME');
    if (e === streamDone) {
      if (!terminal) throw Error('SSE_DONE');
      done = true;
      continue;
    }
    if (terminal) throw Error('SSE_ORDER');
    if (e.type === 'error') {
      throw new StreamRefusal('UPSTREAM_REFUSED', {
        kind: 'stream_error',
        phase: started ? 'after_created' : 'before_created',
        code: known(providerCodes, e.code),
      });
    }
    if (e.type === 'response.failed' || e.type === 'response.incomplete') {
      const expected = e.type === 'response.failed' ? 'failed' : 'incomplete';
      if (
        !started ||
        (Object.hasOwn(e, 'response_id') && e.response_id !== started) ||
        e.response?.id !== started ||
        e.response?.model !== model ||
        e.response.status !== expected
      ) {
        throw new StreamRefusal('SSE_TERMINAL', { kind: 'unbound_failure' });
      }
      const detail =
        expected === 'failed'
          ? { kind: 'response_failed', code: known(providerCodes, e.response.error?.code) }
          : {
              kind: 'response_incomplete',
              reason: known(incompleteReasons, e.response.incomplete_details?.reason),
            };
      throw new StreamRefusal('UPSTREAM_REFUSED', detail);
    }
    if (!started && e.type !== 'response.created') {
      if (
        simple.has(e.type) ||
        [
          'response.completed',
          'response.output_item.added',
          'response.output_item.done',
          'response.refusal.delta',
          'response.refusal.done',
        ].includes(e.type)
      ) {
        throw new StreamRefusal('SSE_START', { kind: 'event_out_of_order' });
      }
      throw unknownEvent(e.type, false);
    }
    if (e.type === 'response.created') {
      if (
        started ||
        typeof e.response?.id !== 'string' ||
        !e.response.id ||
        e.response.status !== 'in_progress' ||
        e.response.model !== model
      )
        throw Error('SSE_START');
      started = e.response.id;
    } else if (e.type === 'response.output_item.added' || e.type === 'response.output_item.done') {
      if (!['reasoning', 'message'].includes(e.item?.type)) throw Error('UNEXPECTED_ITEM');
      if (
        e.item.type === 'message' &&
        Array.isArray(e.item.content) &&
        e.item.content.some((p) => p?.type === 'refusal')
      ) {
        requireBoundEvent(e, started);
        throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'model_refusal' });
      }
    } else if (e.type === 'response.completed') {
      terminal = e.response;
      if (
        !terminal ||
        terminal.id !== started ||
        terminal.model !== model ||
        terminal.status !== 'completed' ||
        terminal.error != null ||
        terminal.incomplete_details != null ||
        !Array.isArray(terminal.output)
      )
        throw Error('SSE_TERMINAL');
    } else if (
      e.type === 'response.refusal.delta' ||
      e.type === 'response.refusal.done' ||
      (['response.content_part.added', 'response.content_part.done'].includes(e.type) &&
        e.part?.type === 'refusal')
    ) {
      requireBoundEvent(e, started);
      throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'model_refusal' });
    } else if (e.type !== 'response.metadata' && !simple.has(e.type)) {
      throw unknownEvent(e.type, true);
    }
    requireBoundEvent(e, started);
    const disposition = controls.event(e, started);
    if (disposition !== 'informational') {
      throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'provider_metadata', disposition });
    }
  }
  if (!terminal) throw Error('MISSING_TERMINAL');
  return textResponse(
    challenge,
    verifiedText(terminal, challenge, maxOutput),
    controls.moderationPresentation,
    controls.reasoningIncluded,
  );
}

export function parseResponse(wire, challenge, maxOutput) {
  const controls = createSubscriptionControls(model);
  try {
    return admitResponse(wire, challenge, maxOutput, controls);
  } finally {
    controls.close();
  }
}

// An X-Models-Etag notifies the host to refresh the authenticated account's catalogue.
// Confirm the exact model only after the entire text stream has passed admission.
// https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/models-manager/src/manager.rs#L739-L765
async function reconcileCatalog(refreshCatalog, receipt) {
  let outcome = 'unavailable';
  if (typeof refreshCatalog === 'function') {
    try {
      const evidence = await refreshCatalog();
      const fields =
        evidence && Object.getPrototypeOf(evidence) === Object.prototype
          ? Object.getOwnPropertyDescriptors(evidence)
          : {};
      const confirmed =
        Reflect.ownKeys(fields).length === 3 &&
        fields.status?.value === 200 &&
        fields.outcome?.value === 'visible' &&
        fields.model?.value === model;
      outcome = confirmed ? 'confirmed' : 'unconfirmed';
    } catch {
      outcome = 'failed';
    }
  }
  if (receipt) receipt.catalog_refresh = outcome;
  if (outcome !== 'confirmed')
    throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'http_controls', disposition: 'catalog_refresh' });
}

// Historical SIWC HTTP 200 responses sometimes omit Content-Type. The bytes must
// still form the same complete, model-bound, metered SSE transcript before release.
export async function decodeUpstream(reply, challenge, maxOutput, receipt, refreshCatalog) {
  const encodings = reply.headersDistinct['content-encoding'] ?? [];
  const types = reply.headersDistinct['content-type'] ?? [];
  if (
    reply.statusCode !== 200 ||
    encodings.length > 1 ||
    (encodings.length && encodings[0].trim().toLowerCase() !== 'identity') ||
    types.length > 1 ||
    (types.length && types[0].split(';')[0].trim().toLowerCase() !== 'text/event-stream')
  ) {
    throw Error('UPSTREAM_REFUSED');
  }
  const controls = createSubscriptionControls(model);
  try {
    const http = controls.http(reply.headersDistinct);
    if (receipt) {
      // Headers have already arrived even if the bounded body read fails.
      receipt.provider_observation = {
        evidence: 'stream_unavailable',
        terminal: null,
        usage: null,
        usage_status: 'unobserved',
        http_controls: observeSubscriptionHttpControls(reply.headersDistinct),
      };
    }
    const wire = await collect(reply);
    if (receipt) Object.assign(receipt.provider_observation, observeSubscription(wire, model, http));
    if (http !== 'informational') {
      const diagnostic = { kind: 'http_controls', disposition: http };
      if (http === 'requires_native_handling') {
        const hash = unknownHttpControlFingerprint(reply.headersDistinct);
        if (hash) diagnostic.header_name_sha256 = hash;
      }
      throw new StreamRefusal('UPSTREAM_REFUSED', diagnostic);
    }
    const response = admitResponse(wire, challenge, maxOutput, controls);
    if (controls.requiresCatalogRefresh) await reconcileCatalog(refreshCatalog, receipt);
    return response;
  } catch (error) {
    if (receipt && error instanceof StreamRefusal) receipt.stream_refusal = error.diagnostic;
    throw error;
  } finally {
    controls.close();
  }
}
