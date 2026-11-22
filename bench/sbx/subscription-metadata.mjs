// Codex rust-v0.170.0: HTTP treatment, effective model and independent stream notifications.
// https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/codex-api/src/sse/responses.rs
// https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/codex-api/src/safety_buffering.rs
// https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/codex-api/src/guardian_assessment.rs
import { createHash } from 'node:crypto';

const informational = 'informational';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const envelope = new Set([
  'type',
  'response_id',
  'sequence_number',
  'metadata',
  'headers',
  'safety_buffering',
]);
const modelHeaders = new Set(['openai-model', 'x-openai-model']);
const controlHeaders = new Map([
  ['x-codex-safety-buffering-enabled', 'safety_buffering'],
  ['x-codex-safety-buffering-faster-model', 'safety_buffering'],
  ['x-models-etag', 'catalog_refresh'],
  ['x-reasoning-included', 'reasoning_control'],
  ['x-codex-rate-limit-reached-type', 'rate_limit_control'],
]);
const notificationFields = new Map([
  ['guardian', 'guardian_assessment'],
  ['openai_verification_recommendation', 'model_verification'],
  ['openai_chatgpt_moderation_metadata', 'turn_moderation'],
]);

// These HTTP names carry diagnostics or account snapshots. Their values are never read.
// https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/codex-api/src/rate_limits.rs
const httpDiagnostics = new Set([
  'openai-organization',
  'openai-project',
  'openai-processing-ms',
  'openai-version',
  'x-codex-credits-has-credits',
  'x-codex-credits-unlimited',
  'x-codex-credits-balance',
]);
const windowMetric =
  /^x-codex-(?:(?:primary|secondary)-(?:used-percent|window-minutes|reset-at)|limit-name)$/u;
const controlNamespace = /^(?:openai-|x-openai-|codex-|x-codex-|x-models-|x-reasoning-)/u;
const turnStateHeader = 'x-codex-turn-state';

function unknownHttpControl(name) {
  return (
    controlNamespace.test(name) &&
    !modelHeaders.has(name) &&
    !controlHeaders.has(name) &&
    name !== turnStateHeader &&
    !httpDiagnostics.has(name) &&
    !windowMetric.test(name)
  );
}

/** Call only after a requires_native_handling HTTP verdict. Inspect names in the same
 * wire order as admission. An unsafe first name must never be attributed to a later one. */
