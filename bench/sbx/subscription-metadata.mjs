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
const bufferingEnabled = 'x-codex-safety-buffering-enabled';
const bufferingModel = 'x-codex-safety-buffering-faster-model';
const catalogHeader = 'x-models-etag';
const controlHeaders = new Map([
  [bufferingEnabled, 'safety_buffering'],
  [bufferingModel, 'safety_buffering'],
  [catalogHeader, 'catalog_refresh'],
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
// The pinned client assigns no response semantics to this HTTP gateway version.
// v0.1 was also observed on a gateway response before the model stream started:
// https://github.com/openai/codex/issues/44313
const proxyVersionHeader = 'x-openai-proxy-wasm';

function unknownHttpControl(name) {
  return (
    controlNamespace.test(name) &&
    !modelHeaders.has(name) &&
    !controlHeaders.has(name) &&
    name !== turnStateHeader &&
    name !== proxyVersionHeader &&
    !httpDiagnostics.has(name) &&
    !windowMetric.test(name)
  );
}

// This name-only view shares the admission registry without granting the observer authority.
export function subscriptionHttpControlFamily(name) {
  if (modelHeaders.has(name)) return 'effective_model';
  if (name === turnStateHeader) return 'turn_state';
  if (name === proxyVersionHeader) return 'proxy_version';
  if (controlHeaders.has(name)) return controlHeaders.get(name);
  if (unknownHttpControl(name)) return 'unknown_provider_header';
  return undefined;
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

// Codex applies these HTTP parameters only to a subsequent typed buffering notification.
// This single-model route stops on every such notification, including malformed ones.
// No retry destination is retained. A valid header by itself never authorizes text.
// https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/codex-api/src/sse/responses.rs#L276-L297
function validBufferingParameter(name, wire) {
  const value = singleton(wire, true);
  if (name === bufferingEnabled) return value === 'true' || value === 'false';
  return value !== undefined && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value);
}

// RFC 9110 §8.8.3. Commas within an opaque tag are valid; a list of tags is not.
// Never retain or return the account's catalogue validator.
function oneEntityTag(values) {
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') return false;
  const tag = values[0];
  return /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/u.exec(tag)?.[0] === tag;
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
  let presentation = false;
  for (const [field, veto] of notificationFields) {
    if (!Object.hasOwn(metadata, field)) continue;
    // Codex produces no model-verification event for the empty list. Validate every other field.
    if (
      field === 'openai_verification_recommendation' &&
      Array.isArray(metadata[field]) &&
      metadata[field].length === 0
    )
      continue;
    // The native app-server fixture emits this exact presentation-only notification.
    // https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/tests/suite/v2/safety_check_downgrade.rs#L278-L339
    if (field === 'openai_chatgpt_moderation_metadata') {
      const value = metadata[field];
      if (
        record(value) &&
        Object.keys(value).length === 1 &&
        Object.hasOwn(value, 'presentation') &&
        value.presentation === 'inline'
      ) {
        presentation = true;
        continue;
      }
    }
    return veto;
  }
  if (Object.keys(metadata).some((field) => !notificationFields.has(field)))
    return 'requires_native_handling';
  return presentation ? 'inline_presentation' : informational;
}

/** Owns routing state for exactly one HTTP response. The capability exposes only fixed dispositions. */
export function createSubscriptionControls(model) {
  let active = typeof model === 'string' && model.length > 0;
  let receivedHeaders = false;
  let receivedEvent = false;
  let reasoningIncluded;
  let boundResponseId;
  let turnState;
  let moderationPresentation;
  let requiresCatalogRefresh = false;
  function close() {
    active = false;
    reasoningIncluded = undefined;
    turnState = undefined;
    boundResponseId = undefined;
    moderationPresentation = undefined;
    requiresCatalogRefresh = false;
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
      let receivedProxyVersion = false;
      const receivedBufferingParameters = new Set();
      for (const key of Object.keys(headers)) {
        const name = key.toLowerCase();
        if (modelHeaders.has(name)) continue;
        // Codex uses HTTP field presence, independently of its wire value or token counts.
        // https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/codex-api/src/sse/responses.rs#L55-L88
        if (http && name === 'x-reasoning-included') {
          const values = headers[key];
          if (
            reasoningIncluded ||
            !Array.isArray(values) ||
            values.length !== 1 ||
            typeof values[0] !== 'string' ||
            /[,\r\n]/u.test(values[0])
          )
            return 'ambiguous_reasoning_control';
          reasoningIncluded = true;
          continue;
        }
        if (http && name === catalogHeader) {
          if (requiresCatalogRefresh || !oneEntityTag(headers[key])) return 'ambiguous_catalog_etag';
          requiresCatalogRefresh = true;
          continue;
        }
        if (http && (name === bufferingEnabled || name === bufferingModel)) {
          if (receivedBufferingParameters.has(name) || !validBufferingParameter(name, headers[key]))
            return 'ambiguous_buffering_treatment';
          receivedBufferingParameters.add(name);
          continue;
        }
        if (controlHeaders.has(name)) return controlHeaders.get(name);
        if (name === turnStateHeader) {
          const value = singleton(headers[key], http);
          if (receivedState || !value || (turnState !== undefined && turnState !== value))
            return 'ambiguous_turn_state';
          turnState = value;
          receivedState = true;
        } else if (http && name === proxyVersionHeader) {
          if (receivedProxyVersion || singleton(headers[key], true) !== 'v0.1')
            return 'unrecognized_proxy_version';
          receivedProxyVersion = true;
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
      if (veto === 'inline_presentation') {
        if (!explicit || source !== event || moderationPresentation !== undefined) return 'turn_moderation';
        moderationPresentation = 'inline';
      } else if (veto !== informational) return veto;
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
    get moderationPresentation() {
      return moderationPresentation;
    },
    get reasoningIncluded() {
      return reasoningIncluded;
    },
    get requiresCatalogRefresh() {
      return requiresCatalogRefresh;
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
