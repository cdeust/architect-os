import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, decodeUpstream } from './subscription-stream.mjs';
import { model } from './text-response.mjs';
const text = 'AOS-31911239-ce54-48b4-8b78-a130f8e6ed3d';
const prompt = 'Reply with exactly this value: ' + text;
const message = {
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text }],
};
function events(edit = () => {}) {
  const final = {
    id: 'r',
    model,
    status: 'completed',
    output: [{ type: 'reasoning' }, message],
    usage: { input_tokens: 20, output_tokens: 12, total_tokens: 32 },
  };
  const items = [
    { type: 'response.created', response: { model, id: 'r', status: 'in_progress' } },
    { type: 'response.output_item.done', item: message },
    { type: 'response.completed', response: final },
  ];
  edit(items);
  return (
    items.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('') +
    'data: [DONE]\n\n'
  );
}
test('bounded terminal and safe output only', () => {
  const final = parseResponse(events(), text, Buffer.byteLength(prompt));
  assert.equal(final.output.length, 1);
  assert.deepEqual(final.usage, { input_tokens: 20, output_tokens: 12, total_tokens: 32 });
  assert.equal(final.output[0].content[0].text, text);
});
for (const [name, mutate] of [
  [
    'tool event',
    (a) => {
      a[1] = { type: 'response.output_item.added', item: { type: 'function_call' } };
    },
  ],
  [
    'wrong model',
    (a) => {
      a[2].response.model = 'other';
    },
  ],
  [
    'incomplete',
    (a) => {
      a[2].response.status = 'incomplete';
    },
  ],
  [
    'wrong counts',
    (a) => {
      a[2].response.usage.total_tokens++;
    },
  ],
  [
    'extra terminal',
    (a) => {
      a.push(a.at(-1));
    },
  ],
  [
    'wrong challenge',
    (a) => {
      a[2].response.output = [{ ...message, content: [{ type: 'output_text', text: 'other' }] }];
    },
  ],
])
  test(name, () => assert.throws(() => parseResponse(events(mutate), text, Buffer.byteLength(prompt))));

function upstream(headers, body) {
  return {
    statusCode: 200,
    headersDistinct: headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
  };
}
test('a missing media type admits only a complete validated identity-encoded SSE', async () => {
  const safe = await decodeUpstream(upstream({}, events()), text, Buffer.byteLength(prompt));
  assert.equal(safe.output[0].content[0].text, text);
  await assert.rejects(decodeUpstream(upstream({}, 'arbitrary bytes'), text, Buffer.byteLength(prompt)));
  await assert.rejects(
    decodeUpstream(upstream({ 'content-encoding': ['gzip'] }, events()), text, Buffer.byteLength(prompt)),
  );
});
test('explicit wrong or duplicate media types refuse even a valid transcript', async () => {
  for (const values of [['application/json'], [''], ['text/event-stream', 'text/event-stream']]) {
    await assert.rejects(
      decodeUpstream(upstream({ 'content-type': values }, events()), text, Buffer.byteLength(prompt)),
    );
  }
});

const privateString = 'never-emit-this-account-message@example.invalid';
const created = { type: 'response.created', response: { id: 'r', model, status: 'in_progress' } };
const eventStream = (items) => items.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('');
async function refused(items, category, expected) {
  const receipt = { provider_requests: 1, http_status: 200, usage: null, native_completed: false };
  await assert.rejects(decodeUpstream(upstream({}, eventStream(items)), text, 70, receipt), (error) => {
    assert.equal(error.message, category);
    assert.deepEqual(error.diagnostic, expected);
    return true;
  });
  const { provider_observation, ...admission } = receipt;
  assert.ok(provider_observation);
  assert.deepEqual(admission, {
    provider_requests: 1,
    http_status: 200,
    usage: null,
    native_completed: false,
    stream_refusal: expected,
  });
  assert.ok(!JSON.stringify(receipt).includes(privateString));
}

