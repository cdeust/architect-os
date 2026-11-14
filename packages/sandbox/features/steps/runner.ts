import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCapped } from '../../src/capped.js';
import { InMemorySandboxRunner } from '../../src/in-memory.js';
import type { Sandbox, SandboxExit, SandboxRunner } from '../../src/port.js';
import {
  SrtSandboxRunner,
  standardStreamsAreTerminals,
  type ProcessRunnerOptions,
  type SrtRunnerOptions,
} from '../../src/srt-runner.js';
import { Given, PKG, Then, When, messageMatches, stored, type SandboxWorld } from './helpers.js';

// The steps of the SandboxRunner contract are shared by the scenarios of packages/sandbox/features (in-memory)
// and of features/sandbox (real srt sandboxes): cucumber loads every step file in one run.

const SRT_CLI = createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js');

/** Un vrai dépôt git jetable avec un worktree à `<repo>/.claude/worktrees/w`. */
function makeRepo(): { root: string; worktree: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-runner-')));
  const repo = join(root, 'repo');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      stdio: 'ignore',
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: root },
    });
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'ignore' });
  git(
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.invalid',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'i',
  );
  git(repo, 'worktree', 'add', '-q', '-b', 'w', '.claude/worktrees/w');
  return { root, worktree: join(repo, '.claude', 'worktrees', 'w') };
}

const srtOptions = (extra: Partial<SrtRunnerOptions> = {}): SrtRunnerOptions => ({
  profilesDir: join(PKG, 'profiles'),
  srtCli: SRT_CLI,
  node: process.execPath,
  canaryProbe: join(PKG, 'src', 'canary-probe.mjs'),
  tmpRoot: tmpdir(),
  home: homedir(),
  hostEnv: { PATH: process.env['PATH'], HOME: process.env['HOME'] },
  trusted: [],
  variables: { authProxyPort: '9', sessionToken: 'contract-test' },
  ...extra,
});

const readAll = async (sandbox: Sandbox): Promise<string> => {
  let out = '';
  for await (const chunk of sandbox.stdout) out += String(chunk);
  return out;
};

/** The throwaway repository of the scenario, created on first use and removed by the After hook. */
function repoOf(world: SandboxWorld): { root: string; worktree: string } {
  if (world.state['repo'] === undefined) {
    const repo = makeRepo();
    world.cleanups.push(() => rmSync(repo.root, { recursive: true, force: true }));
    world.state['repo'] = repo;
  }
  return world.state['repo'] as { root: string; worktree: string };
}

/** Installs the srt runner over the scenario's repository; the working directory is its worktree. */
function useSrt(
  world: SandboxWorld,
  extra: (repo: { root: string; worktree: string }) => Partial<SrtRunnerOptions>,
) {
  const repo = repoOf(world);
  const runner = new SrtSandboxRunner(srtOptions(extra(repo)));
  world.state['runner'] = runner;
  world.state['srt'] = runner;
  world.state['cwd'] = repo.worktree;
}

Given('a {string} sandbox runner', function (adapter: string) {
  if (adapter === 'in-memory') {
    this.state['runner'] = new InMemorySandboxRunner(['builder']);
    this.state['cwd'] = '/unused';
  } else if (adapter === 'srt') {
    useSrt(this, () => ({}));
  } else assert.fail(`no adapter named "${adapter}"`);
});

Given('an srt runner over a throwaway git repository', function () {
  useSrt(this, () => ({}));
});

Given('an srt runner over a throwaway git repository whose descriptors are not terminals', function () {
  useSrt(this, () => ({ isTerminal: () => false }));
});

Given(
  'an srt runner over a throwaway git repository whose isatty says only descriptor 2 is not a terminal',
  function () {
    useSrt(this, () => ({ isatty: (fd: number) => fd !== 2 }));
  },
);

Given(
  'an srt runner over a throwaway git repository whose isatty says every descriptor is a terminal and whose srt cli is missing',
  function () {
    useSrt(this, (repo) => ({
      isatty: () => true,
      srtCli: join(repo.root, 'node_modules', 'srt', 'cli.js'),
    }));
  },
);

