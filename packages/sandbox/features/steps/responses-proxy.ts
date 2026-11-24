import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { ResponsesProxy, type PipeRequest, type ResponseReceipt } from '../../src/responses-proxy.js';

const model = 'gpt-6.2-sol';
const body = () => ({
  model,
  store: false,
  stream: true,
  tools: [{ type: 'function', name: 'write' }],
  input: [{ role: 'user', content: 'edit' }],
});
const wire = (value: unknown) => 'data: ' + JSON.stringify(value) + '\r\n\r\n';
const terminal = (status: string, which: string = model, total = 5) =>
  wire({
    type: 'response.' + status,
    response: { model: which, status, usage: { input_tokens: 3, output_tokens: 2, total_tokens: total } },
  });
function fixture(kind = 'completed') {
  let sent = 0;
  const log: ResponseReceipt[] = [];
  const requests: Uint8Array[] = [];
  const responses: Buffer[] = [];
  const observed: Buffer[] = [];
  const starts: unknown[] = [];
  const account = 'fixture-host-only';
  const message =
    'event: provider.new-control\r\ndata: opaque-extension\r\n\r\n' +
    wire({ type: 'response.new_notification', value: 'α' }) +
    wire({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c', name: 'write' } });
  const upstream: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(
      { ...init?.headers },
      {
        'accept-encoding': 'identity',
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: 'Bearer ' + account,
        'x-codex-turn-state': 'opaque',
      },
    );
    sent++;
    requests.push(init!.body as Uint8Array);
    const bytes = Buffer.from(
      message +
        (kind === 'cut'
          ? 'data: {'
          : terminal(
              ['incomplete', 'failed'].includes(kind) ? kind : 'completed',
              kind === 'wrong model' ? 'other' : model,
              kind === 'invalid usage' ? 99 : 5,
            )),
    );
    responses.push(bytes);
    return new Response(
      new ReadableStream({
        start(s) {
          for (const byte of bytes) s.enqueue(Uint8Array.of(byte));
          s.close();
        },
      }),
      {
        status: kind === 'http error' ? 403 : 200,
        headers: {
          'content-type': kind === 'wrong type' ? 'application/json' : 'text/event-stream',
          'set-cookie': 'private',
          'openai-organization': 'account',
          'x-codex-safety-buffering-enabled': 'true',
        },
      },
    );
  };
  const budget = {
    seconds: 5,
    bytes: kind === 'output excess' ? 220 : 10000,
    tokens: kind === 'token excess' ? 4 : 10,
    requests: 2,
  };
  const proxy = new ResponsesProxy(
    model,
    budget,
    async () => account,
    (r) => log.push(r),
    upstream,
  );
  const request: PipeRequest = {
    method: 'POST',
    path: '/v1/responses',
    token: proxy.token,
    headers: { cookie: 'guest', authorization: 'guest', host: 'guest', 'x-codex-turn-state': 'opaque' },
    body: Buffer.from(JSON.stringify(body(), null, 2)),
  };
  const downstream = {
    start: async (status: number, headers: Record<string, string>) => {
      starts.push({ status, headers });
    },
    write: async (bytes: Uint8Array) => {
      observed.push(Buffer.from(bytes));
    },
  };
  return { requests, responses, observed, starts, proxy, request, downstream, log, sent: () => sent };
}
Then('the host relays two native Responses requests byte for byte', async function () {
  const f = fixture();
  const r1 = await f.proxy.relay(f.request, f.downstream);
  const second = Buffer.from(
    JSON.stringify(
      { ...body(), input: [{ type: 'function_call_output', call_id: 'c', output: 'file written' }] },
      null,
      3,
    ),
  );
  const r2 = await f.proxy.relay({ ...f.request, body: second }, f.downstream);
  const expected = { model, request: 1, terminal: 'completed', inputTokens: 3, outputTokens: 2 };
  assert.deepEqual(r1, expected);
  assert.deepEqual(r2, { ...expected, request: 2 });
  assert.deepEqual(f.log, [r1, r2]);
  assert.deepEqual(
    f.requests.map((b) => Buffer.from(b)),
    [f.request.body, second],
  );
  assert.deepEqual(Buffer.concat(f.observed), Buffer.concat(f.responses));
  assert.deepEqual(
    f.starts,
    Array(2).fill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-codex-safety-buffering-enabled': 'true' },
    }),
  );
  await assert.rejects(f.proxy.relay(f.request, f.downstream), { message: 'RESPONSES_BUDGET' });
  assert.equal(f.sent(), 2);
  f.proxy.revoke();
});
Then('the Responses proxy rejects {string} before upstream access', async function (kind: string) {
  const f = fixture();
  const r = f.request;
  const value = body();
  switch (kind) {
    case 'wrong method':
      r.method = 'GET';
      break;
    case 'wrong route':
      r.path += '?url=other';
      break;
    case 'wrong token':
      r.token = 'incorrect';
      break;
    case 'other run': {
      const other = fixture();
      r.token = other.proxy.token;
      other.proxy.revoke();
      break;
    }
    case 'revoked run':
      f.proxy.revoke();
      break;
    case 'other model':
      value.model = 'another';
      break;
    case 'duplicate model':
      r.body = Buffer.from('{"model":"other",' + JSON.stringify(value).slice(1));
      break;
    case 'store true':
      value.store = true;
      break;
    case 'stream false':
      value.stream = false;
      break;
    case 'hosted tool':
      value.tools[0]!.type = 'web_search';
      break;
    case 'hosted input tool':
      r.body = Buffer.from(
        JSON.stringify({ ...value, input: [{ type: 'additional_tools', tools: [{ type: 'mcp' }] }] }),
      );
      break;
    case 'bytes':
      r.body = Buffer.alloc(10001);
      break;
    default:
      assert.fail();
  }
  if (['other model', 'store true', 'stream false', 'hosted tool'].includes(kind))
    r.body = Buffer.from(JSON.stringify(value));
  await assert.rejects(f.proxy.relay(r, f.downstream), /^Error: RESPONSES_/);
  assert.equal(f.sent(), 0);
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.log, []);
  f.proxy.revoke();
});
Then(
  'the host records {string} as {string} and refuses another dispatch',
  async function (kind: string, result: string) {
    const f = fixture(kind);
    const run = () => f.proxy.relay(f.request, f.downstream);
    if (result.startsWith('RESPONSES_')) await assert.rejects(run(), { message: result });
    else assert.equal((await run()).terminal, result);
    assert.equal(f.log.length, 1);
    assert.equal(
      f.log[0]!.terminal,
      kind === 'token excess' ? 'completed' : result.startsWith('RESPONSES_') ? 'interrupted' : result,
    );
    await assert.rejects(run(), { message: 'RESPONSES_TOKEN' });
    assert.equal(f.sent(), 1);
  },
);

