import assert from 'node:assert/strict';
import test from 'node:test';
import { requestSubscriptionText } from './subscription-exchange.mjs';
import { fixtureResponse, model } from './text-response.mjs';

const challenge = 'AOS-8ec061f1-6e29-4968-a070-21c072110c57';
const prompt = 'Reply with exactly this value: ' + challenge;
const signal = new AbortController().signal;

test('the dispatch receives the SIWC envelope and the private receipt identifies the same request', async () => {
  const receipt = { provider_requests: 0, native_completed: false, cost_usd: null };
  let closed = false;
  const result = await requestSubscriptionText(prompt, signal, receipt, async (body, id, linked) => {
    assert.equal(id, receipt.client_request_id);
    assert.equal(linked, signal);
    assert.ok(Number.isFinite(Date.parse(receipt.requested_at)));
    assert.equal(receipt.provider_requests, 1);
    assert.deepEqual(JSON.parse(body), {
      model,
      stream: true,
      store: false,
      tools: [],
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    });
    const events = [
      { type: 'response.created', response: { id: 'r', model, status: 'in_progress' } },
      { type: 'response.completed', response: { id: 'r', ...fixtureResponse(challenge) } },
    ];
    return {
      statusCode: 200,
      headersDistinct: {},
      destroy() {
        closed = true;
      },
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield Buffer.from('data: ' + JSON.stringify(e) + '\n\n');
      },
    };
  });
  assert.equal(closed, true);
  assert.equal(result.output[0].content[0].text, challenge);
  assert.equal(receipt.provider_observation.usage_status, 'observed');
  assert.equal(receipt.native_completed, false);
  assert.equal(receipt.cost_usd, null);
});

test('failed or concurrent dispatches cannot spend a second grant, and invalid input spends none', async () => {
  const receipt = { provider_requests: 0 };
  let calls = 0;
  const dispatch = async () => {
    calls++;
    throw Error('transport');
  };
  await assert.rejects(requestSubscriptionText('other', signal, receipt, dispatch), /CHALLENGE/);
  await assert.rejects(requestSubscriptionText(prompt, AbortSignal.abort(), receipt, dispatch));
  assert.equal(receipt.provider_requests, 0);
  const first = requestSubscriptionText(prompt, signal, receipt, dispatch);
  const next = requestSubscriptionText(prompt, signal, receipt, dispatch);
  await Promise.all([assert.rejects(first, /transport/), assert.rejects(next, /TURN_NOT_ADMITTED/)]);
  assert.equal(calls, 1);
});
