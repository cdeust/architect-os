import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { keyFile } from '../../modules/broker/features/steps/harness.js';
import { pinnedImage } from '../../packages/sandbox/features/steps/rootless-image.js';
import { startFakeModel, type FakeModel } from '../support/fake-model.js';
import { BROKER_KEY, ROOT } from '../support/srt-platform.js';
import { selfSigned } from '../support/tls.js';
import type { ArchitectWorld } from '../support/world.js';
import { Given, Then, When } from './helpers.js';

/** What the process runs, built by tsc -b before the suite (npm test, the gate). */
const BUILT = [
  'gateway/dist/src/serve.js',
  'data/dist/src/serve-mcp.js',
  'modules/broker/dist/src/serve.js',
  'modules/memory/dist/src/serve.js',
  'services/memory/dist/worker/task-serve.js',
];
/** A client token of the scenario: never a real one. */
const TOKEN = 'token-of-the-entry-scenario-0123456789abcdef';
const SUBJECT = 'alice';

interface Entry {
  child: ChildProcess;
  port: number;
  brokerPort: number;
  model: FakeModel;
  stdout: string;
  stderr: string;
  ended: Promise<{ code: number | null; signal: string | null }>;
  over: boolean;
  answer?: { isError: boolean; structured?: Record<string, unknown>; text: string };
  /** The id of the memory the first call wrote. */
  memory?: string;
}
const entryOf = (world: ArchitectWorld): Entry => {
  const entry = world.state['gateway-entry'] as Entry | undefined;
  assert.ok(entry, 'the gateway process must be started first');
  return entry;
};

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** What a connection to a loopback port meets: `connected`, or the code of its refusal. */
const reach = (port: number): Promise<string> =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => (socket.destroy(), resolve('connected')));
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(String(error.code)));
  });

/** What the two calls of the scenario make the fake model do. */
interface Script {
  content: string;
  tags: string;
  query: string;
  output: string;
}

/**
 * Starts the process on the built entry file, before a fake model over HTTPS, with `sandbox` as the variables of its
 * means of isolation, and waits until it serves.
 */