export function unknownHttpControlFingerprint(headers) {
  if (!record(headers)) return undefined;
  for (const key of Object.keys(headers)) {
    const name = key.toLowerCase();
    if (!unknownHttpControl(name)) continue;
    if (/^[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*$/u.exec(key)?.[0] !== key) return undefined;
    if (/(?:^|[-_])(?:sk[-_]|(?:resp|req|msg)_|eyj[a-z0-9])/iu.test(name)) return undefined;
    return createHash('sha256').update(name, 'utf8').digest('hex');
  }
  return undefined;
}

// Only a single, unjoined wire value can identify a model or a routing state.
function singleton(value, http) {
  if (Array.isArray(value)) {
    if (value.length !== 1) return undefined;
    value = value[0];
  } else if (http) return undefined;
  if (typeof value !== 'string' || !value.length || /[^!-~]|,/u.test(value)) return undefined;
  return value;
}

function modelIdentity(groups, model, http) {
  let reported;
  for (const headers of groups) {
    const seen = new Set();
    for (const key of Object.keys(headers)) {
      const name = key.toLowerCase();
      if (!modelHeaders.has(name)) continue;
      const value = singleton(headers[key], http);
      if (!value || seen.has(name) || (reported !== undefined && value !== reported))
        return 'ambiguous_model';
      seen.add(name);
      reported = value;
    }
  }
  return reported !== undefined && reported !== model ? 'model_mismatch' : informational;
}

function notifications(source) {
  for (const [field, veto] of notificationFields) if (Object.hasOwn(source, field)) return veto;
  if (Object.hasOwn(source, 'safety_buffering') && source.safety_buffering !== false)
    return 'safety_buffering';
  if (!Object.hasOwn(source, 'metadata')) return informational;
  const metadata = source.metadata;
  if (!record(metadata)) return 'invalid_metadata';
  if (metadata.type === 'safety_buffering' || Object.hasOwn(metadata, 'safety_buffering'))
    return 'safety_buffering';
  for (const [field, veto] of notificationFields) {
    if (!Object.hasOwn(metadata, field)) continue;
    // Codex produces no model-verification event for the empty list. Validate every other field.
    if (
      field === 'openai_verification_recommendation' &&
      Array.isArray(metadata[field]) &&
      metadata[field].length === 0
    )
      continue;
    return veto;
  }
  return Object.keys(metadata).some((field) => !notificationFields.has(field))
    ? 'requires_native_handling'
    : informational;
}

/** Owns routing state for exactly one HTTP response. The capability exposes only fixed dispositions. */
export function createSubscriptionControls(model) {
  let active = typeof model === 'string' && model.length > 0;
  let receivedHeaders = false;
  let receivedEvent = false;
  let boundResponseId;
  let turnState;
  function close() {
    active = false;
    turnState = undefined;
    boundResponseId = undefined;
  }
  function verdict(disposition) {
    if (disposition !== informational) close();
    return disposition;
  }
  function inspectHeaders(groups, http) {
    const identity = modelIdentity(groups, model, http);
    if (identity !== informational) return identity;
    for (const headers of groups) {
      let receivedState = false;
      for (const key of Object.keys(headers)) {
        const name = key.toLowerCase();
        if (modelHeaders.has(name)) continue;
        if (controlHeaders.has(name)) return controlHeaders.get(name);
        if (name === turnStateHeader) {
          const value = singleton(headers[key], http);
          if (receivedState || !value || (turnState !== undefined && turnState !== value))
            return 'ambiguous_turn_state';
          turnState = value;
          receivedState = true;
        } else if (!http || unknownHttpControl(name)) {
          return 'requires_native_handling';
        }
      }
    }
    return informational;
  }
  function inspectEvent(event, responseId) {
    if (!active || !record(event) || typeof event.type !== 'string') return 'unbound_metadata';
    const explicit = event.type === 'response.metadata';
    if (
      (explicit && (typeof responseId !== 'string' || !responseId)) ||
      (Object.hasOwn(event, 'response_id') && event.response_id !== responseId)
    )
      return 'unbound_metadata';
    if (boundResponseId !== undefined && responseId !== boundResponseId) return 'unbound_metadata';
    if (responseId !== undefined) {
      if (typeof responseId !== 'string' || !responseId) return 'unbound_metadata';
      boundResponseId = responseId;
    }
    const sources = record(event.response) ? [event, event.response] : [event];
    const groups = sources
      .filter((source) => Object.hasOwn(source, 'headers'))
      .map((source) => source.headers);
    if (!groups.every(record)) return 'invalid_metadata';
    const disposition = inspectHeaders(groups, false);
    if (disposition !== informational) return disposition;
    for (const source of sources) {
      const veto = notifications(source);
      if (veto !== informational) return veto;
    }
    if (explicit) {
      if (
        Object.hasOwn(event, 'sequence_number') &&
        !(Number.isSafeInteger(event.sequence_number) && event.sequence_number >= 0)
      )
        return 'invalid_metadata';
      if (Object.keys(event).some((field) => !envelope.has(field))) return 'requires_native_handling';
    }
    return informational;
  }
  return {
    http(headers) {
      if (!active || receivedHeaders || receivedEvent) return verdict('unbound_metadata');
      receivedHeaders = true;
      return verdict(record(headers) ? inspectHeaders([headers], true) : 'invalid_metadata');
    },
    event(event, responseId) {
      receivedEvent = true;
      return verdict(inspectEvent(event, responseId));
    },
    close,
  };
}

/** Stateless diagnostic for a single metadata notification. Cannot release text or carry affinity. */
export function subscriptionMetadata(event, responseId, model) {
  if (event?.type !== 'response.metadata') return 'unbound_metadata';
  const controls = createSubscriptionControls(model);
  try {
    return controls.event(event, responseId);
  } finally {
    controls.close();
  }
}
