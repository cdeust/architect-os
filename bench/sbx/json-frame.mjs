// Preserve the original benchmark per-stream byte bound.
export const frameByteLimit = 1024 * 1024;

export function parseUniqueJson(raw) {
  let fields = 0;
  const frame = JSON.parse(raw, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) fields += Object.keys(value).length;
    return value;
  });
  // JSON.parse keeps only the last duplicate member. In valid JSON only member names
  // have a colon after the string token. Every such token must survive decoding.
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"\s*(:)?/gu)) {
    if (token[1]) fields--;
  }
  if (fields !== 0) throw Error();
  return frame;
}
