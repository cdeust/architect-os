import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmSubscriptionCatalog,
  requestNativeSubscriptionText,
  requestSubscriptionText,
} from './subscription-exchange.mjs';
import { fixtureResponse, model } from './text-response.mjs';

const challenge = 'AOS-8ec061f1-6e29-4968-a070-21c072110c57';
const prompt = 'Reply with exactly this value: ' + challenge;
const signal = new AbortController().signal;

test('fresh subscription catalog attestation requires a single visible exact account model', () => {
  const visible = { slug: model, visibility: 'list', private: 'account detail' };
  const hidden = { ...visible, visibility: 'hide' };
  assert.deepEqual(confirmSubscriptionCatalog({ models: [{ slug: 'other' }, visible] }), {
    status: 200,
    outcome: 'visible',
    model,
  });
  for (const catalog of [
    null,
    {},
    { models: {} },
    ...[[], [hidden], [visible, hidden], [hidden, visible], [visible, visible]].map((models) => ({ models })),
  ]) {
    assert.throws(() => confirmSubscriptionCatalog(catalog), /SBX_SUBSCRIPTION_CATALOG/);
  }
});

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

const catalogHeaders = { 'x-models-etag': ['W/"private-fixture-etag"'] };
const visible = { status: 200, outcome: 'visible', model };

function catalogueReply(headers = catalogHeaders, events = []) {
  const frames = [
    { type: 'response.created', response: { id: 'r', model, status: 'in_progress' } },
    ...events,
    { type: 'response.completed', response: { id: 'r', ...fixtureResponse(challenge) } },
  ];
  return {
    statusCode: 200,
    headersDistinct: headers,
    destroy() {},
    async *[Symbol.asyncIterator]() {
      for (const frame of frames) yield Buffer.from('data: ' + JSON.stringify(frame) + '\n\n');
    },
  };
}

test('one account-bound fresh catalogue read reconciles one otherwise valid response', async () => {
  const receipt = { provider_requests: 0 };
  let dispatches = 0;
  let reads = 0;
  const dispatch = async () => {
    dispatches++;
    return catalogueReply();
  };
  const refresh = async (...args) => {
    assert.deepEqual(args, []);
    reads++;
    return visible;
  };
  const first = requestSubscriptionText(prompt, signal, receipt, dispatch, refresh);
  await assert.rejects(
    requestSubscriptionText(prompt, signal, receipt, dispatch, refresh),
    /TURN_NOT_ADMITTED/,
  );
  const answer = await first;
  assert.equal(answer.model, model);
  assert.equal(receipt.catalog_refresh, 'confirmed');
  assert.equal(JSON.stringify([answer, receipt]).includes('private-fixture-etag'), false);
  await assert.rejects(
    requestSubscriptionText(prompt, signal, receipt, dispatch, refresh),
    /TURN_NOT_ADMITTED/,
  );
  assert.equal(dispatches, 1);
  assert.equal(reads, 1);
});

test('the native port consumes its only grant on a bound denial and keeps the private report on the host', async () => {
  const receipt = { provider_requests: 0 };
  let reads = 0;
  let dispatches = 0;
  const dispatch = () => {
    dispatches++;
    return catalogueReply(catalogHeaders, [
      {
        type: 'response.metadata',
        response_id: 'r',
        metadata: { openai_chatgpt_moderation_metadata: { private: 'fixture-private-report' } },
      },
    ]);
  };
  const refresh = () => {
    reads++;
    return visible;
  };
  assert.deepEqual(await requestNativeSubscriptionText(prompt, signal, receipt, dispatch, refresh), {
    kind: 'withheld',
  });
  assert.deepEqual(receipt.stream_refusal, { kind: 'provider_metadata', disposition: 'turn_moderation' });
  assert.equal(receipt.provider_observation.terminal, 'completed');
  assert.equal(JSON.stringify(receipt).includes('fixture-private-report'), false);
  await assert.rejects(
    requestNativeSubscriptionText(prompt, signal, receipt, dispatch, refresh),
    /TURN_NOT_ADMITTED/,
  );
  assert.equal(dispatches, 1);
  assert.equal(reads, 0);
});

test('missing, failed, stale or differently scoped catalogue evidence vetoes native release', async () => {
  for (const [refresh, expected] of [
    [undefined, 'unavailable'],
    [
      () => {
        throw Error('private-fixture-account');
      },
      'failed',
    ],
    [() => true, 'unconfirmed'],
    [() => ({ ...visible, outcome: 'cached' }), 'unconfirmed'],
    [() => ({ ...visible, model: 'private-fixture-account' }), 'unconfirmed'],
    [() => ({ ...visible, status: 304 }), 'unconfirmed'],
    [() => ({ ...visible, credential: 'private-fixture-account' }), 'unconfirmed'],
    [
      () => Object.defineProperty({ ...visible }, 'private', { value: 'private-fixture-account' }),
      'unconfirmed',
    ],
    [
      () => ({
        ...visible,
        get model() {
          throw Error('unexpected access');
        },
      }),
      'unconfirmed',
    ],
  ]) {
    const receipt = { provider_requests: 0 };
    await assert.rejects(
      requestSubscriptionText(prompt, signal, receipt, () => catalogueReply(), refresh),
      /UPSTREAM_REFUSED/,
    );
    assert.equal(receipt.catalog_refresh, expected);
    assert.deepEqual(receipt.stream_refusal, { kind: 'http_controls', disposition: 'catalog_refresh' });
    assert.equal(receipt.provider_observation.terminal, 'completed');
    assert.ok(!JSON.stringify(receipt).includes('private-fixture'));
  }
});

test('only a validated completion may invoke the host catalogue capability', async () => {
  const control = { type: 'response.metadata', response_id: 'r', metadata: { guardian: {} } };
  for (const [headers, events, expected] of [
    [{}, [], null],
    [{ ...catalogHeaders, 'openai-model': ['different'] }, [], 'model_mismatch'],
    [{ ...catalogHeaders, 'x-codex-rate-limit-reached-type': ['private'] }, [], 'rate_limit_control'],
    [{ 'x-models-etag': ['"one"', '"two"'] }, [], 'ambiguous_catalog_etag'],
    [catalogHeaders, [{ type: 'response.metadata', response_id: 'other' }], 'unbound_metadata'],
    [catalogHeaders, [control], 'guardian_assessment'],
  ]) {
    const receipt = { provider_requests: 0 };
    let reads = 0;
    const result = requestSubscriptionText(
      prompt,
      signal,
      receipt,
      () => catalogueReply(headers, events),
      () => {
        reads++;
        return visible;
      },
    );
    if (expected) {
      await assert.rejects(result, /UPSTREAM_REFUSED/);
      assert.equal(receipt.stream_refusal.disposition, expected);
    } else assert.equal((await result).model, model);
    assert.equal(receipt.catalog_refresh, undefined);
    assert.equal(reads, 0);
  }
});

test('the dispatch deadline covers even a stalled catalogue read; a late success cannot release text', async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const held = Promise.withResolvers();
  const receipt = { provider_requests: 0 };
  const result = requestSubscriptionText(
    prompt,
    controller.signal,
    receipt,
    () => catalogueReply(),
    () => {
      started.resolve();
      return held.promise;
    },
  );
  await started.promise;
  controller.abort();
  await assert.rejects(result, /UPSTREAM_REFUSED/);
  held.resolve(visible);
  assert.equal(receipt.provider_requests, 1);
  assert.equal(receipt.catalog_refresh, 'failed');
});