test('stream errors disclose only public codes and stream phase', async () => {
  const rate = {
    type: 'error',
    code: 'subscription_sharing_usage_limit_exceeded',
    message: privateString,
    param: privateString,
  };
  await refused([rate], 'UPSTREAM_REFUSED', {
    kind: 'stream_error',
    phase: 'before_created',
    code: rate.code,
  });
  await refused([created, { ...rate, code: privateString }], 'UPSTREAM_REFUSED', {
    kind: 'stream_error',
    phase: 'after_created',
    code: 'unclassified',
  });
});
test('a failed response uses only the bound model and an allowlisted machine code', async () => {
  const error = {
    type: 'response.failed',
    response: {
      id: 'r',
      model,
      status: 'failed',
      error: { code: 'server_error', message: privateString },
      usage: { input_tokens: 2, output_tokens: 1 },
    },
  };
  await refused([created, error], 'UPSTREAM_REFUSED', { kind: 'response_failed', code: 'server_error' });
  await refused(
    [created, { ...error, response: { ...error.response, error: { code: privateString } } }],
    'UPSTREAM_REFUSED',
    { kind: 'response_failed', code: 'unclassified' },
  );
  for (const patch of [{ model: 'other' }, { id: 'other' }, { status: 'completed' }]) {
    await refused([created, { ...error, response: { ...error.response, ...patch } }], 'SSE_TERMINAL', {
      kind: 'unbound_failure',
    });
  }
  await refused([error], 'SSE_TERMINAL', { kind: 'unbound_failure' });
});
test('incomplete reasons remain refusals even when accompanied by usage and a later completion', async () => {
  const completed = {
    type: 'response.completed',
    response: {
      model,
      id: 'r',
      status: 'completed',
      output: [message],
      usage: { input_tokens: 20, output_tokens: 12, total_tokens: 32 },
    },
  };
  for (const reason of ['max_output_tokens', 'content_filter', 'steered', privateString, undefined]) {
    await refused(
      [
        created,
        {
          type: 'response.incomplete',
          response: {
            model,
            id: 'r',
            status: 'incomplete',
            incomplete_details: { reason },
            usage: completed.response.usage,
          },
        },
        completed,
      ],
      'UPSTREAM_REFUSED',
      {
        kind: 'response_incomplete',
        reason: [privateString, undefined].includes(reason) ? 'unclassified' : reason,
      },
    );
  }
});
test('a refusal item or refusal event precludes release of the answer', async () => {
  for (const e of [
    { type: 'response.refusal.delta', delta: privateString },
    { type: 'response.refusal.done', refusal: privateString },
    { type: 'response.content_part.added', part: { type: 'refusal', refusal: privateString } },
    { type: 'response.content_part.done', part: { type: 'refusal', refusal: privateString } },
    {
      type: 'response.output_item.done',
      item: { type: 'message', content: [{ type: 'refusal', refusal: privateString }] },
    },
  ]) {
    await refused([created, e], 'UPSTREAM_REFUSED', { kind: 'model_refusal' });
  }
});
test('a valid unknown event name has a fingerprint independent of payload; malformed names have none', async () => {
  const name = 'response.synthetic.unknown';
  const hash = createHash('sha256').update(name).digest('hex');
  await refused([created, { type: name, metadata: privateString }], 'UNEXPECTED_EVENT', {
    kind: 'unknown_event',
    phase: 'after_created',
    event_name_sha256: hash,
  });
  await refused([{ type: name, metadata: 'completely different' }], 'SSE_START', {
    kind: 'unknown_event',
    phase: 'before_created',
    event_name_sha256: hash,
  });
  for (const value of [privateString, name + '\n', null, 42]) {
    await refused([created, { type: value, metadata: privateString }], 'UNEXPECTED_EVENT', {
      kind: 'unknown_event',
      phase: 'after_created',
    });
  }
});
test('malformed JSON and duplicate escaped fields always produce a fixed privacy-safe diagnostic', () => {
  const raw =
    'data: {"type":"response.created","response":{"model":"wrong","\\u006dodel":"' +
    model +
    '","id":"r","status":"in_progress"}}\n\n';
  for (const item of [raw, 'data: {"' + privateString + '"\n\n', 'data: null\n\n', 'data: []\n\n']) {
    assert.throws(() => parseResponse(item, text, 70), { message: 'SSE_FRAME' });
  }
  assert.throws(() => parseResponse(' '.repeat(1024 * 1024 + 1), text, 70), { message: 'PAYLOAD_LIMIT' });
});

