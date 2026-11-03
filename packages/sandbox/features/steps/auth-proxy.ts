import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DataTable } from '@cucumber/cucumber';
import { startAuthProxy, type AuthProxy } from '../../src/auth-proxy.js';
import { Given, Then, When, assertMatches, stored, type SandboxWorld } from './helpers.js';

/** Faux amont : enregistre méthode, chemin et en-têtes, répond en SSE avec un `usage`. */
interface Seen {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders;
  body?: string;
}
const SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"model":"claude-test","content":[],"usage":{"input_tokens":12,"cache_read_input_tokens":3,"cache_creation_input_tokens":2,"output_tokens":1}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"SECRET-CONTENT"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","usage":{"output_tokens":7}}',
  '',
].join('\n');

/** Everything one proxy scenario shares; `proxy` is replaced when a step restarts it. */
interface ProxyScenario {
  seen: Seen[];
  proxy: AuthProxy | undefined;
  dir: string;
  token: string;
  response?: { status: number; text: string; headers?: IncomingHttpHeaders };
}
const scenario = (world: SandboxWorld) => stored<ProxyScenario>(world, 'proxy');
const running = (s: ProxyScenario): AuthProxy => {
  assert.ok(s.proxy, 'the auth proxy is not started');
  return s.proxy;
};

/** Under a folder the proxy creates, so that the folder's mode is the proxy's. */
const usageLogPath = (s: ProxyScenario) => join(s.dir, 'state', 'architect-os', 'usage.jsonl');

const ROUTES = ['^/v1/messages/count_tokens$', '^/v1/messages(\\?[^#]*)?$'];
const POLICY = { bodyFields: ['model', 'messages', 'system', 'tools'], maxBodyBytes: 256 };

Given('a fake upstream answering with a server-sent-events stream that carries a usage', async function () {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-proxy-')));
  const seen: Seen[] = [];
  // `?json` answers a JSON message; `?break` cuts its answer after the headers; `?hold` never answers.
  const upstream: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const url = req.url ?? '';
      if (url.includes('hold')) return;
      if (url.includes('json')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"model":"claude-json","content":[],"usage":{"input_tokens":4,"output_tokens":2}}');
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-request-id': 'r1',
        te: 'trailers',
        'proxy-connection': 'x',
        upgrade: 'h2c',
        authorization: 'Bearer upstream-only',
        'accept-encoding': 'gzip',
        connection: 'close',
      });
      if (url.includes('break')) {
        res.write(SSE.slice(0, 40));
        return setTimeout(() => res.socket?.destroy(), 20);
      }
      res.end(SSE);
    });
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  this.state['upstream'] = (upstream.address() as AddressInfo).port;
  this.state['proxy'] = { seen, dir, token: '', proxy: undefined } satisfies ProxyScenario;
  // Run last-in first-out: the proxy (registered later) closes before its upstream, then the folder goes.
  this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  this.cleanups.push(
    () =>
      new Promise<void>((done) => {
        upstream.closeAllConnections();
        upstream.close(() => done());
      }),
  );
});

Given(
  'an auth proxy over that upstream with the session token {string} and the host credential {string}',
  async function (token: string, credential: string) {
    const s = scenario(this);
    s.token = token;
    s.proxy = await startAuthProxy({
      upstream: `http://127.0.0.1:${stored<number>(this, 'upstream')}`,
      routes: ROUTES,
      betas: ['oauth-2025-04-20'],
      policy: POLICY,
      sessionToken: token,
      credential: async () => ({ accessToken: credential }),
      usageLog: usageLogPath(s),
    });
    this.cleanups.push(() => running(s).close());
  },
);

Given(
  'the proxy is restarted with a host credential that fails with {string}',
  async function (detail: string) {
    const s = scenario(this);
    await running(s).close();
    s.proxy = await startAuthProxy({
      upstream: 'http://127.0.0.1:9',
      routes: ['^/v1/messages$'],
      betas: [],
      policy: POLICY,
      sessionToken: s.token,
      credential: async () => {
        throw new Error(detail);
      },
    });
  },
);

Given('the proxy is restarted without required betas', async function () {
  const s = scenario(this);
  await running(s).close();
  s.proxy = await startAuthProxy({
    upstream: `http://127.0.0.1:${stored<number>(this, 'upstream')}`,
    routes: ROUTES,
    betas: [],
    policy: POLICY,
    sessionToken: s.token,
    credential: async () => ({ accessToken: 'host-credential' }),
  });
});

