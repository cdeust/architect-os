import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { readCapped } from '../../src/capped.js';
import { SandboxError, type SandboxRunner } from '../../src/port.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';
import { repoOf, tmpRootOf, usePlatform, useSrt } from './runner.js';

// features/sandbox/escape.feature (platform-v3-srt.md, §8, exit of 1b): each attack is a real command, run inside a
// real srt sandbox of one profile, or on the host for the witness; its failure or success is observed on the host.

/** What the host lays out for the attacks, under throwaway folders removed by the After hook. */
interface Bait {
  readonly home: string;
  readonly marker: string;
  /** `<home>/.ssh/id_test`, holding the marker. */
  readonly secret: string;
  /** A file directly under the home, absent: the attack tries to create it. */
  readonly outside: string;
  /** `.git/hooks/pre-commit` of the repository (of the platform root for module and worker), absent. */
  readonly hook: string;
  /** `.s.PGSQL.5432`, a Unix socket the host listens on; the count of the connections it accepted. */
  readonly socket: string;
  readonly connections: () => number;
  /** `aos-sb/s-other…/tmp/secret` beside the sandbox's own folder, both folders 0700, holding the marker. */
  readonly otherTask: string;
}

/** One command of an attack, as observed: its outputs and exit, or the refusal of its start. */
interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly refusal: unknown;
}

const OUTPUT_BOUND = 64 * 1024;

/** Lays out the bait but the hook: a throwaway home with its secret, a listened socket, another task's folder. */
async function layBait(world: SandboxWorld): Promise<Omit<Bait, 'hook'>> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-escape-')));
  world.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const marker = `aos-escape-marker-${randomUUID()}`;
  const home = join(root, 'home');
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  // The builder profile writes `${home}/.cache`: it exists, as in a real home.
  mkdirSync(join(home, '.cache'), { mode: 0o700 });
  const secret = join(home, '.ssh', 'id_test');
  writeFileSync(secret, `${marker}\n`, { mode: 0o600 });

  mkdirSync(join(root, 'pg'), { mode: 0o700 });
  const socket = join(root, 'pg', '.s.PGSQL.5432');
  let connections = 0;
  const server = createServer((peer) => {
    connections += 1;
    peer.destroy();
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(socket, done);
  });
  world.cleanups.push(() => new Promise<void>((done) => server.close(() => done())));

  // Beside the sandbox's own folder, in the same parent (`aos-sb` of the runner's tmpRoot), shaped like it.
  mkdirSync(join(tmpRootOf(world), 'aos-sb'), { recursive: true, mode: 0o700 });
  const other = realpathSync(mkdtempSync(join(tmpRootOf(world), 'aos-sb', 's-other')));
  world.cleanups.push(() => rmSync(other, { recursive: true, force: true }));
  mkdirSync(join(other, 'tmp'), { mode: 0o700 });
  const otherTask = join(other, 'tmp', 'secret');
  writeFileSync(otherTask, `${marker}\n`, { mode: 0o600 });

  return {
    home,
    marker,
    secret,
    outside: join(home, `escaped-${randomUUID()}`),
    socket,
    connections: () => connections,
    otherTask,
  };
}

/** A request to example.com or 169.254.169.254 by curl: prints `<CONNECT code> <response code>`, `000` for none. */
const curl = (url: string, seconds: number, direct: boolean): string[] => [
  'curl',
  '-s',
  ...(direct ? ['--noproxy', '*'] : []),
  '-o',
  '/dev/null',
  '-w',
  '%{http_connect} %{http_code}',
  '--max-time',
  String(seconds),
  url,
];

const CONNECT_SOCKET = [
  "const s = require('node:net').connect(process.argv[1]);",
  "s.on('connect', () => { process.stdout.write('connected'); process.exit(0); });",
  "s.on('error', (e) => { process.stdout.write(String(e.code)); process.exit(1); });",
].join(' ');

const hasMarker = (bait: Bait, run: Run) =>
  run.stdout.includes(bait.marker) || run.stderr.includes(bait.marker);

/** No HTTP response from the target: curl ran and its response code is `000`. */
const noResponse = (run: Run) =>
  assert.equal(run.stdout.split(' ')[1], '000', `an HTTP response was obtained: ${run.stdout} ${run.stderr}`);

/**
 * The count of the connections the attack made, without any delay: the host connects once itself, after the attack has
 * ended. The listener accepts in order and closes each peer, so when this last connection is closed every earlier
 * one has been counted; it is taken off the count.
 */
