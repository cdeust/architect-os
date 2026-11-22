import { model } from './text-response.mjs';

// Same wire grammar as the isolated Codex guest: the host generates the UUID with randomUUID().
const challengePrompt =
  /^Reply with exactly this value: (AOS-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

export function subscriptionChallenge(prompt) {
  const match = typeof prompt === 'string' && challengePrompt.exec(prompt);
  if (!match || match[0] !== prompt) throw Error('SBX_SUBSCRIPTION_CHALLENGE');
  return match[1];
}

// SIWC accepts store:false and stream:true over HTTP and excludes max_output_tokens.
// https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
export function prepareSubscriptionRequest(prompt) {
  const challenge = subscriptionChallenge(prompt);
  const body = JSON.stringify({
    model,
    stream: true,
    store: false,
    tools: [],
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
  });
  return { challenge, body };
}