When('I check the standard streams with an isatty that accepts every descriptor', function () {
  const asked: number[] = [];
  this.state['asked'] = asked;
  this.state['streams'] = standardStreamsAreTerminals((fd) => {
    asked.push(fd);
    return true;
  });
});

When('I check the standard streams with an isatty that refuses descriptor {int}', function (refused: number) {
  this.state['streams'] = standardStreamsAreTerminals((fd) => fd !== refused);
});

Then('the standard streams are terminals', function () {
  assert.equal(this.state['streams'], true);
});

Then('the standard streams are not terminals', function () {
  assert.equal(this.state['streams'], false);
});

Then('isatty was asked about the descriptors {string}', function (expected: string) {
  assert.equal(stored<number[]>(this, 'asked').join(','), expected);
});

Given('an srt runner over a throwaway git repository whose srt cli is missing', function () {
  useSrt(this, (repo) => ({ srtCli: join(repo.root, 'node_modules', 'srt', 'cli.js') }));
});

Given('an srt runner over a throwaway git repository whose srt does not isolate', function () {
  useSrt(this, () => ({ srtCli: join(PKG, 'fixtures', 'no-isolation-srt.mjs') }));
});

Given(
  'an srt runner over a throwaway git repository that trusts a launcher file inside the worktree',
  function () {
    useSrt(this, (repo) => {
      const launcher = join(repo.worktree, 'launcher.ts');
      writeFileSync(launcher, '');
      return { trusted: [launcher] };
    });
  },
);

Given('the working directory is the main checkout of the repository', function () {
  this.state['cwd'] = join(repoOf(this).root, 'repo');
});

const runner = (world: SandboxWorld) => stored<SandboxRunner>(world, 'runner');
const sandbox = (world: SandboxWorld) => stored<Sandbox>(world, 'sandbox');

/** Keeps the error (or null) of an attempt, for the "is refused" step. */
async function attempt(world: SandboxWorld, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    world.state['refusal'] = null;
  } catch (error) {
    world.state['refusal'] = error;
  }
}

When(
  'I try to start profile {string} with command {string}',
  async function (profile: string, command: string) {
    await attempt(this, () =>
      runner(this).start({ profile, cwd: stored<string>(this, 'cwd'), command: command.split(' ') }),
    );
  },
);

When(
  'I try to run profile {string} with command {string} in the terminal',
  async function (profile: string, command: string) {
    const srt = stored<SrtSandboxRunner>(this, 'srt');
    await attempt(this, () =>
      srt.runInTerminal({ profile, cwd: stored<string>(this, 'cwd'), command: command.split(' ') }),
    );
  },
);

Then('it is refused with {string}', function (pattern: string) {
  const error = stored<unknown>(this, 'refusal');
  assert.ok(error !== null, 'the start was not refused');
  messageMatches(pattern)(error);
});

When('I start profile {string} with command {string}', async function (profile: string, command: string) {
  const started = await runner(this).start({
    profile,
    cwd: stored<string>(this, 'cwd'),
    command: command.split(' '),
  });
  this.state['sandbox'] = started;
  this.state['output'] = readAll(started);
});

When('I send the line {string} on its standard input and close it', function (line: string) {
  sandbox(this).stdin.end(`${line}\n`);
});

Then('its standard output is the line {string}', async function (line: string) {
  assert.equal(await stored<Promise<string>>(this, 'output'), `${line}\n`);
});

Then('it exits with code {int}', async function (code: number) {
  assert.equal((await sandbox(this).exited).code, code);
});

When('I stop it', async function () {
  sandbox(this).stdout.resume();
  this.state['stopExit'] = await sandbox(this).stop();
});

Then('the exit code of the stop is not 0', function () {
  assert.equal(stored<SandboxExit>(this, 'stopExit').code === 0, false);
});

Then('its exit is the same as the exit of the stop', async function () {
  assert.deepEqual(await sandbox(this).exited, stored<SandboxExit>(this, 'stopExit'));
});

