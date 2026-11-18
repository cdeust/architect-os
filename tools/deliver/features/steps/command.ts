import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { deliverDependencies, parseArguments, runDeliver, type DeliverDependencies } from '../../src/main.js';
import { runToEnd } from '../../src/infrastructure/host-process.js';
import { temporaryDirectory } from './fixtures.js';
import { ghForge, type GhForgeFixture } from './gh-fixture.js';
import { gitFixture, type GitFixture } from './git-fixture.js';
import { REPOSITORY, Given, Then, When, type DeliverWorld } from './support.js';

// The command as a whole (command.feature): the real adapters over a throwaway repository with a bare remote, the
// scripted client of the forge, the fixture gate and a temporary home. Nothing reaches the network.

const FAKE_GATE = `${REPOSITORY}tools/deliver/fixtures/fake-gate.mjs`;
const COMMITTED = `${REPOSITORY}tools/deliver/deliver.json`;
const VERDICT = 'reports/gate-base.json';
const LOG = '.local/state/architect-os/deliveries.jsonl';

interface Command {
  git: GitFixture;
  gh: GhForgeFixture;
  home: string;
  /** The home the command is told, when it is not the temporary one. */
  toldHome?: string;
  /** The exit code the gate ends with; 0 leaves a verdict naming the commit. */
  gateCode: number;
  /** The descriptive file the command is given. */
  config: string;
  stdout: string;
  stderr: string;
  code?: number;
}

const commandOf = (world: DeliverWorld): Command => world.state['command'] as Command;

/** The descriptive file of the repository, with the gate of the scenario as its gate command. */
function writeConfig(command: Command): void {
  const hash = command.git.hashOf('h1');
  const verdict = JSON.stringify({ sha: hash, scenarios: [{ name: 'a' }] });
  const committed = JSON.parse(readFileSync(COMMITTED, 'utf8')) as Record<string, unknown>;
  const gateCommand = [
    process.execPath,
    FAKE_GATE,
    'quiet',
    VERDICT,
    command.gateCode === 0 ? verdict : 'none',
  ];
  writeFileSync(
    command.config,
    JSON.stringify({ ...committed, gateCommand: [...gateCommand, String(command.gateCode)] }),
  );
}

Given(
  'a delivery command over a throwaway repository, the commit {string} ahead of both branches at {string}',
  function (commit: string, parent: string) {
    const git = gitFixture(this);
    git.commit(parent, undefined);
    git.setRemote('feat/gate-1a', parent);
    git.setRemote('main', parent);
    // What the gate leaves in the worktree is not a change of the tree.
    writeFileSync(join(git.work, '.gitignore'), 'reports/\n');
    git.commit(commit, parent);
    const gh = ghForge(this);
    gh.hasRun(git.hashOf(commit), {
      id: 42,
      completed: true,
      jobs: [
        { name: 'gate-linux', conclusion: 'success', hadRunner: true, failedStep: false },
        { name: 'gate-macos', conclusion: 'success', hadRunner: true, failedStep: false },
      ],
    });
    for (const branch of ['feat/gate-1a', 'main']) gh.evaluated(branch, git.hashOf(commit), 'pass');
    const home = temporaryDirectory(this);
    const command: Command = {
      git,
      gh,
      home,
      gateCode: 0,
      config: join(home, 'deliver.json'),
      stdout: '',
      stderr: '',
    };
    this.state['command'] = command;
    writeConfig(command);
  },
);

Given('the gate of the delivery command is red from now on', function () {
  commandOf(this).gateCode = 1;
  writeConfig(commandOf(this));
});

Given('a file of the delivery command worktree changes', function () {
  commandOf(this).git.touchWorktree();
});

Given(
  'the forge of the delivery command exits {int} for the runs of {string}',
  function (code: number, commit: string) {
    const command = commandOf(this);
    command.gh.answers('runs', command.git.hashOf(commit), { exit: code, stdout: 'MARKER-9c2e' });
  },
);

Given(
  'the descriptive file of the delivery command has {string} set to {int}',
  function (key: string, value: number) {
    const committed = JSON.parse(readFileSync(COMMITTED, 'utf8')) as Record<string, unknown>;
    writeFileSync(commandOf(this).config, JSON.stringify({ ...committed, [key]: value }));
  },
);

Given('the descriptive file of the delivery command holds {string}', function (text: string) {
  writeFileSync(commandOf(this).config, text);
});

Given('the descriptive file of the delivery command is missing', function () {
  commandOf(this).config = join(commandOf(this).home, 'missing.json');
});

/** The command, run with `argv`; `env` and the working directory as the scenario says. */
async function run(world: DeliverWorld, argv: string, fromWorktree: boolean): Promise<void> {
  const command = commandOf(world);
  const out = { stdout: '', stderr: '' };
  const dependencies: DeliverDependencies = {
    argv: argv === '' ? [] : argv.split(' '),
    cwd: fromWorktree ? command.git.work : command.home,
    env: fromWorktree ? {} : { INIT_CWD: command.git.work },
    stdout: { write: (text: string) => void (out.stdout += text) },
    stderr: { write: (text: string) => void (out.stderr += text) },
    git: 'git',
    gh: { program: command.gh.program, prefix: command.gh.prefix },
    home: command.toldHome ?? command.home,
    // A timer that fires at once: the polls are not waited for.
    setTimer: (handler) => handler(),
    config: command.config,
  };
  command.code = await runDeliver(dependencies);
  command.stdout = out.stdout;
  command.stderr = out.stderr;
}

