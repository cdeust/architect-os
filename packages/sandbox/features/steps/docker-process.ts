import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { connect, createServer, Server, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DockerProcessRunner, type DockerProcessRunnerOptions } from '../../src/docker-process-runner.js';
import type { Sandbox, SandboxExit } from '../../src/port.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';

const IMAGE = `node:22-alpine@sha256:${'a'.repeat(64)}`;

/**
 * A fake docker client, in a folder whose name holds a space: appends its argv and its environment (names, and values)
 * to calls.jsonl in DOCKER_CONFIG.
 * - `info` answers what info.json says (`stdout`, `stderr`, `code`, or `hang`), a rootless daemon by default.
 * - `run` of the canary (the probe file is in its arguments) connects to the socket of the mounted relay folder, reads
 *   the value, and prints a probe line: the good values, drawn from its own arguments, changed by what probe.json says
 *   (`mode`: `silent`, `hang`, `text` with its `text`, or a `size` in bytes for the line; `top`, `writes`, `cgroup`: fields replaced;
 *   `reset`: it first connects straight to the port of the check and resets that connection; `stderr`: written first on
 *   its error output; `removeClient`: it removes its own file, and no later call of the client can be run).
 * - any other `run` prints `started`, then, by the last argument of the command: `exit` exits with 7; `close-stdin`
 *   closes its stdin and exits with 0; any other never ends.
 */
const FAKE_DOCKER = `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync, unlinkSync } = require('node:fs');
const { connect } = require('node:net');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(join(process.env.DOCKER_CONFIG, 'calls.jsonl'), JSON.stringify({ args, env: Object.keys(process.env).sort(), values: process.env }) + '\\n');
const setting = (name, fallback) => existsSync(join(process.env.DOCKER_CONFIG, name)) ? JSON.parse(readFileSync(join(process.env.DOCKER_CONFIG, name), 'utf8')) : fallback;
const flag = (name) => args[args.indexOf(name) + 1];
function probe() {
  const state = setting('probe.json', {});
  if (state.stderr) process.stderr.write(state.stderr);
  if (state.removeClient) unlinkSync(__filename);
  if (state.mode === 'silent') return;
  if (state.mode === 'hang') return void setInterval(() => {}, 1000);
  if (state.mode === 'text') return void process.stdout.write(state.text + '\\n');
  const mount = ',target=/relay,readonly';
  const folder = args.find((arg) => arg.endsWith(mount)).slice('type=bind,source='.length, -mount.length);
  const targets = JSON.parse(args.at(-1));
  if (!state.reset) return probeThrough(folder, targets, state);
  // Another process of the host: straight to the port of the check, not through the relay, and gone with a reset.
  const direct = connect({ host: '127.0.0.1', port: targets.port }, () => direct.resetAndDestroy());
  direct.on('error', () => {});
  direct.on('close', () => probeThrough(folder, targets, state));
}
function probeThrough(folder, targets, state) {
  let text = '';
  const socket = connect(join(folder, 's'));
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => (text += chunk));
  socket.on('error', () => {});
  socket.on('close', () => {
    const good = {
      read: { content: text },
      uid: Number(flag('--user').split(':')[0]),
      interfaces: ['lo'],
      outside: { error: 'ENETUNREACH' },
      writes: Object.fromEntries([...targets.unwritable.map((p) => [p, { error: 'EROFS' }]), ...targets.writable.map((p) => [p, { content: 'written' }])]),
      cgroup: { 'memory.max': { content: String(parseInt(flag('--memory'), 10) * 1048576) }, 'memory.swap.max': { content: '0' }, 'pids.max': { content: flag('--pids-limit') } },
    };
    // A field replaced as a whole (top) wins over its entries replaced one by one.
    let line = JSON.stringify({ ...good, writes: { ...good.writes, ...state.writes }, cgroup: { ...good.cgroup, ...state.cgroup }, ...state.top });
    if (state.size) line += ' '.repeat(state.size - line.length - 1);
    process.stdout.write(line + '\\n');
  });
}
if (args[0] === 'info') {
  const info = setting('info.json', { stdout: '["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]' });
  if (info.hang) setInterval(() => {}, 1000);
  else { process.stdout.write(info.stdout); process.stderr.write(info.stderr ?? ''); process.exitCode = info.code ?? 0; }
} else if (args[0] !== 'run') process.exit(0);
else if (args.some((arg) => arg.endsWith('container-probe-entry.js'))) probe();
else {
  process.stdout.write('started\\n');
  const mode = args.at(-1);
  if (mode === 'exit') process.exit(7);
  else if (mode === 'close-stdin') { process.stdin.destroy(); setTimeout(() => process.exit(0), 200); }
  else setInterval(() => {}, 1000);
}
`;

