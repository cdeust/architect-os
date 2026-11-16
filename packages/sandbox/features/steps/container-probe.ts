import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runContainerProbe,
  type Outcome,
  type ProbeReport,
  type ProbeTargets,
} from '../../src/container-probe.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';

interface Probe {
  dir: string;
  port?: number;
  outside?: number;
  writable?: string;
  unwritable?: string;
  cgroup?: string;
  printed?: string;
  report?: ProbeReport;
  /** The connections the listeners of the scenario accepted, and how many of them they saw closed. */
  accepted: number;
  closed: number;
}

function probeOf(world: SandboxWorld): Probe {
  if (world.state['probe'] === undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'aos-pr-'));
    world.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    world.state['probe'] = { dir, accepted: 0, closed: 0 } satisfies Probe;
  }
  return stored<Probe>(world, 'probe');
}

/** A loopback listener: with `answer`, it says it and ends the connection; without, it accepts and says nothing. */
function listen(world: SandboxWorld, answer: string | null): Promise<number> {
  const probe = probeOf(world);
  const sockets = new Set<{ destroy(): void }>();
  const server = createServer((socket) => {
    sockets.add(socket);
    probe.accepted += 1;
    socket.once('close', () => (probe.closed += 1));
    socket.on('error', () => undefined);
    if (answer !== null) socket.end(answer);
  });
  world.cleanups.push(() => {
    sockets.forEach((socket) => socket.destroy());
    server.close();
  });
  return new Promise((ready) =>
    server.listen(0, '127.0.0.1', () => ready((server.address() as AddressInfo).port)),
  );
}

/** A loopback port that was free a moment ago. */
function freePort(): Promise<number> {
  return new Promise((found) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => found(port));
    });
  });
}

Given('a probe listener that answers {string} and ends', async function (answer: string) {
  probeOf(this).port = await listen(this, answer);
});

Given('a probe listener that accepts and says nothing is the port', async function () {
  probeOf(this).port = await listen(this, null);
});

Given('a probe listener that accepts and says nothing is the address outside', async function () {
  probeOf(this).outside = await listen(this, null);
});

Given('a port of the probe that nothing listens on is the port', async function () {
  probeOf(this).port = await freePort();
});

Given('a port of the probe that nothing listens on is the address outside', async function () {
  probeOf(this).outside = await freePort();
});

Given('a probe folder that can be written', function () {
  const probe = probeOf(this);
  probe.writable = join(probe.dir, 'writable');
  mkdirSync(probe.writable);
});

/** A path under a regular file: nothing can be created there, whoever asks. */
Given('a probe folder that cannot be written', function () {
  const probe = probeOf(this);
  writeFileSync(join(probe.dir, 'a-file'), '');
  probe.unwritable = join(probe.dir, 'a-file', 'folder');
});

Given(
  'a probe cgroup folder holding {string} as {string}, {string} as {string} and no {string}',
  function (first: string, firstText: string, second: string, secondText: string, absent: string) {
    const probe = probeOf(this);
    probe.cgroup = join(probe.dir, 'cgroup');
    mkdirSync(probe.cgroup);
    assert.notEqual(absent, first);
    assert.notEqual(absent, second);
    writeFileSync(join(probe.cgroup, first), firstText.replaceAll('[newline]', '\n'));
    writeFileSync(join(probe.cgroup, second), secondText.replaceAll('[newline]', '\n'));
  },
);

function targetsOf(probe: Probe, boundMs: number): ProbeTargets {
  return {
    port: probe.port as number,
    outside: { host: '127.0.0.1', port: probe.outside as number },
    boundMs,
    unwritable: probe.unwritable === undefined ? [] : [probe.unwritable],
    writable: probe.writable === undefined ? [] : [probe.writable],
    cgroup: probe.cgroup as string,
  };
}

const parse = (probe: Probe) => {
  const printed = probe.printed as string;
  probe.report = JSON.parse(printed) as ProbeReport;
};

/** The probe in the scenario's own process, with a host that holds what it wrote. */
async function run(probe: Probe, argument: string): Promise<number> {
  probe.printed = '';
  return runContainerProbe({
    argv: ['node', 'container-probe-entry.js', argument],
    stdout: { write: (text: string) => (probe.printed += text) },
  });
}

When('I run the probe with the bound of {int} ms', async function (boundMs: number) {
  const probe = probeOf(this);
  assert.equal(await run(probe, JSON.stringify(targetsOf(probe, boundMs))), 0);
  parse(probe);
});

