import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSubscriptionRequest, subscriptionChallenge } from './subscription-request.mjs';

const challenge = 'AOS-12345678-9abc-4def-8123-456789abcdef';
const prompt = 'Reply with exactly this value: ' + challenge;

test('the host sends only the fixed tool-free SIWC Responses body for its challenge', () => {
  const expected =
    '{"model":"gpt-6.2-astra","stream":true,"store":false,"tools":[],' +
    '"input":[{"role":"user","content":[{"type":"input_text","text":"' +
    prompt +
    '"}]}]}';
  assert.deepEqual(prepareSubscriptionRequest(prompt), { challenge, body: expected });
  assert.equal(subscriptionChallenge(prompt), challenge);
});

test('all RFC 9562 UUIDv4 variant digits generated on the host are admitted', () => {
  for (const variant of '89ab') {
    const value = challenge.replace('-8123-', '-' + variant + '123-');
    assert.equal(subscriptionChallenge('Reply with exactly this value: ' + value), value);
  }
});

test('both boundaries reject noncanonical, extended, or non-string input with a fixed diagnostic', () => {
  const invalid = [
    {},
    null,
    undefined,
    [prompt],
    { model: 'other', prompt, tools: [] },
    { toString: () => assert.fail('coerced a non-string prompt') },
    challenge,
    prompt.slice(1),
    prompt.slice(0, -1),
    prompt.toUpperCase(),
    prompt.replace('-4def-', '-7def-'),
    prompt.replace('-8123-', '-c123-'),
    prompt.replace('12345678', '１２３４５６７８'),
    ' ' + prompt,
    prompt + '\n',
    prompt + '\r\n',
    prompt + '\u2028',
    prompt + '\0',
    prompt + ' please',
    prompt + '", "tools": [{"type": "web_search"}]',
  ];
  for (const value of invalid) {
    for (const check of [subscriptionChallenge, prepareSubscriptionRequest]) {
      assert.throws(() => check(value), { message: 'SBX_SUBSCRIPTION_CHALLENGE' });
    }
  }
});