/** A loopback listener, and what it saw. */
interface Listener {
  readonly port: number;
  connections: number;
  closed: number;
  /** What it received once it had ended its own side. */
  late: string;
}

/**
 * What a listener does with a connection: `answer` answers `<text>:<what it received>` and ends; `hold` keeps it open;
 * `afterEnd` answers once its client has ended; `endFirst` says its text, ends its side and keeps what it then
 * receives.
 */
type Behaviour = { kind: 'answer' | 'afterEnd' | 'endFirst'; text: string } | { kind: 'hold' };

interface Harness {
  dockerDir: string;
  docker: string;
  tmpRoot: string;
  profilesDir: string;
  variables: Record<string, string>;
  hostEnv: Record<string, string | undefined>;
  /** The runner the starts of the scenario share, built by the first of them. */
  runner?: DockerProcessRunner;
  checkTimeoutMs: number;
  sandbox?: Sandbox;
  started?: Promise<void>;
  exit?: SandboxExit;
  refusal?: Error | null;
  clientOfRelay?: { socket: Socket; closed: boolean };
}

const harness = (world: SandboxWorld) => stored<Harness>(world, 'dockerProcess');

/** Polls a condition, with a bound: no fixed wait. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((tick) => setTimeout(tick, 20));
  }
}

const pairs = (text: string): [string, string][] =>
  text.split(', ').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]);

function makeHarness(world: SandboxWorld, variables: Record<string, string>): void {
  const dockerDir = mkdtempSync(join(tmpdir(), 'aos docker-'));
  const tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), 'aos-dp-')));
  world.cleanups.push(() => rmSync(dockerDir, { recursive: true, force: true }));
  world.cleanups.push(() => rmSync(tmpRoot, { recursive: true, force: true }));
  const docker = join(dockerDir, 'docker');
  writeFileSync(docker, FAKE_DOCKER);
  chmodSync(docker, 0o755);
  world.state['dockerProcess'] = {
    dockerDir,
    docker,
    tmpRoot,
    profilesDir: join(PKG, 'profiles'),
    variables,
    checkTimeoutMs: 10_000,
    hostEnv: {
      PATH: process.env['PATH'],
      HOME: process.env['HOME'],
      DOCKER_CONFIG: dockerDir,
      DOCKER_HOST: 'unix:///run/test.sock',
      DOCKER_CONTEXT: 'test',
    },
  } satisfies Harness;
}

Given('a Docker process harness with the variables {string}', function (variables: string) {
  makeHarness(this, Object.fromEntries(pairs(variables)));
});

Given('the Docker process harness now starts with the variables {string}', function (variables: string) {
  harness(this).variables = Object.fromEntries(pairs(variables));
});

Given('the host environment also holds {string}', function (variables: string) {
  Object.assign(harness(this).hostEnv, Object.fromEntries(pairs(variables)));
});

Given(
  'the network of the profile {string} is allowed {string} and denied {string}',
  function (profile: string, allowed: string, denied: string) {
    const h = harness(this);
    const template = JSON.parse(readFileSync(join(PKG, 'profiles', `${profile}.json`), 'utf8')) as {
      srt: { network: { allowedDomains: unknown; deniedDomains: unknown } };
    };
    template.srt.network = {
      allowedDomains: JSON.parse(allowed) as unknown,
      deniedDomains: JSON.parse(denied) as unknown,
    };
    h.profilesDir = join(h.dockerDir, 'profiles');
    mkdirSync(h.profilesDir);
    writeFileSync(join(h.profilesDir, `${profile}.json`), JSON.stringify(template));
  },
);

Given('the Docker process harness has no docker client', function () {
  harness(this).docker = join(tmpdir(), 'aos-no-such-docker');
});

Given(
  'the Docker process harness has a temporary root with a path of {int} characters',
  function (length: number) {
    const h = harness(this);
    h.tmpRoot = join(h.tmpRoot, 'x'.repeat(length - h.tmpRoot.length - 1));
    mkdirSync(h.tmpRoot);
    assert.equal(h.tmpRoot.length, length);
  },
);

function listen(world: SandboxWorld, behaviour: Behaviour): Promise<Listener> {
  const listener = { port: 0, connections: 0, closed: 0, late: '' };
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    listener.connections += 1;
    socket.on('error', () => undefined);
    socket.on('close', () => (listener.closed += 1));
    let received = '';
    // Every connection is read, a held one too: a socket nobody reads never sees its peer leave.
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      if (behaviour.kind === 'answer') socket.end(`${behaviour.text}:${received}`);
      if (behaviour.kind === 'endFirst') listener.late = received;
    });
    socket.on('end', () => {
      if (behaviour.kind === 'afterEnd') socket.end(`${behaviour.text}:${received}`);
      // The other behaviours leave when their client does, as a socket that is not half-open would.
      else socket.end();
    });
    if (behaviour.kind === 'endFirst') socket.end(behaviour.text);
  });
  world.cleanups.push(() => void server.close());
  return new Promise((ready) =>
    server.listen(0, '127.0.0.1', () => {
      listener.port = (server.address() as AddressInfo).port;
      ready(listener);
    }),
  );
}

Given('a loopback listener that answers {string} is the callback port', async function (answer: string) {
  this.state['first'] = await listen(this, { kind: 'answer', text: answer });
});

Given(
  'a loopback listener that answers {string} once its client has ended is the callback port',
  async function (answer: string) {
    this.state['first'] = await listen(this, { kind: 'afterEnd', text: answer });
  },
);

Given(
  'a loopback listener that says {string}, ends its side and keeps what it then receives is the callback port',
  async function (text: string) {
    this.state['first'] = await listen(this, { kind: 'endFirst', text });
  },
);

Given('a second loopback listener that answers {string} on another port', async function (answer: string) {
  this.state['second'] = await listen(this, { kind: 'answer', text: answer });
});

Given('a loopback listener that holds its connections open is the callback port', async function () {
  this.state['first'] = await listen(this, { kind: 'hold' });
});

Given('a Docker process harness with the variables taken from the callback port', function () {
  makeHarness(this, { callbackPort: String(stored<Listener>(this, 'first').port) });
});

Given('a Docker process harness with the variables taken from a port nothing listens on', async function () {
  const free = await new Promise<number>((found) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => found(port));
    });
  });
  makeHarness(this, { callbackPort: String(free) });
});

const runnerOf = (h: Harness, changed: Partial<DockerProcessRunnerOptions> = {}) =>
  new DockerProcessRunner(
    {
      profilesDir: h.profilesDir,
      docker: h.docker,
      image: IMAGE,
      node: '/usr/local/bin/node',
      root: '/srv/platform',
      tmpRoot: h.tmpRoot,
      memoryMiB: 256,
      pidsLimit: 64,
      checkTimeoutMs: h.checkTimeoutMs,
      ...changed,
    },
    h.hostEnv,
  );

/** Builds a runner with one option changed and keeps the refusal, or null. */
function build(h: Harness, changed: Partial<DockerProcessRunnerOptions>): void {
  try {
    runnerOf(h, changed);
    h.refusal = null;
  } catch (error) {
    h.refusal = error as Error;
  }
}