Then('the proxy observes the {string} fixture as {string}', async function (kind: string, expected: string) {
  const event = (type: string, status: string, usage: unknown, label = type) =>
    'event: ' + label + '\ndata: ' + JSON.stringify({ type, response: { model, status, usage } }) + '\n\n';
  const usage = { input_tokens: 3, output_tokens: 2, total_tokens: 5 };
  const ok = event('response.completed', 'completed', usage);
  const cases: Record<string, string | Buffer> = {
    'named completed': ok,
    'both terminal events': ok + ok,
    'label mismatch': event('response.failed', 'failed', usage, 'response.completed'),
    'payload mismatch': event('response.completed', 'failed', usage),
    'named malformed': 'event: response.completed\ndata: malformed\n\n' + ok,
    'failed without usage': event('response.failed', 'failed', null),
    'incomplete without usage': event('response.incomplete', 'incomplete', undefined),
    'completed without usage': event('response.completed', 'completed', undefined),
    'invalid UTF8': Buffer.concat([Buffer.from('data: '), Buffer.from([255]), Buffer.from('\n\n' + ok)]),
    'trailing invalid UTF8': Buffer.concat([Buffer.from(ok), Buffer.from([0xc3])]),
    'interrupted body': '',
    'orphan terminal bytes': ok.trimEnd(),
    'unknown extension':
      'event: vendor.future\ndata: opaque signature\n\ndata: [DONE]\n\ndata: null\n\n' + ok,
  };
  const raw = Buffer.from(cases[kind]!);
  const receipts: ResponseReceipt[] = [];
  const response =
    kind === 'interrupted body'
      ? new ReadableStream<Uint8Array>({
          pull(c) {
            c.error(Error('cut'));
          },
        })
      : new Uint8Array(raw);
  const proxy = new ResponsesProxy(
    model,
    { tokens: 5, bytes: 65536, requests: 1, seconds: 5 },
    async () => 'fixture',
    (r) => receipts.push(r),
    async () => new Response(response, { headers: { 'content-type': ' text/event-stream ; charset=utf-8' } }),
  );
  const f = fixture();
  f.proxy.revoke();
  const attempt = proxy.relay({ ...f.request, token: proxy.token }, f.downstream);
  if (expected === 'interrupted') await assert.rejects(attempt, { message: 'RESPONSES_STREAM' });
  else assert.equal((await attempt).terminal, expected);
  assert.deepEqual(receipts, [
    {
      model,
      request: 1,
      terminal: expected,
      inputTokens: expected === 'completed' ? 3 : null,
      outputTokens: expected === 'completed' ? 2 : null,
    },
  ]);
  if (expected !== 'interrupted') assert.deepEqual(Buffer.concat(f.observed), raw);
  proxy.revoke();
});

