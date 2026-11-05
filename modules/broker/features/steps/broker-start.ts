import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { configFile, serve, start, type StartedBroker } from '../../src/main.js';
import { BrokerConfigSchema, loadBrokerConfig, parseBrokerConfig } from '../../src/infrastructure/config.js';
import { stdioTransport } from '../../src/presentation/mcp-server.js';
import { BROKER_JSON, gatewayClient, keyFile, send, stdioPair, testConfig } from './harness.js';
import { Given, Then, When, slot, type BrokerWorld } from './helpers.js';

const TOKEN = 'tok_startstartstartstartstartstartstart';
/** The repository root: the broker process runs from there, as the gateway would run it. */
const ROOT = new URL('../../../../', import.meta.url).pathname;

class StartScenario {
  key = '';
  started: StartedBroker | undefined;
  failure: (Error & { code?: string }) | undefined;
  pair: ReturnType<typeof stdioPair> | undefined;
  config = '';
  port = 0;
  served: Promise<number> | undefined;
  stdin: PassThrough | undefined;
  stderr = '';
  client: Client | undefined;
  usage: unknown[] = [];
  raw: Record<string, unknown> = {};
}
const scenario = (world: BrokerWorld) => slot(world, 'broker-start', () => new StartScenario());

/** A port free at this instant. */
const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

const KEYS: Record<string, { content: string; mode: number } | 'directory'> = {
  'readable by its group': { content: 'sk-test', mode: 0o640 },
  'readable by all': { content: 'sk-test', mode: 0o644 },
  empty: { content: '  \n', mode: 0o600 },
  'two words': { content: 'sk-test other', mode: 0o600 },
  'a directory': 'directory',
  'readable by its owner only, read-only': { content: 'sk-test', mode: 0o400 },
  'a valid one': { content: 'sk-test', mode: 0o600 },
  'ended by a newline': { content: 'sk-test\n', mode: 0o600 },
};

function makeKey(world: BrokerWorld, kind: string): string {
  const spec = KEYS[kind];
  assert.ok(spec !== undefined, `no key file named "${kind}"`);
  if (spec === 'directory') {
    const dir = mkdtempSync(join(tmpdir(), 'aos-broker-keydir-'));
    world.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }
  const file = keyFile(spec.content, spec.mode);
  world.cleanups.push(file.remove);
  return file.file;
}

Given('a key file that is {}', function (kind: string) {
  scenario(this).key = makeKey(this, kind);
});

async function startWith(world: BrokerWorld, port: number) {
  const s = scenario(world);
  const pair = stdioPair();
  s.pair = pair;
  try {
    s.started = await start(
      testConfig('https://upstream.invalid', s.key),
      stdioTransport(pair.stdin, pair.stdout),
      port,
    );
    world.cleanups.push(() => s.started?.close());
  } catch (error) {
    s.failure = error as Error & { code?: string };
  }
}

When('I start a broker with that key file', async function () {
  await startWith(this, 0);
});

When('I start a broker with that key file on a port already taken', async function () {
  const taken = createServer();
  await new Promise<void>((listening) => taken.listen(0, '127.0.0.1', listening));
  this.cleanups.push(() => new Promise<void>((closed) => taken.close(() => closed())));
  await startWith(this, (taken.address() as { port: number }).port);
});

Then('the start is refused with {string}', function (message: string) {
  const s = scenario(this);
  assert.equal(s.failure?.message, message.replace('KEY', s.key));
});

Then('the start is refused with code {string}', function (code: string) {
  assert.equal(scenario(this).failure?.code, code);
});

Then('the broker started', function () {
  const s = scenario(this);
  assert.deepEqual([s.failure, s.started?.relay.port !== undefined], [undefined, true]);
});

Then("the broker's MCP server no longer answers on its stdio", async function () {
  const answered = await Promise.race([
    gatewayClient(scenario(this).pair?.client as never).then(() => true),
    new Promise<boolean>((silent) => setTimeout(() => silent(false), 300)),
  ]);
  assert.equal(answered, false);
});

/** A configuration file: the committed broker.json over a free port and a key file of the given kind. */
async function configWith(world: BrokerWorld, kind: string) {
  const s = scenario(world);
  const dir = mkdtempSync(join(tmpdir(), 'aos-broker-config-'));
  world.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  s.key = makeKey(world, kind);
  s.port = await freePort();
  const raw = JSON.parse(JSON.stringify(loadBrokerConfig(BROKER_JSON))) as Record<string, unknown>;
  s.config = join(dir, 'broker.json');
  writeFileSync(s.config, JSON.stringify({ ...raw, keyFile: s.key, port: s.port }));
}

Given('a broker configuration file with a valid key file and a free port', async function () {
  await configWith(this, 'a valid one');
});

Given('a broker configuration file with a key file readable by all', async function () {
  await configWith(this, 'readable by all');
});

When('I serve the broker with that configuration over a pair of streams', async function () {
  const s = scenario(this);
  const pair = stdioPair();
  const stderr = new PassThrough();
  stderr.on('data', (chunk: Buffer) => (s.stderr += chunk.toString('utf8')));
  s.stdin = pair.stdin;
  s.served = serve({ BROKER_CONFIG: s.config }, pair.stdin, pair.stdout, stderr);
  this.cleanups.push(async () => {
    pair.stdin.end();
    await s.served;
  });
  // A broker that started answers its gateway; one that did not has already given its code.
  const outcome = await Promise.race([s.served, gatewayClient(pair.client)]);
  if (typeof outcome !== 'number') Object.assign(s, outcome);
});