async function begin(world: SandboxWorld, profile: string, command: string): Promise<Sandbox> {
  const h = harness(world);
  h.runner ??= runnerOf(h);
  const sandbox = await h.runner.withVariables(h.variables).start({
    profile,
    cwd: h.tmpRoot,
    // `[nul]` stands for the character no argument of a process can hold.
    command: command === '' ? [] : command.replaceAll('[nul]', '\0').split(' '),
  });
  h.sandbox = sandbox;
  h.started = new Promise<void>((started) => sandbox.stdout.once('data', () => started()));
  // Stopped at the end of the scenario, before the folder of the fake client is removed (the cleanups run last in, first out).
  // A stop that says its removal could not be run is the subject of a scenario, not a failure of the cleanup.
  world.cleanups.push(async () => {
    await sandbox.stop().catch(() => undefined);
  });
  return sandbox;
}

When(
  'I start the Docker process profile {string} with the command {string} and wait for the client',
  async function (profile: string, command: string) {
    await begin(this, profile, command);
    await harness(this).started;
  },
);

When(
  'I start the Docker process profile {string} with the command {string} and wait for its end',
  async function (profile: string, command: string) {
    const sandbox = await begin(this, profile, command);
    harness(this).exit = await sandbox.exited;
  },
);

When(
  'I start the Docker process profile {string} with the command {string}, write {int} bytes on its stdin and wait for its end',
  async function (profile: string, command: string, bytes: number) {
    const sandbox = await begin(this, profile, command);
    sandbox.stdout.resume();
    sandbox.stdin.write('x'.repeat(bytes));
    harness(this).exit = await sandbox.exited;
  },
);

