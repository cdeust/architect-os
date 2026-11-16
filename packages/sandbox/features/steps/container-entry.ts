import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { connect, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { RELAY_SOCKET_VARIABLE, runContainerEntry, type EntryProcess } from '../../src/container-relay.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';

interface Entry {
  dir: string;
  socket: string;
  port?: number;
  unixConnections: number;
  unixClosed: number;
  host?: EntryProcess;
  outFile: string;
  errFile: string;
  result?: Promise<number>;
  code?: number;
  compiledOut?: string;
}

/** The client of the relay: prints what it was answered, or `closed` when the connection ended with no answer. */
const RELAY_CLIENT = `const s = require('net').connect({ host: '127.0.0.1', port: Number(process.argv[1]) });
let got = '';
s.on('error', () => {});
s.on('data', (d) => (got += d));
s.on('close', () => { process.stdout.write(got ? 'got:' + got : 'closed'); process.exit(got ? 3 : 5); });
s.write('ping');`;

/** Tries the IPv6 loopback on the port of the entry: a refusal is the answer when the entry listens on IPv4 only. */
const IPV6_CLIENT = `const s = require('net').connect({ host: '::1', port: Number(process.argv[1]) });
s.on('connect', () => { process.stdout.write('connected'); process.exit(0); });
s.on('error', () => { process.stdout.write('refused'); process.exit(0); });`;

/**
 * Resets its connection once it was answered (the answer shows the connection reached the Unix socket server), says
 * so, and stays until SIGTERM: what follows the reset is seen while the command still runs.
 */
const RESET_CLIENT = `const s = require('net').connect({ host: '127.0.0.1', port: Number(process.argv[1]) });
process.on('SIGTERM', () => process.exit(42));
s.on('error', () => {});
s.once('data', () => { s.resetAndDestroy(); process.stdout.write('left'); });
s.write('x');
setInterval(() => {}, 1000);`;

const WAIT_FOR_TERM = `process.on('SIGTERM', () => process.exit(42)); process.stdout.write('ready'); setInterval(() => {}, 1000);`;
const MARKER = `require('fs').writeFileSync(process.argv[1], 'x');`;

/** The argv of a named command: node and a script, or a program that does not exist. */
function commandOf(entry: Entry, name: string): string[] {
  const node = process.execPath;
  const port = String(entry.port);
  const commands: Record<string, string[]> = {
    'relay-client': [node, '-e', RELAY_CLIENT, port],
    'ipv6-client': [node, '-e', IPV6_CLIENT, port],
    'reset-client': [node, '-e', RESET_CLIENT, port],
    'wait-for-term': [node, '-e', WAIT_FOR_TERM],
    'kill-itself': [node, '-e', `process.kill(process.pid, 'SIGKILL')`],
    'write-marker': [node, '-e', MARKER, join(entry.dir, 'marker')],
    missing: [join(entry.dir, 'no-such-program')],
  };
  return commands[name] as string[];
}

function entryOf(world: SandboxWorld): Entry {
  if (world.state['entry'] === undefined) {
    // A short folder: a Unix socket path is bounded.
    const dir = mkdtempSync(join(tmpdir(), 'aos-ce-'));
    world.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    world.state['entry'] = {
      dir,
      socket: join(dir, 's'),
      unixConnections: 0,
      unixClosed: 0,
      outFile: join(dir, 'out'),
      errFile: join(dir, 'err'),
    } satisfies Entry;
  }
  return stored<Entry>(world, 'entry');
}

/** With `end`, the server ends a connection once it answered; without, it holds it (and answers if it has an answer). */
function unixServer(world: SandboxWorld, answer: string | null, end: boolean): Promise<void> {
  const entry = entryOf(world);
  const server = createServer((socket) => {
    entry.unixConnections += 1;
    socket.on('error', () => undefined);
    socket.on('close', () => (entry.unixClosed += 1));
    // A connection that is held is still read: a socket nobody reads never sees its peer leave.
    socket.on('data', (chunk) => {
      if (answer === null) return;
      const text = `${answer}:${chunk.toString('utf8')}`;
      if (end) socket.end(text);
      else socket.write(text);
    });
  });
  world.cleanups.push(() => void server.close());
  return new Promise((ready) => server.listen(entry.socket, ready));
}

Given('a Unix socket server that answers {string} to what it receives', function (answer: string) {
  return unixServer(this, answer, true);
});

Given('a Unix socket server that holds its connections open', function () {
  return unixServer(this, null, false);
});

Given('a Unix socket server that answers {string} and holds its connections open', function (answer: string) {
  return unixServer(this, answer, false);
});

/** A loopback port that was free a moment ago; with `hold`, one that a listener of the scenario keeps. */
function loopbackPort(world: SandboxWorld, hold: boolean): Promise<number> {
  return new Promise((found) => {
    const server = createServer();
    world.cleanups.push(() => void server.close());
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      if (hold) found(port);
      else server.close(() => found(port));
    });
  });
}

