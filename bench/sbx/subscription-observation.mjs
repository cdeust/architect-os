import { createHash } from 'node:crypto';
import { streamDone, subscriptionFrames } from './subscription-frames.mjs';
import { subscriptionMetadata } from './subscription-metadata.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const envelope = new Set([
  'type',
  'response_id',
  'sequence_number',
  'metadata',
  'headers',
  'safety_buffering',
]);
const terminals = new Map([
  ['response.completed', 'completed'],
  ['response.failed', 'failed'],
  ['response.incomplete', 'incomplete'],
]);
const knownMetadata = new Map([
  ['openai_verification_recommendation', 'verification_metadata'],
  ['openai_chatgpt_moderation_metadata', 'moderation_metadata'],
]);
const modelHeaders = new Set(['openai-model', 'x-openai-model']);

function metering(usage) {
  if (usage == null) return { usage: null, usage_status: 'absent' };
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const total = usage.total_tokens;
  if (
    ![input, output, total].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    input + output !== total
  ) {
    return { usage: null, usage_status: 'invalid' };
  }
  return {
    usage: { input_tokens: input, output_tokens: output, total_tokens: total },
    usage_status: 'observed',
  };
}

// Only name positions may be fingerprinted. Do not traverse controls, opaque state,
// or header values. One sample per position bounds the receipt independently of the wire size.
function metadataObserver(model) {
  const categories = new Set();
  const hashes = {};
  let modelConflict = false;
  function unknown(position, name) {
    categories.add('unknown_' + position);
    if (Object.hasOwn(hashes, position)) return;
    if (/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u.exec(name)?.[0] !== name) return;
    if (/^(?:sk[-_]|(?:resp|req|msg)_|eyj[a-z0-9])/iu.test(name)) return;
    hashes[position] = createHash('sha256').update(name, 'utf8').digest('hex');
  }
  function inspect(source, responseId, explicit) {
    if (!object(source)) return;
    if (Object.hasOwn(source, 'headers') && !object(source.headers)) modelConflict = true;
    if (Object.hasOwn(source, 'safety_buffering')) categories.add('safety_control_present');
    if (!explicit && !Object.hasOwn(source, 'headers') && !Object.hasOwn(source, 'metadata')) return;
    const event = explicit ? source : { type: 'response.metadata' };
    if (!explicit) {
      for (const key of ['headers', 'metadata']) if (Object.hasOwn(source, key)) event[key] = source[key];
    }
    const disposition = subscriptionMetadata(event, responseId, model);
    categories.add(disposition);
    if (disposition === 'model_mismatch' || disposition === 'ambiguous_model') modelConflict = true;
    for (const name of Object.keys(event)) if (!envelope.has(name)) unknown('envelope', name);
    if (object(event.metadata))
      for (const name of Object.keys(event.metadata)) {
        if (knownMetadata.has(name)) categories.add(knownMetadata.get(name));
        else unknown('metadata', name);
      }
    if (object(event.headers))
      for (const key of Object.keys(event.headers)) {
        const name = key.toLowerCase();
        if (modelHeaders.has(name)) {
          categories.add('effective_model_header');
        } else if (name === 'x-codex-turn-state') categories.add('turn_state_header');
        else unknown('header', name);
      }
  }
  return {
    inspect,
    modelConflicts: () => modelConflict,
    result: () => ({ categories: [...categories].sort(), unknown_names_sha256: hashes }),
  };
}

/** Host-only evidence from the already collected transcript. Never authorizes native output. */
export function observeSubscription(wire, expectedModel, httpDisposition = 'informational') {
  const metadata = metadataObserver(expectedModel);
  let id;
  let declaredId;
  let terminal = null;
  let measured;
  let done = false;
  let failedTransport = false;
  function result(evidence) {
    return {
      evidence,
      terminal: evidence === 'bound' ? terminal : null,
      ...(evidence === 'bound' ? measured : { usage: null, usage_status: 'unobserved' }),
      metadata: metadata.result(),
    };
  }
  if (typeof expectedModel !== 'string' || !expectedModel) return result('unbound');
  try {
    for (const event of subscriptionFrames(wire)) {
      if (done) return result('invalid_stream');
      if (failedTransport) {
        if (event !== streamDone) return result('invalid_stream');
        done = true;
        continue;
      }
      if (event === streamDone) {
        if (!terminal) return result('invalid_stream');
        done = true;
        continue;
      }
      if (terminal) return result('invalid_stream');
      if (typeof event.type !== 'string' || !event.type) return result('invalid_stream');
      if (event.type === 'error') {
        failedTransport = true;
        continue;
      }
      if (!id && event.type !== 'response.created') return result('unbound');
      const response = event.response;
      // Every explicit identity must agree with the creation frame of this single-response transcript.
      const ids = [];
      if (Object.hasOwn(event, 'response_id')) ids.push(event.response_id);
      if (object(response)) {
        if (Object.hasOwn(response, 'id')) ids.push(response.id);
        if (Object.hasOwn(response, 'model') && response.model !== expectedModel) return result('unbound');
      }
      for (const value of ids) {
        if (typeof value !== 'string' || !value || (declaredId && value !== declaredId))
          return result('unbound');
        declaredId = value;
      }
      if (event.type === 'response.created') {
        if (
          id ||
          typeof response?.id !== 'string' ||
          !response.id ||
          response.model !== expectedModel ||
          response.status !== 'in_progress'
        )
          return result('unbound');
        id = response.id;
      }
      metadata.inspect(event, id, event.type === 'response.metadata');
      metadata.inspect(response, id, false);
      if (terminals.has(event.type)) {
        const status = terminals.get(event.type);
        if (!id || response?.id !== id || response.model !== expectedModel || response.status !== status)
          return result('unbound');
        if (status === 'completed' && (response.error != null || response.incomplete_details != null))
          return result('invalid_stream');
        terminal = status;
        measured = metering(response.usage);
      }
    }
  } catch {
    return result('invalid_stream');
  }
  if (failedTransport) return result('stream_error');
  if (
    metadata.modelConflicts() ||
    httpDisposition === 'model_mismatch' ||
    httpDisposition === 'ambiguous_model'
  )
    return result('unbound');
  return result(terminal ? 'bound' : 'missing_terminal');
}