Given('the delivery command is told the home {string}', function (home: string) {
  commandOf(this).toldHome = home;
  // A relative home is refused before anything is written. Should that refusal ever be lost (a mutant of the mutation
  // run removes it), the log would land under the working directory of this process, which is a worktree of the
  // repository: the scenario then fails, and must still leave that worktree as it found it.
  if (!isAbsolute(home)) {
    assert.match(home, /^zz-deliver-[a-z-]+$/);
    this.cleanups.push(() => rmSync(join(process.cwd(), home), { recursive: true, force: true }));
  }
});

Then('the worktree of the delivery command holds no entry named {string}', function (name: string) {
  assert.equal(existsSync(join(commandOf(this).git.work, name)), false);
});

Then(
  'the delivery arguments {string} are read as the name {string} until {string}',
  function (argv: string, name: string, until: string) {
    assert.deepEqual(parseArguments(argv.split(' ')), { name, until });
  },
);

When('I run the delivery command with {string}', async function (argv: string) {
  await run(this, argv, false);
});

When(
  'I run the delivery command with {string} from the worktree, without INIT_CWD',
  async function (argv: string) {
    await run(this, argv, true);
  },
);

/** The two hashes of the scenario by their names. */
const named = (command: Command, text: string): string =>
  ['h1', 'p0'].reduce((shown, label) => shown.replaceAll(command.git.hashOf(label), label), text);

Then('the delivery command exited {int}', function (code: number) {
  assert.equal(commandOf(this).code, code);
});

Then('the delivery command printed on its standard output:', function (expected: string) {
  const command = commandOf(this);
  assert.equal(named(command, command.stdout), `${expected}\n`);
});

Then('the delivery command printed nothing on its standard output', function () {
  assert.equal(commandOf(this).stdout, '');
});

Then('the delivery command wrote on its standard error:', function (expected: string) {
  const command = commandOf(this);
  assert.equal(named(command, command.stderr), `${expected}\n`);
});

Then(
  'the remote of the delivery command holds {string} at the commit {string}',
  function (branch: string, label: string) {
    const { git, bare, hashOf } = commandOf(this).git;
    assert.equal(git(bare, 'rev-parse', '--verify', `refs/heads/${branch}`).trim(), hashOf(label));
  },
);

Then('the remote of the delivery command has no branch {string}', function (branch: string) {
  const { git, bare } = commandOf(this).git;
  assert.equal(git(bare, 'branch', '--list', branch), '');
});

Then('the log of the delivery command holds {int} lines', function (count: number) {
  const path = join(commandOf(this).home, LOG);
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n').slice(0, -1) : [];
  assert.equal(lines.length, count);
});

// The entry point and the dependencies of a process.

When('I build the delivery dependencies of a fake process', function () {
  const stdout = { write: () => true };
  const stderr = { write: () => true };
  const env = { INIT_CWD: '/somewhere' };
  const proc = {
    argv: ['node', 'cli.ts', 'step', '--until', 'ci'],
    env,
    stdout,
    stderr,
    cwd: () => '/working',
  };
  this.state['dependencies'] = { proc, built: deliverDependencies(proc) };
});

Then('the delivery dependencies hold what the process gives', function () {
  const { proc, built } = this.state['dependencies'] as {
    proc: { env: unknown; stdout: unknown; stderr: unknown };
    built: DeliverDependencies;
  };
  assert.deepEqual(built.argv, ['step', '--until', 'ci']);
  assert.equal(built.cwd, '/working');
  assert.equal(built.env, proc.env);
  assert.equal(built.stdout, proc.stdout);
  assert.equal(built.stderr, proc.stderr);
});

Then('the delivery dependencies hold git, gh, the home of the user and the timer of node', function () {
  const { built } = this.state['dependencies'] as { built: DeliverDependencies };
  assert.equal(built.git, 'git');
  assert.deepEqual(built.gh, { program: 'gh', prefix: [] });
  assert.equal(built.home, homedir());
  assert.equal(built.setTimer, setTimeout);
});

Then('the delivery dependencies hold the descriptive file of this package', function () {
  const { built } = this.state['dependencies'] as { built: DeliverDependencies };
  assert.equal(built.config, COMMITTED);
});

When('I start cli.ts of the delivery command with no argument', function () {
  this.state['started'] = runToEnd(
    process.execPath,
    ['--import', 'tsx', 'tools/deliver/src/cli.ts'],
    REPOSITORY,
    {},
  );
});

Then(
  'cli.ts of the delivery command exited {int} and printed nothing on its standard output',
  function (code: number) {
    assert.deepEqual(this.state['started'], { status: code, out: '' });
  },
);