Given('a free loopback port for the container entry', async function () {
  entryOf(this).port = await loopbackPort(this, false);
});

Given('a loopback listener holds the port of the container entry', async function () {
  entryOf(this).port = await loopbackPort(this, true);
});

/** Starts the function with a stand-in for `process`: argv and environment of the container, files for the stdio. */
function startEntry(world: SandboxWorld, name: string): void {
  const entry = entryOf(world);
  const out = openSync(entry.outFile, 'w+');
  const err = openSync(entry.errFile, 'w+');
  const input = openSync('/dev/null', 'r');
  world.cleanups.push(() => [out, err, input].forEach((fd) => closeSync(fd)));
  const host: EntryProcess = Object.assign(new EventEmitter(), {
    argv: [process.execPath, 'container-entry.js', String(entry.port), '--', ...commandOf(entry, name)],
    env: { [RELAY_SOCKET_VARIABLE]: entry.socket },
    stdin: Object.assign(new PassThrough(), { fd: input }),
    stdout: createWriteStream('', { fd: out, autoClose: false }),
    stderr: createWriteStream('', { fd: err, autoClose: false }),
  });
  entry.host = host;
  entry.result = runContainerEntry(host);
}

const ended = async (world: SandboxWorld) => {
  const entry = entryOf(world);
  entry.code = await entry.result;
};

When('I run the container entry with the command {string}', async function (name: string) {
  startEntry(this, name);
  await ended(this);
});

When('I start the container entry with the command {string}', function (name: string) {
  startEntry(this, name);
});

/** Polls a condition, with a bound: no fixed wait. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((tick) => setTimeout(tick, 20));
  }
}

const fileText = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

When('I wait until the stdout of the container entry holds {string}', async function (text: string) {
  const entry = entryOf(this);
  await until(() => fileText(entry.outFile).includes(text), `the stdout to hold ${text}`);
});

When('a client of this scenario connects to the port of the container entry and stays', async function () {
  const entry = entryOf(this);
  const held = { closed: false };
  const port = entry.port;
  assert.ok(port !== undefined, 'the container entry has no port');
  const socket = connect({ host: '127.0.0.1', port });
  socket.on('error', () => undefined);
  socket.on('close', () => (held.closed = true));
  socket.resume();
  await new Promise<void>((connected) => socket.once('connect', connected));
  socket.write('held');
  this.state['heldClient'] = held;
  await until(() => entry.unixConnections === 1, 'the connection to reach the Unix socket server');
});

Then('the client of this scenario sees its connection closed', async function () {
  const held = stored<{ closed: boolean }>(this, 'heldClient');
  await until(() => held.closed, 'the client of this scenario to see its connection closed');
});

When('SIGTERM reaches the process of the container entry', function () {
  assert.ok(entryOf(this).host?.emit('SIGTERM'), 'nothing listens to SIGTERM');
});

When('I run the compiled container entry file with the command {string}', async function (name: string) {
  const entry = entryOf(this);
  const child = spawn(
    process.execPath,
    [join(PKG, 'dist', 'src', 'container-entry.js'), String(entry.port), '--', ...commandOf(entry, name)],
    { env: { [RELAY_SOCKET_VARIABLE]: entry.socket }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stderr.resume();
  entry.code = await new Promise<number>((done) => child.once('close', (code) => done(code as number)));
  entry.compiledOut = out;
});

Then('the container entry ended with {int}', async function (code: number) {
  const entry = entryOf(this);
  if (entry.result !== undefined) await ended(this);
  assert.equal(entry.code, code);
});

Then('the stdout of the container entry is {string}', function (expected: string) {
  const entry = entryOf(this);
  assert.equal(entry.compiledOut ?? fileText(entry.outFile), expected);
});

Then('the stderr of the container entry holds {string}', async function (text: string) {
  const entry = entryOf(this);
  await until(() => fileText(entry.errFile).includes(text), `the stderr to hold ${text}`);
});

Then('the stderr of the container entry is empty', function () {
  assert.equal(fileText(entryOf(this).errFile), '');
});

Then(
  'the stderr of the container entry says its command was ended by {string}, and nothing else',
  function (signal: string) {
    assert.equal(
      fileText(entryOf(this).errFile),
      `container entry: ${process.execPath} ended by ${signal}\n`,
    );
  },
);

Then('the marker of the command was not written', function () {
  assert.ok(!existsSync(join(entryOf(this).dir, 'marker')));
});

Then('the port of the container entry is free again', async function () {
  const port = entryOf(this).port as number;
  const listening = await new Promise<boolean>((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
  assert.ok(listening, `port ${port} is still taken`);
});

Then('no SIGTERM listener of the container entry remains', function () {
  assert.equal(entryOf(this).host?.listenerCount('SIGTERM'), 0);
});

Then('the Unix socket server sees its connection closed', async function () {
  const entry = entryOf(this);
  await until(() => entry.unixClosed === 1, 'the Unix socket server to see the connection closed');
});