When('I serve the broker with that configuration over a stdin that ends at once', function () {
  const s = scenario(this);
  const pair = stdioPair();
  // The stdin ends before the broker has listened: its 'end' is gone when serve would wait for it.
  pair.stdin.end();
  s.served = serve({ BROKER_CONFIG: s.config }, pair.stdin, pair.stdout, new PassThrough());
  this.cleanups.push(async () => {
    await s.served;
  });
});

/** The worker spends the granted token once, on the broker of the scenario's configuration (the upstream is unreachable). */
async function spend(world: BrokerWorld) {
  const s = scenario(world);
  const client = s.client;
  assert.ok(client !== undefined, 'no gateway connected');
  const granted = await client.callTool({
    name: 'token_grant',
    arguments: { token: TOKEN, task: 'task-s', parent: 'call-s' },
  });
  assert.equal(granted.isError, undefined);
  // The policy refuses this body before any upstream: one record, no network.
  const answer = await send(s.port, 'POST', '/v1/messages', { 'x-api-key': TOKEN }, '{"mcp_servers":[]}');
  assert.equal(answer.status, 403);
}

When('the gateway grants a token over those streams and the worker spends it', async function () {
  await spend(this);
});

const recordOfSpending = async (world: BrokerWorld) => {
  await new Promise((settled) => setTimeout(settled, 50));
  const [record] = scenario(world).usage as Record<string, unknown>[];
  assert.deepEqual(
    [scenario(world).usage.length, record?.['task'], record?.['parent'], record?.['error_type']],
    [1, 'task-s', 'call-s', 'refused_by_policy'],
  );
};

Then('the gateway got the usage record of that spending over those streams', async function () {
  await recordOfSpending(this);
});

When("the gateway ends the broker's stdin", function () {
  scenario(this).stdin?.end();
});

const refuses = (port: number) =>
  send(port, 'POST', '/v1/messages', {}).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === 'ECONNREFUSED',
  );

Then('serve of the broker gives 0 and its port refuses connections', async function () {
  const s = scenario(this);
  assert.equal(await s.served, 0);
  assert.equal(await refuses(s.port), true);
});

Then('serve of the broker gives {int} and wrote {string}', async function (code: number, line: string) {
  const s = scenario(this);
  assert.deepEqual([await s.served, s.stderr], [code, `${line.replace('KEY', s.key)}\n`]);
});

Then('the configuration file of the environment {string} is {string}', function (pair: string, file: string) {
  const [name, value] = pair.split('=') as [string, string];
  assert.equal(configFile({ [name]: value }), file);
});

Then('the configuration file of an empty environment is the committed broker.json', function () {
  assert.equal(configFile({}), BROKER_JSON);
});

When('the gateway launches the broker process with that configuration', async function () {
  const s = scenario(this);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'modules/broker/src/serve.ts'],
    cwd: ROOT,
    env: { BROKER_CONFIG: s.config, TSX_TSCONFIG_PATH: join(ROOT, 'features/tsconfig.json') },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => (s.stderr += chunk.toString('utf8')));
  const { client, usage } = await gatewayClient(transport);
  Object.assign(s, { client, usage });
  this.cleanups.push(() => client.close());
});

When('the gateway grants a token to the process and the worker spends it', async function () {
  await spend(this);
});

Then('the gateway got the usage record of that spending from the process', async function () {
  await recordOfSpending(this);
  assert.equal(scenario(this).stderr, '');
});

When('the gateway closes the broker process', async function () {
  await scenario(this).client?.close();
});

Then('the port of the broker process refuses connections', async function () {
  const s = scenario(this);
  let refused = await refuses(s.port);
  for (let tries = 0; tries < 50 && !refused; tries++) {
    await new Promise((settled) => setTimeout(settled, 100));
    refused = await refuses(s.port);
  }
  assert.equal(refused, true);
});

Given('the committed broker.json', function () {
  // The file as committed, `${home}` unresolved: the schema alone, not the loader.
  const raw = JSON.parse(readFileSync(BROKER_JSON, 'utf8')) as Record<string, unknown>;
  BrokerConfigSchema.parse(raw);
  scenario(this).raw = raw;
});

Then(
  'it relays to {string} on port {int} the routes {string}',
  function (upstream: string, port: number, route: string) {
    const raw = scenario(this).raw;
    assert.deepEqual([raw['upstream'], raw['port'], raw['routes']], [upstream, port, [route]]);
  },
);

Then('its key file is under the home directory', function () {
  const config = loadBrokerConfig(BROKER_JSON);
  assert.ok(config.keyFile.startsWith(`${homedir()}/`), config.keyFile);
  assert.ok(!config.keyFile.includes('${home}'));
});

Then(
  'a copy where {word} is {} is accepted with the betas {}',
  function (field: string, value: string, betas: string) {
    const copy = { ...scenario(this).raw, [field]: JSON.parse(value) as unknown };
    assert.deepEqual(parseBrokerConfig(copy).betas, JSON.parse(betas));
  },
);

Then('a copy where {word} is {} is rejected', function (field: string, value: string) {
  const copy = { ...scenario(this).raw, [field]: JSON.parse(value) as unknown };
  assert.throws(() => parseBrokerConfig(copy));
});
