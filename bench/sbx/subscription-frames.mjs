import { frameByteLimit, parseUniqueJson } from './json-frame.mjs';
export const streamDone = Symbol('SSE done');

function parseEvent(data) {
  try {
    const event = parseUniqueJson(data);
    if (event && typeof event === 'object' && !Array.isArray(event)) return event;
  } catch {
    // Never expose raw provider bytes or parser diagnostics.
  }
  throw Error('SSE_FRAME');
}

export function* subscriptionFrames(wire) {
  if (typeof wire !== 'string' || Buffer.byteLength(wire) > frameByteLimit) throw Error('PAYLOAD_LIMIT');
  const blocks = wire.replaceAll('\r\n', '\n').split('\n\n');
  if (blocks.pop() !== '') throw Error('TRUNCATED_STREAM');
  for (const block of blocks) {
    if (!block || (block.startsWith(':') && block.split('\n').every((line) => line.startsWith(':'))))
      continue;
    const lines = block.split('\n');
    const labels = lines.filter((line) => line.startsWith('event:')).map((line) => line.slice(6).trim());
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || labels.length > 1 || lines.some((line) => !/^(?:data:|event:|:)/.test(line)))
      throw Error('SSE_FRAME');
    if (data === '[DONE]') {
      if (labels.length) throw Error('SSE_DONE');
      yield streamDone;
      continue;
    }
    const e = parseEvent(data);
    if (labels.length && e.type !== labels[0]) throw Error('SSE_ORDER');
    yield e;
  }
}