test('order violations and contradictory terminal status never qualify as unknown events or completion', async () => {
  for (const type of [
    'response.completed',
    'response.output_item.added',
    'response.refusal.done',
    'response.in_progress',
  ]) {
    await refused([{ type }], 'SSE_START', { kind: 'event_out_of_order' });
  }
  assert.throws(
    () =>
      parseResponse(
        events((items) => {
          items[2].response.incomplete_details = { reason: 'max_output_tokens' };
        }),
        text,
        70,
      ),
    { message: 'SSE_TERMINAL' },
  );
});

test('informational metadata cannot escape the host or replace the terminal receipt', () => {
  const notice = { type: 'response.metadata', response_id: 'r', headers: { 'openai-model': model } };
  const parsed = parseResponse(
    events((a) => a.splice(1, 0, notice)),
    text,
    70,
  );
  assert.deepEqual(parsed, parseResponse(events(), text, 70));
  assert.throws(
    () =>
      parseResponse(
        events((a) => a.splice(1, 2, notice)),
        text,
        70,
      ),
    /SSE_DONE/,
  );
  assert.throws(() => parseResponse(eventStream([created, notice]), text, 70), /MISSING_TERMINAL/);
  for (const fields of [
    { response_id: 'other' },
    { headers: { 'openai-model': 'other' } },
    { metadata: { openai_verification_recommendation: ['required'] } },
    { metadata: { unknown: 'private' } },
  ]) {
    assert.throws(
      () =>
        parseResponse(
          events((a) => a.splice(1, 0, { ...notice, ...fields })),
          text,
          70,
        ),
      (e) => e.diagnostic?.kind === 'provider_metadata',
    );
  }
  assert.throws(
    () =>
      parseResponse(
        events((a) => (a[0].safety_buffering = true)),
        text,
        70,
      ),
    (e) => e.diagnostic?.kind === 'provider_metadata',
  );
});

test('effective model and policy notifications on ordinary response events are checked on the host', () => {
  for (const index of [0, 2]) {
    assert.throws(
      () =>
        parseResponse(
          events((a) => {
            a[index].response.headers = { 'openai-model': 'other' };
          }),
          text,
          70,
        ),
      (e) => e.diagnostic?.disposition === 'model_mismatch',
    );
  }
  assert.throws(
    () =>
      parseResponse(
        events((a) => {
          a[1].metadata = { unknown: 'opaque' };
        }),
        text,
        70,
      ),
    (e) => e.diagnostic?.disposition === 'requires_native_handling',
  );
});

test('the operator observes one upstream body even when a policy decision precludes native delivery', async () => {
  const body = events((items) =>
    items.splice(1, 0, {
      type: 'response.metadata',
      metadata: { openai_verification_recommendation: [privateString] },
    }),
  );
  let reads = 0;
  const receipt = { usage: null, cost_usd: null, native_completed: false };
  const reply = {
    statusCode: 200,
    headersDistinct: {},
    async *[Symbol.asyncIterator]() {
      assert.equal(++reads, 1);
      yield Buffer.from(body);
    },
  };
  await assert.rejects(decodeUpstream(reply, text, 70, receipt), /UPSTREAM_REFUSED/);
  assert.equal(receipt.provider_observation.terminal, 'completed');
  assert.deepEqual(receipt.provider_observation.usage, {
    input_tokens: 20,
    output_tokens: 12,
    total_tokens: 32,
  });
  assert.equal(receipt.native_completed, false);
  assert.equal(receipt.usage, null);
  assert.equal(receipt.cost_usd, null);
  assert.ok(!JSON.stringify(receipt).includes(privateString));
});

test('a substituted or ambiguous HTTP model cannot provide Astra usage or native text', async () => {
  for (const values of [['unexpected'], [model, model]]) {
    const receipt = {};
    await assert.rejects(
      decodeUpstream(upstream({ 'openai-model': values }, events()), text, 70, receipt),
      /UPSTREAM_REFUSED/,
    );
    assert.equal(receipt.stream_refusal.kind, 'http_controls');
    assert.equal(receipt.provider_observation.evidence, 'unbound');
    assert.equal(receipt.provider_observation.usage, null);
  }
});

test('an intermediate response cannot change the bound identity', () => {
  for (const patch of [
    { response_id: 'another' },
    { response: { id: 'another' } },
    { response: { model: 'another' } },
  ]) {
    const wire = events((items) => items.splice(1, 0, { type: 'response.in_progress', ...patch }));
    assert.throws(() => parseResponse(wire, text, 70), /UPSTREAM_REFUSED/);
  }
});
