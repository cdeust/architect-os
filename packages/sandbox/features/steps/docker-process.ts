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
 * to calls.jsonl in DOCKER_CONFIG. For `run` it prints `started`, then, by the last argument of the command: `exit` exits
 * with 7; `close-stdin` closes its stdin and exits with 0; any other never ends.
 */
const FAKE_DOCKER = `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(join(process.env.DOCKER_CONFIG, 'calls.jsonl'), JSON.stringify({ args, env: Object.keys(process.env).sort(), values: process.env }) + '\\n');
if (args[0] !== 'run') process.exit(0);
process.stdout.write('started\\n');
const mode = args.at(-1);
if (mode === 'exit') process.exit(7);
else if (mode === 'close-stdin') { process.stdin.destroy(); setTimeout(() => process.exit(0), 200); }
else setInterval(() => {}, 1000);
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
      memoryBytes: 268435456,
      pidsLimit: 64,
      variables: h.variables,
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
  const sandbox = await runnerOf(h).start({
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
    build(harness(this), which === 'memoryBytes' ? { memoryBytes: value } : { pidsLimit: value });
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
const calls = (h: Harness): Call[] => {
  const file = join(h.dockerDir, 'calls.jsonl');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call)
    : [];
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
