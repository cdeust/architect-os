import { createHash } from 'node:crypto';
import { frameByteLimit as maxBytes, parseUniqueJson } from './json-frame.mjs';
import { subscriptionMetadata } from './subscription-metadata.mjs';
import { model, verifiedText } from './text-response.mjs';

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

function parseEvent(data) {
  try {
    const event = parseUniqueJson(data);
    if (event && typeof event === 'object' && !Array.isArray(event)) return event;
  } catch {
    // Never expose raw provider bytes or parser diagnostics.
  }
  throw Error('SSE_FRAME');
}

export function parseResponse(wire, challenge, maxOutput) {
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 1) throw Error('USAGE_REFUSED');
  if (typeof wire !== 'string' || Buffer.byteLength(wire) > maxBytes) throw Error('PAYLOAD_LIMIT');
  const blocks = wire.replaceAll('\r\n', '\n').split('\n\n');
  if (blocks.pop() !== '') throw Error('TRUNCATED_STREAM');
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
  for (const block of blocks) {
    if (!block || (block.startsWith(':') && block.split('\n').every((line) => line.startsWith(':'))))
      continue;
    if (done) throw Error('EXTRA_FRAME');
    const lines = block.split('\n');
    const labels = lines.filter((line) => line.startsWith('event:')).map((line) => line.slice(6).trim());
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || labels.length > 1 || lines.some((line) => !/^(?:data:|event:|:)/.test(line)))
      throw Error('SSE_FRAME');
    if (data === '[DONE]') {
      if (!terminal || labels.length) throw Error('SSE_DONE');
      done = true;
      continue;
    }
    const e = parseEvent(data);
    if ((labels.length && e.type !== labels[0]) || terminal) throw Error('SSE_ORDER');
    if (Object.hasOwn(e, 'safety_buffering') && e.safety_buffering !== false) {
      throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'requires_native_handling' });
    }
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
    } else if (e.type === 'response.metadata') {
      const disposition = subscriptionMetadata(e, started, model);
      if (disposition !== 'informational') {
        throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'provider_metadata', disposition });
      }
    } else if (e.type === 'response.output_item.added' || e.type === 'response.output_item.done') {
      if (!['reasoning', 'message'].includes(e.item?.type)) throw Error('UNEXPECTED_ITEM');
      if (
        e.item.type === 'message' &&
        Array.isArray(e.item.content) &&
        e.item.content.some((p) => p?.type === 'refusal')
      ) {
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
      throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'model_refusal' });
    } else if (!simple.has(e.type)) throw unknownEvent(e.type, true);
    // Codex also reads effective-model headers from ordinary response events.
    // Validate their values before accepting text from this pinned subscription route.
    if (e.type !== 'response.metadata') {
      for (const object of [e, e.response]) {
        if (!object || typeof object !== 'object') continue;
        const control = { type: 'response.metadata' };
        for (const key of ['headers', 'metadata']) if (Object.hasOwn(object, key)) control[key] = object[key];
        if (Object.keys(control).length === 1) continue;
        const disposition = subscriptionMetadata(control, started ?? e.response?.id, model);
        if (disposition !== 'informational') {
          throw new StreamRefusal('UPSTREAM_REFUSED', { kind: 'provider_metadata', disposition });
        }
      }
    }
  }
  if (!terminal) throw Error('MISSING_TERMINAL');
  const { input_tokens: i, output_tokens: o } = verifiedText(terminal, challenge);
  if (terminal.output.at(-1).status !== 'completed') throw Error('UNEXPECTED_TEXT');
  if (o > maxOutput || terminal.usage.total_tokens !== i + o) throw Error('USAGE_REFUSED');
  return {
    model,
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: challenge }],
      },
    ],
    usage: { input_tokens: i, output_tokens: o, total_tokens: i + o },
  };
}

// Historical SIWC HTTP 200 responses sometimes omit Content-Type. The bytes must
// still form the same complete, model-bound, metered SSE transcript before release.
export async function decodeUpstream(reply, challenge, maxOutput, receipt) {
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
  try {
    return parseResponse(await collect(reply), challenge, maxOutput);
  } catch (error) {
    if (receipt && error instanceof StreamRefusal) receipt.stream_refusal = error.diagnostic;
    throw error;
  }
}