When(
  'I try to start the Docker process profile {string} with the command {string}',
  async function (profile: string, command: string) {
    harness(this).refusal = await begin(this, profile, command).then(
      () => null,
      (error: Error) => error,
    );
  },
);

When('I build a Docker process runner with the image {string}', function (image: string) {
  build(harness(this), { image });
});

When(
  'I build a Docker process runner whose path option {word} is {string}',
  function (which: string, text: string) {
    // `[newline]` stands for the character a step line cannot hold.
    const path = text.replaceAll('[newline]', '\n');
    build(harness(this), which === 'root' ? { root: path } : { tmpRoot: path });
  },
);

When(
  'I build a Docker process runner whose bound {word} is {float}',
  function (which: string, value: number) {
    build(harness(this), { [which]: value } as Partial<DockerProcessRunnerOptions>);
  },
);

Given('the profile {string} also sets the variable {string}', function (profile: string, name: string) {
  const h = harness(this);
  const template = JSON.parse(readFileSync(join(PKG, 'profiles', `${profile}.json`), 'utf8')) as {
    env: { set: Record<string, string> };
  };
  template.env.set[name] = 'value';
  h.profilesDir = join(h.dockerDir, 'profiles');
  mkdirSync(h.profilesDir);
  writeFileSync(join(h.profilesDir, `${profile}.json`), JSON.stringify(template));
});

Given('the profile {string} also declares the file {string}', function (profile: string, file: string) {
  const h = harness(this);
  const template = JSON.parse(readFileSync(join(PKG, 'profiles', `${profile}.json`), 'utf8')) as {
    files: Record<string, unknown>;
  };
  template.files[file] = {};
  h.profilesDir = join(h.dockerDir, 'profiles');
  mkdirSync(h.profilesDir);
  writeFileSync(join(h.profilesDir, `${profile}.json`), JSON.stringify(template));
});

type Call = { args: string[]; env: string[]; values: Record<string, string> };
/** Every call of the docker client, the check at start included. */
const allCalls = (h: Harness): Call[] => {
  const file = join(h.dockerDir, 'calls.jsonl');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call)
    : [];
};

const PROBE_FILE = 'container-probe-entry.js';
const isCanaryRun = (call: Call) =>
  call.args[0] === 'run' && call.args.some((arg) => arg.endsWith(PROBE_FILE));
/** The calls of the check at start: `info`, the run of the canary, and the removal of its container. */
const canaryRuns = (h: Harness): Call[] => allCalls(h).filter(isCanaryRun);
const ofCheck = (call: Call, canaries: Call[]) =>
  call.args[0] === 'info' ||
  isCanaryRun(call) ||
  (call.args[0] === 'rm' && canaries.some((canary) => nameOf(canary.args) === call.args[2]));

/** The calls of the sandboxes: everything but the check. */
const calls = (h: Harness): Call[] => {
  const canaries = canaryRuns(h);
  return allCalls(h).filter((call) => !ofCheck(call, canaries));
};

const runArgs = (h: Harness): string[] => {
  const run = calls(h).find((call) => call.args[0] === 'run');
  assert.ok(run, 'the docker client was never run');
  return run.args;
};

const nameOf = (args: string[]) => args[args.indexOf('--name') + 1];

const folderOf = (args: string[]): string => {
  const mount = args.find((arg) => arg.endsWith(',target=/relay,readonly'));
  assert.ok(mount, 'no mount of the relay folder');
  return mount.slice('type=bind,source='.length, -',target=/relay,readonly'.length);
};

const envOf = (args: string[]) => args.filter((_, i) => args[i - 1] === '--env');

const workerNoise = (name: string) => !name.startsWith('__CF') && name !== 'XPC_SERVICE_NAME';

Then('the arguments of the Docker process run are exactly', function (expected: string) {
  const args = runArgs(harness(this));
  const lines = expected
    .split('\n')
    .map((line) => line.replace('<name>', nameOf(args) as string).replace('<folder>', folderOf(args)));
  assert.deepEqual(args, lines);
});