Then('the proxy enforces the {string} limit with an upstream witness', async function (kind: string) {
  const raw = Buffer.from(terminal('completed'));
  const fixtureRequest = Buffer.from(JSON.stringify(body()));
  const both = fixtureRequest.length + raw.length;
  const budget = {
    requests: kind === 'requests' ? 1 : 3,
    tokens: kind === 'tokens' ? 5 : 20,
    bytes: kind === 'total bytes' ? both : kind === 'request bytes' ? fixtureRequest.length : both * 3,
    seconds: kind === 'deadline' ? 1 : 5,
  };
  const receipts: ResponseReceipt[] = [];
  let requests = 0,
    grants = 0;
  let ready!: () => void, resume!: () => void;
  const staged = new Promise<void>((done) => {
    ready = done;
  });
  const permission = new Promise<void>((done) => {
    resume = done;
  });
  const proxy = new ResponsesProxy(
    model,
    budget,
    async () => {
      grants++;
      if (kind === 'concurrent') {
        ready();
        await permission;
      }
      if (kind === 'revoke during access') proxy.revoke();
      return 'fixture';
    },
    (r) => receipts.push(r),
    async (_url, init) => {
      requests++;
      assert.equal(init?.cache, 'no-store');
      if (kind === 'revoke during fetch') proxy.revoke();
      return new Response(new Uint8Array(raw), { headers: { 'content-type': 'text/event-stream' } });
    },
  );
  const request = {
    method: 'POST',
    path: '/v1/responses',
    token: proxy.token,
    headers: {},
    body: fixtureRequest,
  };
  let started = 0,
    written = 0;
  const down = {
    start: async () => {
      started++;
      if (kind === 'revoke during stream') proxy.revoke();
    },
    write: async () => {
      written++;
      if (kind === 'revoke at EOF') proxy.revoke();
    },
  };
  const run = () => proxy.relay(request, down);
  try {
    if (kind === 'invalid budget') {
      for (const field of Object.keys(budget))
        for (const invalid of [0, -1, 1.5, Infinity]) {
          assert.throws(
            () =>
              new ResponsesProxy(
                model,
                { ...budget, [field]: invalid },
                async () => '',
                () => {},
              ),
            { message: 'RESPONSES_BUDGET' },
          );
        }
    } else if (kind === 'deadline') {
      await new Promise((done) => setTimeout(done, 1050));
      await assert.rejects(run(), { message: 'RESPONSES_TOKEN' });
      assert.equal(grants, 0);
    } else if (kind.startsWith('revoke ')) {
      await assert.rejects(run(), { message: 'RESPONSES_STREAM' });
      assert.equal(grants, 1);
      assert.equal(requests, kind === 'revoke during access' ? 0 : 1);
      assert.equal(receipts[0]?.terminal, 'interrupted');
      assert.equal(started, ['revoke during access', 'revoke during fetch'].includes(kind) ? 0 : 1);
      assert.equal(written, kind === 'revoke at EOF' ? 1 : 0);
    } else if (kind === 'concurrent') {
      const first = run();
      await staged;
      await assert.rejects(run(), { message: 'RESPONSES_BUDGET' });
      resume();
      await first;
      assert.equal(requests, 1);
      assert.equal(grants, 1);
    } else if (kind === 'request bytes') {
      await assert.rejects(
        proxy.relay({ ...request, body: Buffer.concat([fixtureRequest, Buffer.from(' ')]) }, down),
        { message: 'RESPONSES_BUDGET' },
      );
      assert.equal(grants, 0);
      await assert.rejects(run(), { message: 'RESPONSES_STREAM' });
      assert.equal(requests, 1);
    } else {
      assert.equal((await run()).terminal, 'completed');
      await assert.rejects(run(), { message: 'RESPONSES_BUDGET' });
      assert.equal(requests, 1);
      assert.equal(grants, 1);
    }
  } finally {
    resume();
    proxy.revoke();
  }
});
Then('the host forwards namespaced custom tools and escaped JSON input', async function () {
  const f = fixture();
  try {
    const request = {
      ...body(),
      tools: [{ type: 'namespace', name: 'agent', tools: [{ type: 'custom', name: 'patch' }] }],
      input: [
        null,
        'literal',
        { type: 'additional_tools', tools: [{ type: 'function', name: 'shell' }] },
        { role: 'user', content: 'quoted "this": "that"' },
      ],
    };
    const native = Buffer.from(JSON.stringify(request));
    assert.equal((await f.proxy.relay({ ...f.request, body: native }, f.downstream)).terminal, 'completed');
    assert.deepEqual(Buffer.from(f.requests[0]!), native);
  } finally {
    f.proxy.revoke();
  }
});
Then('the host refuses an invalid UTF-8 request before retrieving the account token', async function () {
  const f = fixture();
  const buf = Buffer.from(JSON.stringify(body()));
  buf[buf.indexOf('edit')] = 255;
  await assert.rejects(f.proxy.relay({ ...f.request, body: buf }, f.downstream), {
    message: 'RESPONSES_BODY',
  });
  assert.equal(f.sent(), 0);
  f.proxy.revoke();
});
Then('a response with {string} is refused and its source is disposed', async function (kind: string) {
  let cancelled = 0;
  const f = fixture();
  f.proxy.revoke();
  const proxy = new ResponsesProxy(
    model,
    { requests: 1, bytes: 65536, tokens: 5, seconds: 5 },
    async () => 'fixture',
    () => {},
    async () =>
      new Response(
        kind === 'empty body'
          ? null
          : new ReadableStream({
              cancel() {
                cancelled++;
              },
            }),
        kind === 'empty body' ? { headers: { 'content-type': 'text/event-stream' } } : undefined,
      ),
  );
  await assert.rejects(proxy.relay({ ...f.request, token: proxy.token }, f.downstream), {
    message: 'RESPONSES_STREAM',
  });
  assert.deepEqual(f.starts, []);
  assert.equal(cancelled, kind === 'empty body' ? 0 : 1);
});
