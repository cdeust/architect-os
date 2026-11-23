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

// Inspect only the content kind and structural fields. A denial never retains its text.
function terminalContent(terminal) {
  const output = terminal.output;
  if (!Array.isArray(output)) return undefined;
  if (output.length === 0) return 'empty';
  if (output.length !== 1 && !(output.length === 2 && output[0]?.type === 'reasoning')) return undefined;
  const item = output.at(-1);
  const part = item?.content?.[0];
  if (
    item?.type !== 'message' ||
    item.role !== 'assistant' ||
    (item.status !== 'completed' && !(terminal.status === 'incomplete' && item.status === 'incomplete')) ||
    (Object.hasOwn(item, 'phase') && item.phase !== 'final_answer') ||
    !Array.isArray(item.content) ||
    item.content.length !== 1
  )
    return undefined;
  if (
    part?.type === 'refusal' &&
    typeof part.refusal === 'string' &&
    part.refusal.length > 0 &&
    !Object.hasOwn(part, 'text')
  )
    return 'refusal';
  if (part?.type === 'output_text' && typeof part.text === 'string' && !Object.hasOwn(part, 'refusal'))
    return 'text';
  return undefined;
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

function carriesOutputText(frame) {
  switch (frame.type) {
    case 'response.output_text.delta':
    case 'response.output_text.done':
      return true;
    case 'response.content_part.added':
    case 'response.content_part.done':
      return frame.part?.type === 'output_text';
    case 'response.output_item.added':
    case 'response.output_item.done':
      return (
        frame.item?.type === 'message' &&
        Array.isArray(frame.item.content) &&
        frame.item.content.some((part) => part?.type === 'output_text')
      );
    default:
      return false;
  }
}

function admitResponse(wire, challenge, maxOutput, controls, nativeObservation) {
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 1) throw Error('USAGE_REFUSED');
  let terminal;
  let started;
  let done = false;
  let withheld;
  let modelRefused = false;
  let sawOutputText = false;
  function hold(detail, terminalDecision = false) {
    if (nativeObservation?.evidence !== 'bound') throw new StreamRefusal('UPSTREAM_REFUSED', detail);
    if (!withheld || terminalDecision) withheld = new StreamRefusal('UPSTREAM_REFUSED', detail);
    if (detail.kind === 'model_refusal') modelRefused = true;
  }
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
    if (nativeObservation && carriesOutputText(e)) sawOutputText = true;
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
      if (detail.kind !== 'response_incomplete' || detail.reason !== 'content_filter')
        throw new StreamRefusal('UPSTREAM_REFUSED', detail);
      hold(detail, true);
      terminal = e.response;
    } else if (!started && e.type !== 'response.created') {
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
    } else if (e.type === 'response.created') {
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
        hold({ kind: 'model_refusal' });
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
      hold({ kind: 'model_refusal' });
    } else if (e.type !== 'response.metadata' && !simple.has(e.type)) {
      throw unknownEvent(e.type, true);
    }
    requireBoundEvent(e, started);
    const disposition = controls.event(e, started);
    if (disposition === 'turn_moderation') {
      hold({ kind: 'provider_metadata', disposition });
    } else if (disposition !== 'informational') {
      throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'provider_metadata', disposition });
    }
  }
  if (!terminal) throw Error('MISSING_TERMINAL');
  const content = nativeObservation && terminalContent(terminal);
  if (terminal.status === 'completed' && content === 'refusal') hold({ kind: 'model_refusal' }, true);
  if (withheld) {
    const consistent =
      terminal.status === 'incomplete'
        ? terminal.error == null &&
          terminal.incomplete_details?.reason === 'content_filter' &&
          (!Object.hasOwn(terminal, 'output') || content !== undefined)
        : content !== undefined &&
          (!Object.hasOwn(terminal, 'end_turn') || terminal.end_turn === true) &&
          (!modelRefused || (!sawOutputText && content === 'refusal'));
    if (!consistent || nativeObservation.terminal !== terminal.status) throw withheld;
    return withheld;
  }
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
async function decodeReply(reply, challenge, maxOutput, receipt, refreshCatalog, native) {
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
  const controls = createSubscriptionControls(model, { auditTurnModeration: native });
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
    const observation = receipt || native ? observeSubscription(wire, model, http) : undefined;
    if (receipt) Object.assign(receipt.provider_observation, observation);
    if (http !== 'informational') {
      const diagnostic = { kind: 'http_controls', disposition: http };
      if (http === 'requires_native_handling') {
        const hash = unknownHttpControlFingerprint(reply.headersDistinct);
        if (hash) diagnostic.header_name_sha256 = hash;
      }
      throw new StreamRefusal('UPSTREAM_REFUSED', diagnostic);
    }
    const response = admitResponse(wire, challenge, maxOutput, controls, native ? observation : undefined);
    if (response instanceof StreamRefusal) {
      if (receipt) receipt.stream_refusal = response.diagnostic;
      return { kind: 'withheld' };
    }
    if (controls.requiresCatalogRefresh) await reconcileCatalog(refreshCatalog, receipt);
    return response;
  } catch (error) {
    if (receipt && error instanceof StreamRefusal) receipt.stream_refusal = error.diagnostic;
    throw error;
  } finally {
    controls.close();
  }
}

export function decodeUpstream(reply, challenge, maxOutput, receipt, refreshCatalog) {
  return decodeReply(reply, challenge, maxOutput, receipt, refreshCatalog, false);
}

// Only a complete admission of this response can attest a content-free native denial.
export function decodeNativeUpstream(reply, challenge, maxOutput, receipt, refreshCatalog) {
  return decodeReply(reply, challenge, maxOutput, receipt, refreshCatalog, true);
}