const attackConnections = (bait: Bait): Promise<number> =>
  new Promise((done, fail) => {
    const last = connect(bait.socket);
    last.once('error', fail);
    last.once('close', () => done(bait.connections() - 1));
    last.resume();
  });

interface Attack {
  readonly commands: (bait: Bait) => string[][];
  readonly failed: (bait: Bait, runs: readonly Run[]) => Promise<void> | void;
  /** The witness of a local attack: run on the host without srt, it succeeds. */
  readonly succeeded?: (bait: Bait, runs: readonly Run[]) => Promise<void> | void;
  /** A start refused with `COMMAND_NOT_FOUND` is the attack failing: the command does not exist on the host. */
  readonly absentIsFailure?: true;
}

const ATTACKS: Record<string, Attack> = {
  'reads the fake secret of the home': {
    commands: (b) => [['cat', b.secret]],
    failed: (b, [run]) => assert.equal(hasMarker(b, run as Run), false, 'the secret of the home was read'),
    succeeded: (b, [run]) => assert.equal(hasMarker(b, run as Run), true, 'the secret was not read'),
  },
  'writes a file directly under the home': {
    commands: (b) => [['touch', b.outside]],
    failed: (b) => assert.equal(existsSync(b.outside), false, `${b.outside} was written`),
    succeeded: (b) => assert.equal(existsSync(b.outside), true, `${b.outside} was not written`),
  },
  'writes the pre-commit hook of the repository': {
    commands: (b) => [['touch', b.hook]],
    failed: (b) => assert.equal(existsSync(b.hook), false, `${b.hook} was written`),
    succeeded: (b) => assert.equal(existsSync(b.hook), true, `${b.hook} was not written`),
  },
  'reaches example.com, through the proxy of its environment and directly': {
    commands: () => [curl('https://example.com/', 8, false), curl('https://example.com/', 8, true)],
    failed: (_, runs) => runs.forEach(noResponse),
  },
  'reaches 169.254.169.254 on port 80': {
    commands: () => [curl('http://169.254.169.254/', 3, true)],
    failed: (_, runs) => runs.forEach(noResponse),
  },
  'reaches the Postgres socket': {
    commands: (b) => [['node', '-e', CONNECT_SOCKET, b.socket]],
    failed: async (b) =>
      assert.equal(await attackConnections(b), 0, 'the host listener accepted a connection'),
    succeeded: async (b) =>
      assert.ok((await attackConnections(b)) > 0, 'the host listener saw no connection'),
  },
  'reads the folder of another task': {
    commands: (b) => [['cat', b.otherTask]],
    failed: (b, [run]) => assert.equal(hasMarker(b, run as Run), false, "another task's folder was read"),
    succeeded: (b, [run]) =>
      assert.equal(hasMarker(b, run as Run), true, "another task's folder was not read"),
  },
  'makes a nested user namespace': {
    commands: () => [['unshare', '-r', 'true']],
    failed: (_, [run]) => assert.notEqual(run?.code, 0, 'a nested user namespace was made'),
    absentIsFailure: true,
  },
};

const attackOf = (name: string): Attack => {
  const attack = ATTACKS[name];
  assert.ok(attack !== undefined, `no escape attack named "${name}"`);
  return attack;
};

