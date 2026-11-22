import assert from 'node:assert/strict';
import test from 'node:test';
import { observeSubscriptionHttpControls } from './subscription-http-observation.mjs';
import { decodeUpstream } from './subscription-stream.mjs';
import { fixtureResponse, fixtureUsage, model } from './text-response.mjs';

function unreadable(names) {
  const headers = Object.create(null);
  for (const name of names) {
    Object.defineProperty(headers, name, {
      enumerable: true,
      get: () => assert.fail('read a header value'),
    });
  }
  return headers;
}

test('HTTP evidence describes every control family independently of wire order', () => {
  const names = [
    'x-openai-future',
    'x-codex-safety-buffering-faster-model',
    'X-Models-Etag',
    'x-reasoning-included',
    'X-Codex-Rate-Limit-Reached-Type',
    'openai-model',
    'x-codex-turn-state',
    'x-openai-proxy-wasm',
    'X-OpenAI-Model',
    'X-CODEX-SAFETY-BUFFERING-ENABLED',
    'x-models-etag',
    'x-openai-another-future',
  ];
  const expected = [
    'catalog_refresh',
    'effective_model',
    'proxy_version',
    'rate_limit_control',
    'reasoning_control',
    'safety_buffering',
    'turn_state',
    'unknown_provider_header',
  ];
  for (const order of [names, names.toReversed(), [...names.slice(4), ...names.slice(0, 4)]]) {
    assert.deepEqual(observeSubscriptionHttpControls(unreadable(order)), expected);
  }
});

test('account, request, cookie and transport metadata stay outside the inventory', () => {
  assert.deepEqual(
    observeSubscriptionHttpControls(
      unreadable([
        'openai-organization',
        'openai-project',
        'x-codex-credits-balance',
        'x-codex-primary-used-percent',
        'x-codex-secondary-reset-at',
        'x-request-id',
        'x-client-request-id',
        'authorization',
        'set-cookie',
        'cookie',
        'content-type',
        'openai-processing-ms',
        'openai-version',
        '__proto__',
        'constructor',
      ]),
    ),
    [],
  );
  const inherited = Object.create(unreadable(['x-openai-model', 'x-codex-turn-state']));
  assert.deepEqual(observeSubscriptionHttpControls(inherited), []);
});

test('unknown names remain one fixed category even for malformed or sensitive-looking names', () => {
  const names = ['x-openai-sk-fixture', 'openai-req_private', 'x-openai-private\nvalue', 'codex-'];
  for (const headers of [unreadable(names), unreadable(names.toReversed())]) {
    assert.deepEqual(observeSubscriptionHttpControls(headers), ['unknown_provider_header']);
  }
  for (const invalid of [null, undefined, [], 'private text']) {
    assert.deepEqual(observeSubscriptionHttpControls(invalid), ['invalid_headers']);
  }
});

test('the receipt inventories later controls without changing the first refusal or terminal metering', async () => {
  const challenge = 'fixture';
  const id = 'resp_fixture';
  const frames = [
    { type: 'response.created', response: { id, model, status: 'in_progress' } },
    { type: 'response.completed', response: { id, ...fixtureResponse(challenge) } },
  ];
  const body = Buffer.from(frames.map((frame) => 'data: ' + JSON.stringify(frame) + '\n\n').join(''));
  const headers = [
    ['x-codex-rate-limit-reached-type', ['private-limit-value']],
    ['x-models-etag', ['"private-catalog-value"']],
    ['x-openai-future', ['private-control-value']],
    ['x-reasoning-included', ['private-reasoning-value']],
  ];
  for (const [order, disposition] of [
    [headers, 'rate_limit_control'],
    [headers.toReversed(), 'requires_native_handling'],
  ]) {
    const reply = {
      statusCode: 200,
      headersDistinct: Object.fromEntries(order),
      async *[Symbol.asyncIterator]() {
        yield body;
      },
    };
    const receipt = {};
    await assert.rejects(decodeUpstream(reply, challenge, 64, receipt), /UPSTREAM_REFUSED/);
    assert.equal(receipt.stream_refusal.kind, 'http_controls');
    assert.equal(receipt.stream_refusal.disposition, disposition);
    assert.deepEqual(receipt.provider_observation.http_controls, [
      'catalog_refresh',
      'rate_limit_control',
      'reasoning_control',
      'unknown_provider_header',
    ]);
    assert.equal(receipt.provider_observation.terminal, 'completed');
    assert.deepEqual(receipt.provider_observation.usage, fixtureUsage);
    assert.ok(!JSON.stringify(receipt).includes('private-'));
  }
});

test('a truncated or interrupted body retains only the evidence already observed', async () => {
  const fragment = Buffer.from('data: {"type":"response.created"');
  for (const interrupted of [true, false]) {
    const refusal = new Error('fixture transport failure');
    const reply = {
      statusCode: 200,
      headersDistinct: { 'x-codex-rate-limit-reached-type': ['private'] },
      async *[Symbol.asyncIterator]() {
        yield fragment;
        if (interrupted) throw refusal;
      },
    };
    const receipt = {};
    await assert.rejects(decodeUpstream(reply, 'fixture', 64, receipt), (error) =>
      interrupted ? error === refusal : error.message === 'UPSTREAM_REFUSED',
    );
    const observation = receipt.provider_observation;
    assert.deepEqual(observation.http_controls, ['rate_limit_control']);
    assert.equal(observation.evidence, interrupted ? 'stream_unavailable' : 'invalid_stream');
    assert.equal(observation.terminal, null);
    assert.equal(observation.usage, null);
    assert.equal(observation.usage_status, 'unobserved');
  }
});