const UUID = /^aos-sandbox-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Then('the container of the Docker process run has a unique name', function () {
  assert.match(nameOf(runArgs(harness(this))) as string, UUID);
});

Then(
  'the relay folder of the Docker process run is a folder of its own under the sandboxes parent',
  function () {
    const h = harness(this);
    const folder = folderOf(runArgs(h));
    assert.equal(dirname(folder), join(h.tmpRoot, 'aos-sb'));
    assert.ok(basename(folder).startsWith('r-'), folder);
    assert.ok(statSync(folder).isDirectory());
  },
);

Then(
  'the container of the Docker process run is given by name the variables {string}, and by value {string}',
  function (names: string, valued: string) {
    const given = envOf(runArgs(harness(this)));
    assert.deepEqual(given, [...names.split(', '), ...valued.split(', ')]);
  },
);

Then(
  'the Docker client of the process run holds in its own environment {string}',
  function (variables: string) {
    const run = calls(harness(this)).find((call) => call.args[0] === 'run');
    assert.ok(run, 'the docker client was never run');
    for (const [name, value] of pairs(variables)) assert.equal(run.values[name], value, name);
  },
);

Then('no argument of the Docker process run holds {string}', function (value: string) {
  const all = runArgs(harness(this)).join('\n');
  assert.ok(!all.includes(value), `an argument holds ${value}`);
});

Then(
  'no argument of the Docker process run holds {string}, {string}, {string} or {string}',
  function (a: string, b: string, c: string, d: string) {
    const all = runArgs(harness(this)).join('\n');
    for (const value of [a, b, c, d]) assert.ok(!all.includes(value), `an argument holds ${value}`);
  },
);

Then('the Docker client of the process run saw only the environment {string}', function (names: string) {
  const run = calls(harness(this)).find((call) => call.args[0] === 'run');
  assert.deepEqual(run?.env.filter(workerNoise), names.split(', '));
});

Then('the Docker process runner is refused starting with {string}', function (prefix: string) {
  const message = harness(this).refusal?.message ?? '';
  assert.ok(message.startsWith(prefix), message);
});

Then('the Docker process runner is refused with {string}', function (message: string) {
  assert.equal(harness(this).refusal?.message, message);
});

Then('the Docker process runner is built', function () {
  assert.equal(harness(this).refusal, null);
});

Then('the Docker process start is refused starting with {string}', function (prefix: string) {
  const message = harness(this).refusal?.message ?? '';
  assert.ok(message.startsWith(prefix), message);
});

Then('the Docker process start is refused matching {string}', function (pattern: string) {
  assert.match(harness(this).refusal?.message ?? '', new RegExp(pattern));
});

Then('the Docker process start is refused with {string}', function (message: string) {
  assert.equal(harness(this).refusal?.message, message);
});

Then('the Docker client was never run', function () {
  assert.deepEqual(calls(harness(this)), []);
});

Then('no relay folder exists', function () {
  const parent = join(harness(this).tmpRoot, 'aos-sb');
  assert.deepEqual(existsSync(parent) ? readdirSync(parent) : [], []);
});

Then('the entry of the Docker process run is told the port {string}', function (port: string) {
  const args = runArgs(harness(this));
  assert.equal(args[args.indexOf('--') - 1], port);
});

const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);

Then('the sandboxes parent has the mode {string}', function (expected: string) {
  assert.equal(mode(join(harness(this).tmpRoot, 'aos-sb')), expected);
});

Then('the relay folder of the Docker process run has the mode {string}', function (expected: string) {
  assert.equal(mode(folderOf(runArgs(harness(this)))), expected);
});

Then(
  'the relay socket of the Docker process run is a socket of the mode {string}',
  function (expected: string) {
    const socket = join(folderOf(runArgs(harness(this))), 's');
    assert.ok(statSync(socket).isSocket());
    assert.equal(mode(socket), expected);
  },
);

const relaySocket = (h: Harness) => join(folderOf(runArgs(h)), 's');

When(
  'I connect to the relay socket of the Docker process, send {string} and read the answer',
  async function (text: string) {
    this.state['answer'] = await new Promise<string>((done) => {
      const client = connect(relaySocket(harness(this)));
      let answer = '';
      client.on('data', (chunk) => (answer += chunk.toString('utf8')));
      client.on('error', () => undefined);
      client.on('close', () => done(answer));
      client.write(text);
    });
  },
);