async function startEntry(
  world: ArchitectWorld,
  { content, tags, query, output }: Script,
  sandbox: Record<string, string | undefined>,
  until: 'it serves' | 'it ends' = 'it serves',
): Promise<void> {
  for (const file of BUILT)
    if (!existsSync(join(ROOT, file))) throw new Error(`${file} is built by tsc -b before the suite`);
  const dir = mkdtempSync(join(tmpdir(), 'gateway-entry-'));
  world.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const tls = selfSigned(dir);
  // One script for the two calls: each worker asks the model twice, a tool then its structured output.
  const model = await startFakeModel(
    [
      { tool: 'mcp__platform__memory_insert', input: { content, tags: tags.split(',') } },
      {
        tool: 'StructuredOutput',
        inputFrom: (result) => ({ memory_id: (/"id"\s*:\s*"([^"]+)"/.exec(result) ?? [])[1] }),
      },
      { tool: 'mcp__platform__memory_search', input: { query, limit: 5 } },
      { tool: 'StructuredOutput', input: JSON.parse(output) },
    ],
    { tls },
  );
  world.cleanups.push(() => model.close());
  const key = keyFile(BROKER_KEY);
  world.cleanups.push(() => key.remove());
  const port = await freePort();
  const brokerPort = await freePort();
  const brokerConfig = join(dir, 'broker.json');
  const committed = JSON.parse(
    readFileSync(join(ROOT, 'modules', 'broker', 'broker.json'), 'utf8'),
  ) as object;
  writeFileSync(
    brokerConfig,
    JSON.stringify({ ...committed, upstream: model.url, port: brokerPort, keyFile: key.file }),
  );
  // The process is given its configuration and nothing else of this environment.
  const child = spawn(process.execPath, [join(ROOT, 'gateway', 'dist', 'src', 'serve.js')], {
    env: {
      GATEWAY_TOKENS: `${TOKEN}=${SUBJECT}`,
      GATEWAY_PORT: String(port),
      GATEWAY_QUOTA_PER_MINUTE: '100',
      GATEWAY_PROFILE: 'owner',
      ...sandbox,
      BROKER_CONFIG: brokerConfig,
      DATABASE_URL: 'memory',
      NODE_EXTRA_CA_CERTS: tls.certFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entry: Entry = {
    child,
    port,
    brokerPort,
    model,
    stdout: '',
    stderr: '',
    over: false,
    ended: new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal }))),
  };
  child.stdout.on('data', (chunk: Buffer) => (entry.stdout += String(chunk)));
  child.stderr.on('data', (chunk: Buffer) => (entry.stderr += String(chunk)));
  void entry.ended.then(() => (entry.over = true));
  world.cleanups.push(async () => {
    if (!entry.over) child.kill('SIGTERM');
    await entry.ended;
  });
  world.state['gateway-entry'] = entry;
  if (until === 'it ends') return void (await entry.ended);
  // Served once its port answers; a process that ended instead says why on its stderr.
  while ((await reach(port)) !== 'connected') {
    assert.equal(entry.over, false, `the gateway process ended at its start: ${entry.stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

Given(
  'the gateway started by its entry file, with data in memory and the broker before a fake model over HTTPS that inserts the memory {string} tagged {string} and answers with the id it got, then searches the memory for {string} and answers {string}',
  { timeout: 120_000 },
  function (content: string, tags: string, query: string, output: string) {
    return startEntry(this, { content, tags, query, output }, { GATEWAY_SANDBOX: 'srt' });
  },
);

// --- The same process with its module and its workers in containers (rootless/gateway-entry.feature) ---

/** The container of a sandbox of the platform, as the Docker adapter names it. */
const SANDBOX_NAME = /^aos-sandbox-[0-9a-f-]{36}$/;
/** The daemon with root of the host, where there is one: the default socket of Docker. */
const WITH_ROOT = '/var/run/docker.sock';
const docker = (...args: string[]): string[] =>
  execFileSync('docker', args, { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '');

/** A script of the fake model that no scenario of a refused start reaches. */
const UNUSED: Script = { content: 'unused', tags: 'unused', query: 'unused', output: '{}' };

/**
 * What an operator gives the process for the Docker mode: the means and its image, the bounds of a real task (the
 * worker runs the binary of the agent), and what finds the client and its daemon. Nothing else of this environment.
 */
function inContainers(
  world: ArchitectWorld,
  dockerHost: string | undefined,
): Record<string, string | undefined> {
  const { image, node } = pinnedImage();
  // Fractions of a second: a container another scenario started just before is not counted with these.
  world.state['rootless'] = { image, since: (Date.now() / 1000).toFixed(3) };
  return {
    GATEWAY_SANDBOX: 'docker',
    GATEWAY_DOCKER_IMAGE: image,
    GATEWAY_DOCKER_NODE: node,
    GATEWAY_DOCKER_MEMORY_MIB: '2048',
    GATEWAY_DOCKER_PIDS: '512',
    GATEWAY_DOCKER_CHECK_MS: '30000',
    PATH: process.env['PATH'],
    HOME: process.env['HOME'],
    DOCKER_HOST: dockerHost,
  };
}

Given(
  'the gateway started by its entry file with its sandboxes in containers before the rootless daemon of this host, with data in memory and the broker before a fake model over HTTPS that inserts the memory {string} tagged {string} and answers with the id it got, then searches the memory for {string} and answers {string}',
  { timeout: 180_000 },
  function (content: string, tags: string, query: string, output: string) {
    return startEntry(this, { content, tags, query, output }, inContainers(this, process.env['DOCKER_HOST']));
  },
);

When(
  'the gateway is started by its entry file with its sandboxes in containers before the daemon with root of this host, and its end is awaited',
  { timeout: 120_000 },
  function () {
    // A host with a rootless daemon alone has nothing to refuse here.
    if (!existsSync(WITH_ROOT)) return 'skipped';
    return startEntry(this, UNUSED, inContainers(this, `unix://${WITH_ROOT}`), 'it ends');
  },
);

Then(
  'the gateway process ended with the code {int}, its standard error starting with {string}',
  async function (code: number, prefix: string) {
    const entry = entryOf(this);
    assert.deepEqual(await entry.ended, { code, signal: null }, entry.stderr);
    assert.ok(entry.stderr.startsWith(prefix), entry.stderr);
  },
);

Then(
  'the rootless daemon started exactly {int} container(s) of the platform since the gateway process started, each from the image of this repository',
  function (count: number) {
    const { image, since } = this.state['rootless'] as { image: string; since: string };
    // Asked of the daemon itself, not of the gateway: the check at start, the module, and one worker for each call.
    const started = docker(
      'events',
      '--since',
      since,
      '--until',
      String(Math.ceil(Date.now() / 1000) + 1),
      '--filter',
      'type=container',
      '--filter',
      'event=start',
      '--format',
      '{{.Actor.Attributes.name}} {{.Actor.Attributes.image}}',
    ).map((line) => line.split(' ') as [string, string]);
    assert.equal(started.length, count, JSON.stringify(started));
    for (const [name, from] of started) {
      assert.match(name, SANDBOX_NAME);
      assert.equal(from, image);
    }
  },
);

Then(
  'no container of the platform is left on the rootless daemon, and no relay folder under the temporary folder of this host',
  function () {
    assert.deepEqual(
      docker('ps', '-a', '--format', '{{.Names}}').filter((name) => SANDBOX_NAME.test(name)),
      [],
    );
    // The process was given no TMPDIR: its relays lived under the temporary folder of the host, as these do.
    const parent = join(tmpdir(), 'aos-sb');
    assert.deepEqual(
      existsSync(parent) ? readdirSync(parent).filter((name) => name.startsWith('r-')) : [],
      [],
    );
  },
);

async function call(
  world: ArchitectWorld,
  tool: string,
  args: string,
  token: string | undefined,
): Promise<void> {
  const entry = entryOf(world);
  const client = new Client({ name: 'entry-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${entry.port}/mcp`), {
      requestInit: token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  try {
    const result = await client.callTool({ name: tool, arguments: JSON.parse(args) });
    entry.answer = {
      isError: result.isError === true,
      structured: result.structuredContent as Record<string, unknown> | undefined,
      text: (result.content as { text: string }[])[0]?.text ?? '',
    };
  } finally {
    await client.close();
  }
}

When(
  'a client of the gateway process calls {string} with {string}',
  { timeout: 180_000 },
  function (tool: string, args: string) {
    return call(this, tool, args, TOKEN);
  },
);

When(
  'a client of the gateway process calls {string} with {string} and no token',
  { timeout: 60_000 },
  function (tool: string, args: string) {
    return call(this, tool, args, undefined);
  },
);

const okAnswer = (entry: Entry): Record<string, unknown> => {
  const { answer } = entry;
  assert.ok(answer !== undefined && !answer.isError, `${answer?.text}\n${entry.stderr}`);
  assert.equal(answer.structured?.['status'], 'ok', JSON.stringify(answer.structured));
  return answer.structured!;
};

Then('the gateway process answers ok with a memory id', function () {
  const entry = entryOf(this);
  const data = okAnswer(entry)['data'] as { memory_id?: unknown };
  assert.ok(typeof data.memory_id === 'string' && data.memory_id !== '', JSON.stringify(data));
  entry.memory = data.memory_id;
});

Then(
  'the gateway process answers ok with the data {string} and the evidence of the memory it was given, {string}',
  function (data: string, content: string) {
    const entry = entryOf(this);
    const answer = okAnswer(entry);
    // The memory the first call wrote, found by the second: data kept it between two tasks.
    assert.deepEqual(
      { data: answer['data'], evidence: answer['evidence'] },
      { data: JSON.parse(data), evidence: [{ source: 'memory', ref: entry.memory, excerpt: content }] },
    );
  },
);

Then(
  'the fake model was asked over HTTPS with the key of the broker, never with a token of a task',
  function () {
    const { model } = entryOf(this);
    assert.match(model.url, /^https:/);
    const asked = model.requests.filter((request) => request.path === '/v1/messages');
    assert.equal(asked.length, 4, JSON.stringify(model.requests.map((request) => request.path)));
    assert.deepEqual([...new Set(model.requests.map((request) => request.apiKey))], [BROKER_KEY]);
  },
);

Then(
  'the standard output of the gateway process holds the audit of the calls {string} by {string}, ok',
  function (tools: string, subject: string) {
    const entries = entryOf(this)
      .stdout.split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    // The calls of the clients are the entries with an owner; the router writes the others.
    assert.deepEqual(
      entries
        .filter((entry) => entry['owner'] === 'memory')
        .map((entry) => ({ tool: entry['tool'], subject: entry['subject'], outcome: entry['outcome'] })),
      tools.split(', ').map((tool) => ({ tool, subject, outcome: 'ok' })),
    );
  },
);

Then('the gateway process refuses the call with {string}', function (code: string) {
  const { answer } = entryOf(this);
  assert.ok(answer?.isError === true, 'the call must be refused');
  assert.equal((JSON.parse(answer.text) as { code?: unknown }).code, code);
});

When('the gateway process receives SIGTERM', { timeout: 60_000 }, async function () {
  const entry = entryOf(this);
  entry.child.kill('SIGTERM');
  await entry.ended;
});

Then(
  'the gateway process ends with the code {int}, without a failure on its standard error',
  async function (code: number) {
    const entry = entryOf(this);
    assert.deepEqual(await entry.ended, { code, signal: null }, entry.stderr);
    assert.doesNotMatch(entry.stderr, /^gateway: /m);
  },
);

Then(
  'nothing listens on the port of the gateway process or on the port of its broker any more',
  async function () {
    const entry = entryOf(this);
    assert.deepEqual(
      [await reach(entry.port), await reach(entry.brokerPort)],
      ['ECONNREFUSED', 'ECONNREFUSED'],
    );
  },
);