When('I note the entries of the temporary directory', function () {
  this.state['before'] = execFileSync('ls', [tmpdir()], { encoding: 'utf8' });
});

When(
  'I start profile {string} with command {string}, close its input, drain its output and wait for it to end',
  async function (profile: string, command: string) {
    const started = await runner(this).start({
      profile,
      cwd: stored<string>(this, 'cwd'),
      command: command.split(' '),
    });
    this.state['sandbox'] = started;
    started.stdin.end();
    started.stdout.resume();
    await started.exited;
  },
);

Then('no per-sandbox folder is left in the temporary directory', function () {
  const before = stored<string>(this, 'before');
  const after = execFileSync('ls', [tmpdir()], { encoding: 'utf8' });
  const leftovers = after.split('\n').filter((f) => f.startsWith('aos-sandbox-') && !before.includes(f));
  assert.deepEqual(leftovers, []);
});

// --- canary.feature and spawn.feature (features/sandbox): real srt, a lying canary, a hostile child ---

Given('an srt runner over a throwaway git repository whose canary prints {string}', function (line: string) {
  useSrt(this, (repo) => {
    // Outside the worktree, which the sandbox may write: a trusted path must not be writable by it.
    const probe = join(repo.root, 'lying-canary.mjs');
    writeFileSync(probe, `process.stdout.write(${JSON.stringify(`${line}\n`)});\n`);
    return { canaryProbe: probe };
  });
});

/**
 * The token of the descendant of a scenario, in its argv: under Linux the sandbox has its own pid namespace, so the
 * pid it prints means nothing on the host (it once named a kernel thread there); the token does, in each /proc/<pid>/cmdline.
 */
export const descendantToken = (world: SandboxWorld): string => {
  world.state['descendantToken'] ??= `aos-descendant-${randomUUID()}`;
  return world.state['descendantToken'] as string;
};

/** Hostile scripts run by node inside the sandbox, one argv each, the token after them: no shell, no quoting. */
const HOSTILE: Record<string, string> = {
  'a descendant that ignores SIGTERM': [
    "const { spawn } = require('node:child_process');",
    // Bounded: a mutant that kills only the group leader leaves it for a minute, not forever.
    // The token (process.argv[1] under -e) is passed on: the descendant is found by it from the host (see below).
    "const child = spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\", () => {}); process.stdout.write(\"ready\"); setTimeout(() => {}, 60000)', process.argv[1]], { stdio: ['ignore', 'pipe', 'ignore'] });",
    // The pid is printed once the descendant ignores SIGTERM: before, any signal would kill it and prove nothing.
    "child.stdout.once('data', () => process.stdout.write(child.pid + '\\n'));",
    "process.on('SIGTERM', () => {});",
    'setInterval(() => {}, 1000);',
  ].join(' '),
  'five megabytes on stdout, then wait':
    "process.stdout.write('x'.repeat(5 * 1024 * 1024)); setInterval(() => {}, 1000);",
  'exit at once': 'process.exit(0);',
};

When(
  'I start profile {string} with the hostile script {string}',
  async function (profile: string, name: string) {
    const script = HOSTILE[name];
    assert.ok(script !== undefined, `no hostile script named "${name}"`);
    const started = await runner(this).start({
      profile,
      cwd: stored<string>(this, 'cwd'),
      command: ['node', '-e', script, descendantToken(this)],
    });
    this.state['sandbox'] = started;
  },
);

When('I read the pid the hostile script printed, then stop the sandbox', async function () {
  const s = sandbox(this);
  const line = await new Promise<string>((done) => {
    let text = '';
    s.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.includes('\n')) done(text.split('\n')[0] as string);
    });
  });
  this.state['descendant'] = { pid: Number(line), token: descendantToken(this) };
  await s.stop();
});

/**
 * The live processes of a descendant, as `pid state`; a zombie (`Z`), dead and not yet reaped, is not live. Linux:
 * every /proc/<pid> whose cmdline holds the token (proc(5)), whatever the pid namespace it was started in. Elsewhere
 * (macOS, no pid namespace): its pid, by kill(pid, 0), which ends with ESRCH once the process is reaped.
 */
