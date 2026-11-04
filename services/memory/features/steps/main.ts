import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { runtimeOf, serve, start, type MemoryRuntime, type Started } from '../../src/main.js';
import { Given, Then, When, slot, type MemoryWorld } from './helpers.js';

void Given;

const ENV: Record<string, string> = {
  DATA_URL: 'http://data:8082',
  WORKER_IMAGE: 'worker:test',
  WORKER_NETWORK: 'exec',
  INTERNAL_TOOLS_URL: 'http://memory:8083',
  BROKER_URL: 'http://broker:9',
};

const LIMITS = { max_turns: 1, max_budget_usd: 0.1 };

/** A fake docker client: records its argv in calls.jsonl beside it; `run` echoes stdin, or prints N bytes for `big-N`. */
const FAKE_DOCKER = `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(join(dirname(process.argv[1]), 'calls.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] !== 'run') process.exit(0);
const big = args.find((a) => a.startsWith('big-'));
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => process.stdout.write(big ? 'x'.repeat(Number(big.slice(4))) : input));
`;

class MainScenario {
  runtime: MemoryRuntime | undefined;
  failure: Error | undefined;
  started: Started[] = [];
  logs: string[] = [];
  /** The operations a fake data component received, path and body. */
  dataCalls: { path: string; body: unknown }[] = [];
  /** The answer of the internal tools host of a started service. */
  answer: number | undefined;
  /** The free MCP port handed to a second start. */
  freePort = 0;
  dir = '';
  outcome: { stdout: string } | { error: { code?: string; message: string } } | undefined;
  served: { code: number; stderr: string; runtime?: MemoryRuntime; logged?: string } | undefined;
}
const scenario = (world: MemoryWorld) => slot(world, 'main', () => new MainScenario());

const envWith = (changes: string): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...ENV };
  for (const change of changes.split(', ')) {
    const [name, value] = change.split('=');
    env[name as string] = value;
  }
  return env;
};

When('I read the memory runtime of the test environment', function () {
  scenario(this).runtime = runtimeOf(ENV);
});

When('I read the memory runtime of the test environment with {string}', function (changes: string) {
  scenario(this).runtime = runtimeOf(envWith(changes));
});

When(
  'I read the memory runtime of the test environment with {word} {word}',
  function (name: string, how: string) {
    const env: Record<string, string | undefined> = { ...ENV };
    if (how === 'missing') delete env[name];
    else env[name] = '';
    try {
      runtimeOf(env);
    } catch (error) {
      scenario(this).failure = error as Error;
    }
  },
);

Then('the memory runtime is:', function (expected: string) {
  assert.deepEqual(scenario(this).runtime, JSON.parse(expected));
});

Then(
  'the memory runtime has the worker memory {string} and the ports {int} and {int}',
  function (memory: string, port: number, internalPort: number) {
    const runtime = scenario(this).runtime as MemoryRuntime;
    assert.deepEqual(
      [runtime.worker.memory, runtime.port, runtime.internalPort],
      [memory, port, internalPort],
    );
  },
);

Then('reading the memory runtime fails with {string}', function (message: string) {
  assert.equal(scenario(this).failure?.message, message);
});

/** A directory holding the fake docker client, first on the PATH the docker adapter inherits. */
function fakeDockerPath(world: MemoryWorld): string {
  const s = scenario(world);
  if (s.dir === '') {
    s.dir = mkdtempSync(join(tmpdir(), 'aos-memory-docker-'));
    world.cleanups.push(() => rmSync(s.dir, { recursive: true, force: true }));
    writeFileSync(join(s.dir, 'docker'), FAKE_DOCKER);
    chmodSync(join(s.dir, 'docker'), 0o755);
  }
  return `${s.dir}${delimiter}${process.env['PATH'] ?? ''}`;
}

async function startOn(world: MemoryWorld, runtime: MemoryRuntime): Promise<Started> {
  const s = scenario(world);
  const started = await start(runtime, (line) => s.logs.push(line), { PATH: fakeDockerPath(world) });
  s.started.push(started);
  world.cleanups.push(() => started.close());
  return started;
}

const freeRuntime = (): MemoryRuntime => runtimeOf({ ...ENV, PORT: '0', INTERNAL_PORT: '0' });

