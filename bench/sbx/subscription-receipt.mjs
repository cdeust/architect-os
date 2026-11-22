import { isDeepStrictEqual } from 'node:util';
import { clientSha256, clientVersion } from './codex-client.mjs';
import { frameByteLimit, parseUniqueJson } from './json-frame.mjs';
import { subscriptionChallenge } from './subscription-request.mjs';
import { challengeDigest, model, verifiedBrokerText } from './text-response.mjs';

// The worker sends its request, waits for the broker reply, then sends its result.
// Reject data following the request in the same read before yielding it for dispatch.
export async function* readSubscriptionWorkerFrames(stream) {
  const bytes = Buffer.allocUnsafe(frameByteLimit);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let end = 0;
  let start = 0;
  let count = 0;
  for await (const chunk of stream) {
    const previous = end;
    end += chunk.length;
    if (end > bytes.length) throw Error('SBX_SUBSCRIPTION_WORKER_FRAMING');
    chunk.copy(bytes, previous);
    for (let at = chunk.indexOf(10); at !== -1; at = chunk.indexOf(10, at + 1)) {
      count++;
      if (count > 2 || (count === 1 && at + 1 !== chunk.length)) throw Error('SBX_SUBSCRIPTION_WORKER_FRAMING');
      const frame = parseUniqueJson(decoder.decode(bytes.subarray(start, previous + at)));
      start = previous + at + 1;
      yield frame;
    }
  }
  if (count !== 2 || start !== end) throw Error('SBX_SUBSCRIPTION_WORKER_FRAMING');
}

// The credential-owning operator calls this after the separate native worker exits.
// Derive expectations from the host's accepted response, independently of the worker frame.
export function verifyNativeSubscriptionResult(frame, prompt, acceptedResponse) {
  const challenge = subscriptionChallenge(prompt);
  const usage = verifiedBrokerText(acceptedResponse, challenge, Buffer.byteLength(prompt));
  const result = {
    route: 'host_broker',
    model,
    client_version: clientVersion,
    client_sha256: clientSha256,
    native_exit: 0,
    terminal: 'completed',
    requests: 1,
    provider_requests: null,
    challenge_sha256: challengeDigest(challenge),
    usage,
    cost_usd: null,
    workspace_empty_after_shutdown: true,
  };
  if (acceptedResponse.moderation_presentation === 'inline') result.served_moderation_presentation = 'inline';
  if (!isDeepStrictEqual(frame, { kind: 'result', result })) throw Error('SBX_NATIVE_TEXT_RECEIPT_MISMATCH');
  return usage;
}
