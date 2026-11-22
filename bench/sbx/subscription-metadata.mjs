// Upstream Codex interprets response.metadata on the host. This single-turn probe can consume
// empty notifications and exact model confirmations. Other metadata needs native handling.
// https://raw.githubusercontent.com/openai/codex/104d2564181d8eb4e67d0c92005f3ab1052051d4/codex-rs/codex-api/src/sse/responses.rs
const envelope = new Set(['type', 'response_id', 'sequence_number', 'metadata', 'headers']);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function subscriptionMetadata(event, responseId, model) {
  if (
    !record(event) ||
    event.type !== 'response.metadata' ||
    typeof responseId !== 'string' ||
    !responseId ||
    typeof model !== 'string' ||
    !model
  )
    return 'unbound_metadata';
  if (Object.hasOwn(event, 'response_id') && event.response_id !== responseId) return 'unbound_metadata';
  if (
    Object.hasOwn(event, 'sequence_number') &&
    !(Number.isSafeInteger(event.sequence_number) && event.sequence_number >= 0)
  )
    return 'invalid_metadata';
  if (Object.keys(event).some((key) => !envelope.has(key))) return 'requires_native_handling';
  if (Object.hasOwn(event, 'metadata')) {
    if (!record(event.metadata)) return 'invalid_metadata';
    if (Object.keys(event.metadata).length) return 'requires_native_handling';
  }
  if (Object.hasOwn(event, 'headers')) {
    if (!record(event.headers)) return 'invalid_metadata';
    for (const [name, value] of Object.entries(event.headers)) {
      if (!['openai-model', 'x-openai-model'].includes(name.toLowerCase())) return 'requires_native_handling';
      if (value !== model) return 'model_mismatch';
    }
  }
  return 'informational';
}