/** A fake data component on a free port: records each operation and answers it with an empty list. */
async function fakeData(world: MemoryWorld): Promise<string> {
  const s = scenario(world);
  const server: Server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      s.dataCalls.push({ path: req.url ?? '', body: JSON.parse(body) as unknown });
      res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    });
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  world.cleanups.push(() => new Promise<void>((closed) => server.close(() => closed())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

When('I start the memory service on free ports over a fake data component', async function () {
  await startOn(this, { ...freeRuntime(), dataUrl: await fakeData(this) });
});

When(
  'I post {string} to the internal tool {string} of the started service',
  async function (body: string, tool: string) {
    const res = await fetch(`http://127.0.0.1:${first(this).ports[1]}/internal/${tool}`, {
      method: 'POST',
      body,
    });
    await res.text();
    scenario(this).answer = res.status;
  },
);

Then(
  'the fake data component received {string} with the query {string}, and the internal tool answered {int}',
  function (path: string, query: string, status: number) {
    const s = scenario(this);
    assert.deepEqual(
      [
        s.dataCalls.map((call) => call.path),
        (s.dataCalls[0]?.body as { query?: string } | undefined)?.query,
        s.answer,
      ],
      [[path], query, status],
    );
  },
);

When('I start the memory service on free ports', async function () {
  await startOn(this, freeRuntime());
});

const first = (world: MemoryWorld) => scenario(world).started[0] as Started;

const health = async (port: number) =>
  fetch(`http://127.0.0.1:${port}/healthz`).then(
    (res) => res.status,
    () => 0,
  );

Then('the memory MCP host answers its health check', async function () {
  assert.equal(await health(first(this).ports[0]), 200);
});

Then('the memory start logged its two ports', function () {
  const [http, internal] = first(this).ports;
  assert.deepEqual(scenario(this).logs, [
    `memory listening on :${http}`,
    `memory internal tools listening on :${internal}`,
  ]);
});

When('I close the memory service', async function () {
  await first(this).close();
});

Then('the memory MCP host no longer answers', async function () {
  assert.equal(await health(first(this).ports[0]), 0);
});

const run = async (world: MemoryWorld, input: unknown) => {
  scenario(world).outcome = await first(world)
    .runner.run({ input: { run_id: 'r1', tool: 'recall', input, limits: LIMITS }, timeoutMs: 20_000 })
    .then(
      (result) => ({ stdout: result.stdout }),
      (error: { code?: string; message: string }) => ({ error }),
    );
};

When('the memory worker runner runs a recall request through the fake docker client', async function () {
  await run(this, { query: 'q' });
});

Then('the memory worker returned the input it was sent', function () {
  assert.deepEqual(scenario(this).outcome, {
    stdout: JSON.stringify({ run_id: 'r1', tool: 'recall', input: { query: 'q' }, limits: LIMITS }),
  });
});

const runArgs = (world: MemoryWorld): string[] =>
  readFileSync(join(scenario(world).dir, 'calls.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[])
    .find((args) => args[0] === 'run') as string[];

Then(
  'the fake docker client ran {string} on the network {string} with {word} and {int} pids',
  function (image: string, network: string, memory: string, pids: number) {
    const args = runArgs(this);
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    assert.deepEqual(
      [args.at(-1), after('--network'), after('--memory'), after('--pids-limit')],
      [image, network, memory, String(pids)],
    );
  },
);

Then('the fake docker client got the worker environment {string}', function (pairs: string) {
  const args = runArgs(this);
  assert.deepEqual(
    args.filter((_, i) => args[i - 1] === '--env'),
    pairs.split(', '),
  );
});

When(
  'the memory worker runner runs a request whose fake worker prints {int} bytes',
  async function (bytes: number) {
    const runtime = freeRuntime();
    const started = await startOn(this, { ...runtime, worker: { ...runtime.worker, image: `big-${bytes}` } });
    scenario(this).started = [started];
    await run(this, {});
  },
);

Then('the memory worker run is read whole', function () {
  const outcome = scenario(this).outcome;
  assert.ok(outcome !== undefined && 'stdout' in outcome, JSON.stringify(outcome));
  assert.equal(outcome.stdout.length, 1048576);
});

Then('the memory worker run is refused with WORKER_OUTPUT_INVALID', function () {
  const outcome = scenario(this).outcome;
  assert.ok(outcome !== undefined && 'error' in outcome, 'the run was not refused');
  assert.equal(outcome.error.code, 'WORKER_OUTPUT_INVALID');
});

When('I start a second memory service on the same MCP port', async function () {
  const taken = first(this).ports[0];
  try {
    await startOn(this, { ...freeRuntime(), port: taken });
  } catch (error) {
    scenario(this).failure = error as Error;
  }
});

/** Listens on a port, then closes it: resolves with whether the port could be taken. */
const takes = (port: number) =>
  new Promise<boolean>((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, () => server.close(() => done(true)));
  });

/** A port free at this instant: the system's choice for port 0, released at once. */
const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

When('I start a second memory service on a free MCP port and the same internal port', async function () {
  const s = scenario(this);
  s.freePort = await freePort();
  try {
    await startOn(this, { ...freeRuntime(), port: s.freePort, internalPort: first(this).ports[1] });
  } catch (error) {
    s.failure = error as Error;
  }
});

Then('the MCP port of the second start is free again', async function () {
  assert.equal(await takes(scenario(this).freePort), true);
});

Then('the second start fails with {string}', function (code: string) {
  assert.equal((scenario(this).failure as NodeJS.ErrnoException | undefined)?.code, code);
});

When('I serve memory with the test environment without DATA_URL', async function () {
  const stderr = new PassThrough();
  let text = '';
  stderr.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
  const env: Record<string, string | undefined> = { ...ENV };
  delete env['DATA_URL'];
  const code = await serve(env, stderr);
  scenario(this).served = { code, stderr: text };
});

Then('serve gives {int} and wrote {string}', function (code: number, line: string) {
  assert.deepEqual(scenario(this).served, { code, stderr: `${line}\n` });
});

When('I serve memory with the test environment and a start that records its call', async function () {
  const stderr = new PassThrough();
  let text = '';
  stderr.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
  const s = scenario(this);
  const code = await serve(ENV, stderr, async (runtime, log) => {
    log('logged');
    s.served = { code: -1, stderr: '', runtime };
    return {} as Started;
  });
  s.served = { ...s.served, code, stderr: text } as MainScenario['served'];
});

Then('serve gives 0 and started the runtime of the test environment, logging to stderr', function () {
  assert.deepEqual(scenario(this).served, { code: 0, stderr: 'logged\n', runtime: runtimeOf(ENV) });
});