/** A client of the relay that allows a half-open connection: resolves with what it read when the connection closes. */
function halfOpenClient(world: SandboxWorld, begin: (client: Socket) => void): Promise<string> {
  return new Promise((done) => {
    const client = connect({ path: relaySocket(harness(world)), allowHalfOpen: true });
    let answer = '';
    client.on('data', (chunk) => (answer += chunk.toString('utf8')));
    client.on('error', () => undefined);
    client.on('close', () => done(answer));
    begin(client);
  });
}

When(
  'I connect to the relay socket of the Docker process, send {string}, end my side and read the answer',
  async function (text: string) {
    this.state['answer'] = await halfOpenClient(this, (client) => client.end(text));
  },
);

When(
  'I connect to the relay socket of the Docker process, read until its end, then send {string} and end my side',
  async function (text: string) {
    this.state['answer'] = await halfOpenClient(this, (client) => client.on('end', () => client.end(text)));
  },
);

Then('the listener of the callback port received {string}', async function (expected: string) {
  const listener = stored<Listener>(this, 'first');
  await until(
    () => listener.late === expected,
    `the listener to receive ${expected}, it holds "${listener.late}"`,
  );
});

Then('the answer through the relay is {string}', function (expected: string) {
  assert.equal(stored<string>(this, 'answer'), expected);
});

Then(
  'the first listener was reached {int} time and the second listener {int} times',
  function (first: number, second: number) {
    assert.equal(stored<Listener>(this, 'first').connections, first);
    assert.equal(stored<Listener>(this, 'second').connections, second);
  },
);

When(
  'I open a connection through the relay of the Docker process and wait until the listener holds it',
  async function () {
    const h = harness(this);
    const socket = connect(relaySocket(h));
    const client = { socket, closed: false };
    socket.on('error', () => undefined);
    socket.on('close', () => (client.closed = true));
    socket.write('x');
    h.clientOfRelay = client;
    await until(
      () => stored<Listener>(this, 'first').connections === 1,
      'the listener to hold the connection',
    );
  },
);

When('I stop the Docker process sandbox', async function () {
  harness(this).exit = await (harness(this).sandbox as Sandbox).stop();
});

When('the docker client of the harness is removed', function () {
  rmSync(harness(this).docker);
});

When('I try to stop the Docker process sandbox and wait for the end of its client', async function () {
  const h = harness(this);
  const sandbox = h.sandbox as Sandbox;
  h.refusal = await sandbox.stop().then(
    () => null,
    (error: Error) => error,
  );
  h.exit = await sandbox.exited;
});

Then('the Docker process stop is refused matching {string}', function (pattern: string) {
  assert.match(harness(this).refusal?.message ?? '', new RegExp(pattern));
});

Then('the Docker process sandbox exited by the signal {string}', function (signal: string) {
  assert.equal(harness(this).exit?.signal, signal);
});

Then('the Docker process sandbox exited with {int}', function (code: number) {
  assert.equal(harness(this).exit?.code, code);
});

Then(
  'the fake client of the process run was asked for the removal of its container with only the environment {string}',
  function (names: string) {
    const all = calls(harness(this));
    const rm = all.find((call) => call.args[0] === 'rm');
    assert.deepEqual(rm?.args, ['rm', '-f', nameOf(runArgs(harness(this)))]);
    assert.deepEqual(rm?.env.filter(workerNoise), names.split(', '));
  },
);

Then('the fake client of the process run was asked {int} time for a removal', function (count: number) {
  assert.equal(calls(harness(this)).filter((call) => call.args[0] === 'rm').length, count);
});

Then('the relay of the Docker process is closed and its folder removed', async function () {
  const h = harness(this);
  const folder = folderOf(runArgs(h));
  assert.ok(!existsSync(folder), `${folder} still exists`);
  const code = await new Promise<string | undefined>((done) => {
    const client = connect(join(folder, 's'));
    client.once('connect', () => done(undefined));
    client.once('error', (error: NodeJS.ErrnoException) => done(error.code));
  });
  assert.equal(code, 'ENOENT');
  // The adapter removes the folder as an empty folder: that it is gone shows the listener was closed, which is what
  // removes its socket.
});

When('the relay folder of the Docker process is removed by something else', function () {
  rmSync(folderOf(runArgs(harness(this))), { recursive: true, force: true });
});