/** Reads both outputs, bounded, and the exit; beyond the bound the sandbox is stopped and the read refused. */
async function observe(
  out: Readable,
  err: Readable,
  exited: Promise<{ code: number | null }>,
  stop: () => Promise<unknown>,
): Promise<Run> {
  try {
    const [stdout, stderr] = await Promise.all([
      readCapped(out, OUTPUT_BOUND),
      readCapped(err, OUTPUT_BOUND),
    ]);
    return { stdout: stdout.trim(), stderr, code: (await exited).code, refusal: null };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function inSandbox(world: SandboxWorld, command: string[]): Promise<Run> {
  const runner = stored<SandboxRunner>(world, 'runner');
  let sandbox;
  try {
    sandbox = await runner.start({
      profile: stored<string>(world, 'profile'),
      cwd: stored<string>(world, 'cwd'),
      command,
    });
  } catch (refusal) {
    return { stdout: '', stderr: '', code: null, refusal };
  }
  sandbox.stdin.end();
  return observe(sandbox.stdout, sandbox.stderr, sandbox.exited, sandbox.stop);
}

/** The same command on the host, no srt: a closed environment with the throwaway home. */
async function onHost(bait: Bait, command: string[]): Promise<Run> {
  const [name, ...args] = command as [string, ...string[]];
  const child = spawn(name, args, {
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: bait.home },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<{ code: number | null }>((done) => {
    child.once('error', () => done({ code: null }));
    child.once('close', (code) => done({ code }));
  });
  return observe(child.stdout, child.stderr, exited, async () => child.kill('SIGKILL'));
}

/** The hook of the repository: its `.git/hooks` exists, `pre-commit` does not. */
function withHook(base: Omit<Bait, 'hook'>, repo: string): Bait {
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  return { ...base, hook: join(repo, '.git', 'hooks', 'pre-commit') };
}

Given(
  'an srt runner for profile {string} over a throwaway home, beside the bait of every escape attack',
  async function (profile: string) {
    const base = await layBait(this);
    // The runner's home is the bait's: `${home}` of the profile, and HOME of srt and of the sandbox.
    const home = { home: base.home, hostEnv: { PATH: process.env['PATH'], HOME: base.home } };
    let repo: string;
    if (profile === 'builder' || profile === 'reviewer') {
      useSrt(this, () => home);
      repo = join(repoOf(this).root, 'repo');
    } else if (profile === 'module' || profile === 'worker') {
      repo = usePlatform(this, {
        ...home,
        variables: { callbackPort: '9', brokerPort: '9', taskToken: 'escape-test' },
      });
      execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
    } else assert.fail(`no profile named "${profile}"`);
    this.state['bait'] = withHook(base, repo);
    this.state['profile'] = profile;
  },
);

Given(
  'a throwaway git repository and a throwaway home, beside the bait of every escape attack, and no sandbox',
  async function () {
    this.state['bait'] = withHook(await layBait(this), join(repoOf(this).root, 'repo'));
  },
);

When(
  'it runs the escape attack {string} inside its sandbox',
  { timeout: 90_000 },
  async function (name: string) {
    const runs: Run[] = [];
    for (const command of attackOf(name).commands(stored<Bait>(this, 'bait')))
      runs.push(await inSandbox(this, command));
    this.state['attack'] = name;
    this.state['runs'] = runs;
  },
);

When('the host runs the escape attack {string} itself, without srt', async function (name: string) {
  const bait = stored<Bait>(this, 'bait');
  const runs: Run[] = [];
  for (const command of attackOf(name).commands(bait)) runs.push(await onHost(bait, command));
  this.state['attack'] = name;
  this.state['runs'] = runs;
});

Then('the escape attack failed, as the host observes it', async function () {
  const attack = attackOf(stored<string>(this, 'attack'));
  const runs = stored<Run[]>(this, 'runs');
  for (const run of runs) {
    if (run.refusal === null) continue;
    // A refused start proves nothing about the isolation, but for a command absent from the host (unshare on macOS).
    const absent = run.refusal instanceof SandboxError && run.refusal.code === 'COMMAND_NOT_FOUND';
    assert.ok(attack.absentIsFailure === true && absent, `the sandbox did not start: ${String(run.refusal)}`);
    return;
  }
  await attack.failed(stored<Bait>(this, 'bait'), runs);
});

Then('the escape attack succeeded, as the host observes it', async function () {
  const attack = attackOf(stored<string>(this, 'attack'));
  assert.ok(attack.succeeded !== undefined, 'this attack has no witness on the host');
  await attack.succeeded(stored<Bait>(this, 'bait'), stored<Run[]>(this, 'runs'));
});

/** The folders of a sandbox the profiles write, by the variable of the profile that names each (`disposable` is the cwd). */
const OWN_FOLDERS: Record<string, string> = { tmp: '${tmp}', config: '${config}', disposable: '${worktree}' };

/** Writes a file in the folder given as argv[1] (substituted by the adapter), reads it back, prints what it read. */
const WRITE_BACK = [
  "const fs = require('node:fs'); const f = process.argv[1] + '/positive-control';",
  "fs.writeFileSync(f, process.argv[2]); process.stdout.write(fs.readFileSync(f, 'utf8'));",
].join(' ');

When(
  'it writes a file in its own folder {string} inside its sandbox and reads it back',
  { timeout: 90_000 },
  async function (folder: string) {
    const variable = OWN_FOLDERS[folder];
    assert.ok(variable !== undefined, `no own folder named "${folder}"`);
    const written = `positive-control-${randomUUID()}`;
    this.state['written'] = written;
    this.state['runs'] = [await inSandbox(this, ['node', '-e', WRITE_BACK, variable, written])];
  },
);

Then('the content read back is the one written', function () {
  const [run] = stored<Run[]>(this, 'runs') as [Run];
  assert.equal(run.refusal, null, `the sandbox did not start: ${String(run.refusal)}`);
  assert.equal(run.stdout, stored<string>(this, 'written'), `nothing read back: ${run.stderr}`);
});