Given('the proxy is restarted over an upstream that refuses connections', async function () {
  const s = scenario(this);
  await running(s).close();
  s.proxy = await startAuthProxy({
    upstream: 'http://127.0.0.1:9',
    routes: ROUTES,
    betas: [],
    policy: POLICY,
    sessionToken: s.token,
    credential: async () => ({ accessToken: 'host-credential' }),
  });
});

When('I POST a body of {int} bytes through the proxy', async function (size: number) {
  await send(this, '/v1/messages', { body: `{"model":"${'m'.repeat(size - 12)}"}` }, scenario(this).token);
});

/** node:http, not fetch: fetch refuses to set the hop-by-hop headers these scenarios need. */
When('I POST through the proxy with the raw headers:', async function (table: DataTable) {
  const s = scenario(this);
  const headers = Object.fromEntries(table.raw() as [string, string][]);
  s.response = await new Promise((done, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: running(s).port,
        path: '/v1/messages',
        method: 'POST',
        headers: { authorization: `Bearer ${s.token}`, ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => done({ status: res.statusCode ?? 0, text, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
});

Then('the proxy response has the header {string} {string}', function (name: string, value: string) {
  assert.equal(scenario(this).response?.headers?.[name], value);
});

Then('the proxy response has no header {string}', function (name: string) {
  assert.equal(scenario(this).response?.headers?.[name], undefined);
});

Then('the proxy response body is exactly:', function (expected: string) {
  assert.equal(scenario(this).response?.text, expected);
});

/** POST (or `init.method`) through the proxy and keep status and whole body. */
async function send(
  world: SandboxWorld,
  path: string,
  init: RequestInit,
  token: string | null,
): Promise<void> {
  const s = scenario(world);
  const headers: Record<string, string> = {};
  if (token !== null)
    Object.assign(headers, { authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const res = await fetch(`http://127.0.0.1:${running(s).port}${path}`, {
    method: 'POST',
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  const headersOut = Object.fromEntries(res.headers);
  s.response = { status: res.status, text: await res.text(), headers: headersOut };
}

When('I POST through the proxy {string} with the body {string}', async function (path: string, body: string) {
  await send(this, path, { body }, scenario(this).token);
});

When(
  'I POST through the proxy {string} with the body {string} and the headers:',
  async function (path: string, body: string, table: DataTable) {
    await send(
      this,
      path,
      { body, headers: Object.fromEntries(table.raw() as [string, string][]) },
      scenario(this).token,
    );
  },
);

When(
  'I POST through the proxy {string} with the body {string} and the session token {string}',
  async function (path: string, body: string, token: string) {
    await send(this, path, { body }, token);
  },
);

When(
  'I POST through the proxy {string} with the body {string} and no authorization',
  async function (path: string, body: string) {
    await send(this, path, { body, headers: {} }, null);
  },
);

When('I send {string} to {string} through the proxy', async function (method: string, path: string) {
  await send(this, path, method === 'GET' ? { method } : { method, body: '{}' }, scenario(this).token);
});

When('the session token is revoked', function () {
  running(scenario(this)).revoke();
});

const response = (world: SandboxWorld) => {
  const r = scenario(world).response;
  assert.ok(r, 'no request was sent');
  return r;
};

Then('the proxy response status is {int}', function (status: number) {
  assert.equal(response(this).status, status);
});

Then('the proxy response body is the upstream stream', function () {
  assert.equal(response(this).text, SSE);
});

Then('the proxy response body does contain {string}', function (text: string) {
  assert.ok(response(this).text.includes(text), response(this).text);
});

Then("the upstream request {int} has the upstream's host", function (i: number) {
  assert.equal(scenario(this).seen[i]?.headers?.['host'], `127.0.0.1:${stored<number>(this, 'upstream')}`);
});

Then('the upstream received {int} request(s)', function (count: number) {
  assert.equal(scenario(this).seen.length, count);
});

Then('the upstream received no request', function () {
  assert.deepEqual(scenario(this).seen, []);
});

Then('the upstream request {int} has the url {string}', function (i: number, url: string) {
  assert.equal(scenario(this).seen[i]?.url, url);
});

Then('the upstream request {int} has the body {string}', function (i: number, body: string) {
  assert.equal(scenario(this).seen[i]?.body, body);
});

Then(
  'the upstream request {int} has the header {string} {string}',
  function (i: number, name: string, value: string) {
    assert.equal(scenario(this).seen[i]?.headers?.[name], value);
  },
);

Then('the upstream request {int} has no header {string}', function (i: number, name: string) {
  assert.equal(scenario(this).seen[i]?.headers?.[name], undefined);
});

const usageLog = (world: SandboxWorld) => readFileSync(usageLogPath(scenario(world)), 'utf8');

Then('the usage log holds one record matching:', function (json: string) {
  const record = JSON.parse(usageLog(this).trim()) as Record<string, unknown>;
  assertMatches(record, JSON.parse(json));
  this.state['usageRecord'] = record;
});

Then('the usage record has a string {string}', function (key: string) {
  assert.equal(typeof stored<Record<string, unknown>>(this, 'usageRecord')[key], 'string');
});

Then('the usage log does not contain {string}', function (text: string) {
  assert.ok(!usageLog(this).includes(text));
});

Then('the upstream request {int} has the method {string}', function (i: number, method: string) {
  assert.equal(scenario(this).seen[i]?.method, method);
});

Then(
  'the proxy response is a {string} whose message contains {string}',
  function (type: string, text: string) {
    const { error } = JSON.parse(response(this).text) as { error: { type: string; message: string } };
    assert.equal(error.type, type);
    assert.ok(error.message.includes(text), error.message);
  },
);

Given('the proxy is restarted over the upstream addressed as https', async function () {
  const s = scenario(this);
  await running(s).close();
  s.proxy = await startAuthProxy({
    upstream: `https://127.0.0.1:${stored<number>(this, 'upstream')}`,
    routes: ROUTES,
    betas: [],
    policy: POLICY,
    sessionToken: s.token,
    credential: async () => ({ accessToken: 'host-credential' }),
  });
});

Then('the usage log has the mode 600 and its folder the mode 700', function () {
  const file = usageLogPath(scenario(this));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
});

/** Resolves with the connection error, or null when the connection was accepted. */
const connectError = (host: string, port: number): Promise<string | null> =>
  new Promise((done) => {
    const socket = connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      done(null);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code ?? error.message));
  });

Then('the proxy refuses a connection on {}', async function (host: string) {
  assert.notEqual(await connectError(host, running(scenario(this)).port), null);
});

When(
  'I POST through the proxy {string} with the body {string} and the answer breaks',
  async function (path: string, body: string) {
    const s = scenario(this);
    const res = await fetch(`http://127.0.0.1:${running(s).port}${path}`, {
      method: 'POST',
      body,
      headers: { authorization: `Bearer ${s.token}` },
    });
    this.state['cut'] = await res.text().then(
      () => false,
      () => true,
    );
  },
);

Then('the proxy answer was cut', function () {
  assert.equal(stored<boolean>(this, 'cut'), true);
});

When(
  'I POST through the proxy {string} with the body {string} without waiting',
  async function (path: string, body: string) {
    const s = scenario(this);
    this.state['inFlight'] = fetch(`http://127.0.0.1:${running(s).port}${path}`, {
      method: 'POST',
      body,
      headers: { authorization: `Bearer ${s.token}` },
    }).then(
      (res) => res.text().then(() => 'answered'),
      () => 'cut',
    );
    for (let i = 0; i < 100 && s.seen.length === 0; i++) await new Promise((done) => setTimeout(done, 20));
  },
);

Then('the proxy closes within {int} ms', async function (ms: number) {
  const closed = running(scenario(this))
    .close()
    .then(() => 'closed');
  const late = new Promise((done) => setTimeout(() => done('late'), ms));
  assert.equal(await Promise.race([closed, late]), 'closed');
});

Then('the request in flight was cut', async function () {
  assert.equal(await stored<Promise<string>>(this, 'inFlight'), 'cut');
});

Then('starting a proxy whose usage log is under a file fails', async function () {
  const s = scenario(this);
  const file = join(s.dir, 'a-file');
  writeFileSync(file, '');
  await assert.rejects(
    startAuthProxy({
      upstream: `http://127.0.0.1:${stored<number>(this, 'upstream')}`,
      routes: ROUTES,
      betas: [],
      policy: POLICY,
      sessionToken: s.token,
      credential: async () => ({ accessToken: 'host-credential' }),
      usageLog: join(file, 'usage.jsonl'),
    }),
  );
});

Given('the usage log can no longer be written', function () {
  const file = usageLogPath(scenario(this));
  rmSync(file, { force: true });
  mkdirSync(file);
});