When('I close my end of the connection through the relay', function () {
  (harness(this).clientOfRelay as { socket: Socket }).socket.destroy();
});

Then('the listener of the callback port sees the connection closed', async function () {
  await until(
    () => stored<Listener>(this, 'first').closed === 1,
    'the listener to see the connection closed',
  );
});

Then('the connection through the relay is cut and the listener sees it closed', async function () {
  const client = harness(this).clientOfRelay as { closed: boolean };
  await until(() => client.closed, 'the client of the relay to be cut');
  await until(
    () => stored<Listener>(this, 'first').closed === 1,
    'the listener to see the connection closed',
  );
});

/** The state files of the fake client: what `info` and the probe of the canary do. */
const stateFile = (h: Harness, name: 'info' | 'probe') => join(h.dockerDir, `${name}.json`);
const stateOf = (h: Harness, name: 'info' | 'probe'): Record<string, unknown> =>
  existsSync(stateFile(h, name))
    ? (JSON.parse(readFileSync(stateFile(h, name), 'utf8')) as Record<string, unknown>)
    : {};
const setState = (h: Harness, name: 'info' | 'probe', changes: Record<string, unknown>) =>
  writeFileSync(stateFile(h, name), JSON.stringify({ ...stateOf(h, name), ...changes }));

Given(
  'the fake docker client answers info with the output {string}, the error output {string} and the exit code {int}',
  function (stdout: string, stderr: string, code: number) {
    setState(harness(this), 'info', {
      stdout: stdout.replaceAll('[newline]', '\n'),
      stderr: stderr.replaceAll('[newline]', '\n'),
      code,
    });
  },
);

Given('the fake docker client never ends info', function () {
  setState(harness(this), 'info', { hang: true });
});

Given('the fake docker client answers info as a rootless daemon again', function () {
  rmSync(stateFile(harness(this), 'info'));
});

Given('the probe of the fake docker client prints nothing', function () {
  setState(harness(this), 'probe', { mode: 'silent' });
});

Given('the fake docker client first resets a connection of its own to the port of the check', function () {
  setState(harness(this), 'probe', { reset: true });
});

Given('the probe of the fake docker client never ends', function () {
  setState(harness(this), 'probe', { mode: 'hang' });
});

Given('the probe of the fake docker client prints the text {string}', function (text: string) {
  setState(harness(this), 'probe', { mode: 'text', text });
});

Given('the probe of the fake docker client prints a line of {int} bytes', function (size: number) {
  setState(harness(this), 'probe', { size });
});

Given('the canary of the fake docker client writes {string} on its error output', function (text: string) {
  setState(harness(this), 'probe', { stderr: text.replaceAll('[newline]', '\n') });
});

Given('the canary of the fake docker client writes {int} bytes on its error output', function (size: number) {
  setState(harness(this), 'probe', { stderr: 'e'.repeat(size) });
});

Given('the canary of the fake docker client removes the docker client of the harness', function () {
  setState(harness(this), 'probe', { removeClient: true });
});

Given('the probe of the fake docker client is good again', function () {
  rmSync(stateFile(harness(this), 'probe'));
});

/** Replaces, in one of the three parts of the probe line of the fake client, the value under `key`. */
function reports(world: SandboxWorld, part: 'top' | 'writes' | 'cgroup', key: string, json: string): void {
  const h = harness(world);
  const state = stateOf(h, 'probe');
  setState(h, 'probe', {
    [part]: { ...(state[part] as object | undefined), [key]: JSON.parse(json) as unknown },
  });
}

Given(
  'the probe of the fake docker client reports {string} as {string}',
  function (field: string, json: string) {
    reports(this, 'top', field, json);
  },
);

Given(
  'the probe of the fake docker client reports the write in {string} as {string}',
  function (path: string, json: string) {
    reports(this, 'writes', path, json);
  },
);

Given(
  'the probe of the fake docker client reports the cgroup file {string} as {string}',
  function (file: string, json: string) {
    reports(this, 'cgroup', file, json);
  },
);

Given('the Docker process harness bounds the check to {int} ms', function (ms: number) {
  harness(this).checkTimeoutMs = ms;
});

When('I check the Docker process runner', async function () {
  const h = harness(this);
  h.runner ??= runnerOf(h);
  h.refusal = await h.runner.check().then(
    () => null,
    (error: Error) => error,
  );
});