const liveOf = ({ pid, token }: { pid: number; token: string }): string[] => {
  if (!existsSync('/proc')) {
    try {
      process.kill(pid, 0);
      return [`${pid} S`];
    } catch {
      return [];
    }
  }
  const live: string[] = [];
  for (const entry of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    try {
      if (!readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').includes(token)) continue;
      const state = readFileSync(`/proc/${entry}/stat`, 'utf8').split(') ')[1]?.charAt(0) ?? '';
      if (state !== 'Z') live.push(`${entry} ${state}`);
    } catch {
      /* gone while read */
    }
  }
  return live;
};

Then('the descendant is gone', async function () {
  const descendant = stored<{ pid: number; token: string }>(this, 'descendant');
  assert.ok(Number.isInteger(descendant.pid) && descendant.pid > 0, `no pid read: ${descendant.pid}`);
  let live = liveOf(descendant);
  for (let tries = 0; tries < 30 && live.length > 0; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    live = liveOf(descendant);
  }
  assert.deepEqual(live, [], `descendant ${descendant.token} still running`);
});

When(
  'I read its stdout capped at {int} bytes, then stop the sandbox on refusal',
  async function (bound: number) {
    const s = sandbox(this);
    this.state['cappedRefusal'] = await readCapped(s.stdout, bound).then(
      () => null,
      async (error: Error) => {
        this.state['stoppedExit'] = await s.stop();
        return error;
      },
    );
  },
);

Then('the capped read of the sandbox is refused with {string}', function (message: string) {
  assert.equal(stored<Error | null>(this, 'cappedRefusal')?.message, message);
});

Then('the stopped sandbox has exited', function () {
  assert.ok(this.state['stoppedExit'] !== undefined, 'the sandbox was not stopped');
});

When('I write two megabytes on its stdin and wait for it to end', async function () {
  const s = sandbox(this);
  s.stdout.resume();
  s.stderr.resume();
  s.stdin.end('y'.repeat(2 * 1024 * 1024));
  await s.exited;
});

Given('an srt runner for the processes of the platform over a throwaway platform root', function () {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-platform-')));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'marker'), 'platform');
  const options: ProcessRunnerOptions = {
    ...srtOptions({ variables: { callbackPort: '9' } }),
    workspace: 'disposable',
  };
  const runner = new SrtSandboxRunner(options);
  this.state['runner'] = runner;
  this.state['srt'] = runner;
  this.state['cwd'] = root;
});

When(
  'I start profile {string} with command {string} and read its output to its end',
  async function (profile: string, command: string) {
    const started = await runner(this).start({
      profile,
      cwd: stored<string>(this, 'cwd'),
      command: command.split(' '),
    });
    this.state['sandbox'] = started;
    started.stdin.end();
    started.stderr.resume();
    this.state['read'] = await readAll(started);
    await started.exited;
  },
);

Then(
  'its output is a folder named {string} inside a per-sandbox folder, of mode {string}',
  function (name: string, mode: string) {
    const [folder, got] = stored<string>(this, 'read').trim().split(':');
    const parts = (folder ?? '').split('/');
    assert.equal(parts.at(-1), name);
    assert.match(parts.at(-2) ?? '', /^aos-sandbox-/);
    assert.equal(got, mode);
  },
);

Then('its output is {string}', function (text: string) {
  assert.equal(stored<string>(this, 'read').trim(), text);
});

Then('it does not exit with code 0', async function () {
  assert.notEqual((await sandbox(this).exited).code, 0);
});

Given('the worktree holds a file {string} containing {string}', function (name: string, content: string) {
  writeFileSync(join(stored<string>(this, 'cwd'), name), content);
});

Then('the worktree holds no file {string}', function (name: string) {
  assert.equal(existsSync(join(stored<string>(this, 'cwd'), name)), false);
});

Then('the platform root holds no file {string}', function (name: string) {
  assert.equal(existsSync(join(stored<string>(this, 'cwd'), name)), false);
});
