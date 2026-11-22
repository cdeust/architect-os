import { randomUUID } from 'node:crypto';
import { prepareSubscriptionRequest } from './subscription-request.mjs';
import { decodeUpstream } from './subscription-stream.mjs';

// Only the host transport owns the account credential and the fixed HTTPS destination.
// Reserve before calling it, even if the transport fails or a second caller races.
export async function requestSubscriptionText(prompt, signal, receipt, dispatch) {
  if (receipt.provider_requests !== 0) throw Error('TURN_NOT_ADMITTED');
  const { challenge, body } = prepareSubscriptionRequest(prompt);
  signal.throwIfAborted();
  const requestId = randomUUID();
  receipt.client_request_id = requestId;
  receipt.requested_at = new Date().toISOString();
  receipt.provider_requests++;
  const reply = await dispatch(body, requestId, signal);
  try {
    receipt.http_status = reply.statusCode;
    // This is the host's output acceptance limit. SIWC has no max_output_tokens parameter.
    return await decodeUpstream(reply, challenge, Buffer.byteLength(prompt), receipt);
  } finally {
    reply.destroy();
  }
}