When(
  'I start the Docker process profile {string} with the command {string} twice at once and wait for the clients',
  async function (profile: string, command: string) {
    await Promise.all([begin(this, profile, command), begin(this, profile, command)]);
    await harness(this).started;
  },
);

Then('the Docker process check succeeded', function () {
  assert.equal(harness(this).refusal, null);
});

Then(
  'the Docker client was asked for info {int} time(s) and ran the canary {int} time(s)',
  function (info: number, canaries: number) {
    const h = harness(this);
    assert.equal(allCalls(h).filter((call) => call.args[0] === 'info').length, info);
    assert.equal(canaryRuns(h).length, canaries);
  },
);

Then(
  'the Docker client was asked for info exactly once, with only the environment {string}',
  function (names: string) {
    const asked = allCalls(harness(this)).filter((call) => call.args[0] === 'info');
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0]?.args, ['info', '--format', '{{json .SecurityOptions}}']);
    assert.deepEqual(asked[0]?.env.filter(workerNoise), names.split(', '));
  },
);

Then('no container was launched by the Docker client', function () {
  assert.deepEqual(
    allCalls(harness(this)).filter((call) => call.args[0] === 'run'),
    [],
  );
});

Then(
  'every canary container was removed by its name, with only the environment {string}',
  function (names: string) {
    const h = harness(this);
    const canaries = canaryRuns(h);
    assert.ok(canaries.length > 0, 'no canary was run');
    for (const canary of canaries) {
      const removals = allCalls(h).filter(
        (call) => call.args[0] === 'rm' && call.args[2] === nameOf(canary.args),
      );
      assert.equal(removals.length, 1, `removals of ${nameOf(canary.args)}`);
      assert.deepEqual(removals[0]?.args, ['rm', '-f', nameOf(canary.args)]);
      assert.deepEqual(removals[0]?.env.filter(workerNoise), names.split(', '));
    }
  },
);

const canaryPort = (canary: Call): number => Number(canary.args[canary.args.indexOf('--') - 1]);

Then('the listener of the check is closed', async function () {
  const canaries = canaryRuns(harness(this));
  assert.ok(canaries.length > 0, 'no canary was run');
  for (const canary of canaries) {
    const code = await new Promise<string | undefined>((done) => {
      const client = connect({ host: '127.0.0.1', port: canaryPort(canary) });
      client.once('connect', () => {
        client.destroy();
        done(undefined);
      });
      client.once('error', (error: NodeJS.ErrnoException) => done(error.code));
    });
    assert.equal(code, 'ECONNREFUSED');
  }
});

Then('the relay folder of every canary is gone', function () {
  const canaries = canaryRuns(harness(this));
  assert.ok(canaries.length > 0, 'no canary was run');
  for (const canary of canaries) assert.ok(!existsSync(folderOf(canary.args)), folderOf(canary.args));
});

/** The options of a run up to its image, with what is the run's own (its name, its relay folder, the template's variables) left out. */
function confinement(args: string[]): string[] {
  const head = args.slice(0, args.indexOf(IMAGE));
  const own = [nameOf(args) as string, folderOf(args)];
  const kept: string[] = [];
  for (let i = 0; i < head.length; i += 1) {
    const arg = head[i] as string;
    if (arg === '--env' && !(head[i + 1] as string).includes('=')) i += 1;
    else kept.push(own.reduce((text, value) => text.replaceAll(value, '<own>'), arg));
  }
  return kept;
}

Then('the canary run has the options of the sandbox run, up to the image', function () {
  const h = harness(this);
  const [canary] = canaryRuns(h);
  assert.ok(canary, 'no canary was run');
  const sandbox = confinement(runArgs(h));
  assert.ok(sandbox.includes('--read-only') && sandbox.includes('--network'));
  assert.deepEqual(confinement(canary.args), sandbox);
  assert.notEqual(nameOf(canary.args), nameOf(runArgs(h)));
  assert.notEqual(folderOf(canary.args), folderOf(runArgs(h)));
});

Then('the canary run ends with', function (expected: string) {
  const [canary] = canaryRuns(harness(this));
  assert.ok(canary, 'no canary was run');
  const port = String(canaryPort(canary));
  assert.deepEqual(
    canary.args.slice(canary.args.indexOf(IMAGE) + 1),
    expected.split('\n').map((line) => line.replaceAll('<port>', port)),
  );
});