When('I try to run the probe with the argument {string}', async function (argument: string) {
  const probe = probeOf(this);
  this.state['probeRefusal'] = await run(probe, argument).then(
    () => null,
    (error: Error) => error,
  );
});

Then('the probe throws a {word} and prints nothing', function (name: string) {
  assert.equal(stored<Error | null>(this, 'probeRefusal')?.name, name);
  assert.equal(stored<Probe>(this, 'probe').printed, '');
});

Given(
  'the probe folder that can be written already holds the file of the probe, with {string}',
  function (text: string) {
    writeFileSync(join(probeOf(this).writable as string, `.aos-probe-${process.pid}`), text);
  },
);

Then(
  'the probe reports the write in the folder it can write as the error {string}, and the file still holds {string}',
  function (code: string, text: string) {
    const probe = stored<Probe>(this, 'probe');
    assert.deepEqual((probe.report as ProbeReport).writes[probe.writable as string], { error: code });
    assert.equal(readFileSync(join(probe.writable as string, `.aos-probe-${process.pid}`), 'utf8'), text);
  },
);

Then(
  'the listeners of the probe accepted {int} connection(s), and saw all of them closed',
  async function (count: number) {
    const probe = stored<Probe>(this, 'probe');
    // A listener learns of a connection, and of its end, after the probe returned.
    for (let waited = 0; probe.closed < count && waited < 2000; waited += 20)
      await new Promise((tick) => setTimeout(tick, 20));
    assert.equal(probe.accepted, count);
    assert.equal(probe.closed, count);
  },
);

When('I run the compiled probe file with the bound of {int} ms', async function (boundMs: number) {
  const probe = probeOf(this);
  const child = spawn(
    process.execPath,
    [join(PKG, 'dist', 'src', 'container-probe-entry.js'), JSON.stringify(targetsOf(probe, boundMs))],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stderr.resume();
  const code = await new Promise<number | null>((done) => child.once('close', done));
  assert.equal(code, 0);
  probe.printed = out;
  parse(probe);
});

const reportOf = (world: SandboxWorld): ProbeReport => stored<Probe>(world, 'probe').report as ProbeReport;

Then('the probe printed one line of JSON', function () {
  const printed = stored<Probe>(this, 'probe').printed as string;
  assert.ok(printed.endsWith('\n'), 'no end of line');
  assert.ok(!printed.slice(0, -1).includes('\n'), 'more than one line');
});

Then('the probe read {string} from the port', function (text: string) {
  assert.deepEqual(reportOf(this).read, { content: text });
});

Then('the probe reports the read as the error {string}', function (code: string) {
  assert.deepEqual(reportOf(this).read, { error: code });
});

Then('the probe reports the uid of its process', function () {
  assert.equal(reportOf(this).uid, (process as unknown as { getuid(): number }).getuid());
});

Then('the probe reports the names of the network interfaces of its host', function () {
  const names = Object.keys(networkInterfaces()).sort();
  assert.ok(names.length > 0);
  assert.deepEqual(reportOf(this).interfaces, names);
});

Then('the probe reports the connection outside as the error {string}', function (code: string) {
  assert.deepEqual(reportOf(this).outside, { error: code });
});

Then('the probe reports the connection outside as {string}', function (content: string) {
  assert.deepEqual(reportOf(this).outside, { content });
});

Then(
  'the probe reports the write in the folder it can write as written, and leaves nothing in it',
  function () {
    const probe = stored<Probe>(this, 'probe');
    assert.deepEqual((probe.report as ProbeReport).writes[probe.writable as string], { content: 'written' });
    assert.deepEqual(readdirSync(probe.writable as string), []);
  },
);

Then(
  'the probe reports the write in the folder it cannot write as the error {string}',
  function (code: string) {
    const probe = stored<Probe>(this, 'probe');
    assert.deepEqual((probe.report as ProbeReport).writes[probe.unwritable as string], { error: code });
  },
);

const cgroupFile = (world: SandboxWorld, name: string): Outcome | undefined =>
  (reportOf(world).cgroup as Record<string, Outcome>)[name];

Then('the probe reports the cgroup file {string} as {string}', function (name: string, content: string) {
  assert.deepEqual(cgroupFile(this, name), { content });
});

Then(
  'the probe reports the cgroup file {string} as the error {string}',
  function (name: string, code: string) {
    assert.deepEqual(cgroupFile(this, name), { error: code });
  },
);
