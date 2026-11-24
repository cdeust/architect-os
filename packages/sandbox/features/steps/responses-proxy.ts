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
