import { gateRuntime } from './gate-runtime.js';
import { runLocations } from '@architect-os/sandbox/runtime-context';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import {
  deliverDependencies,
  hostEnvironment,
  parseArguments,
  runDeliver,
  type DeliverDependencies,
} from '../../src/main.js';
import { createHash } from 'node:crypto';
import { pullRequestBody } from '../../src/domain/pull-request.js';
import { runToEnd } from '../../src/infrastructure/host-process.js';
import { stepRecord, stepRecordText } from './record-fixture.js';
import { committedNames, hostOf, temporaryDirectory } from './fixtures.js';
import { ghForge, REPO, type GhForgeFixture } from './gh-fixture.js';
import { gitFixture, type GitFixture } from './git-fixture.js';
import { REPOSITORY, Given, Then, When, type DeliverWorld } from './support.js';

// The command as a whole (command.feature): the real adapters over a throwaway repository with a bare remote, the
// scripted client of the forge, the fixture gate and a temporary home. Nothing reaches the network.

const FAKE_GATE = `${REPOSITORY}tools/deliver/fixtures/fake-gate.mjs`;
const COMMITTED = `${REPOSITORY}tools/deliver/deliver.json`;
const LOG = 'state/deliveries.jsonl';

interface Command {
  git: GitFixture;
  gh: GhForgeFixture;
  home: string;
  /** The home the command is told, when it is not the temporary one. */
  runtimeRoot: string;
  /** The environment of the process the command is started in: the host variables of the descriptive file, and what a scenario adds. */
  environment: Record<string, string>;
  /** Another bare repository, when a scenario makes one. */
  other?: string;
  /** The program that a scenario names as the GIT_SSH_COMMAND and the GIT_ASKPASS of the process. */
  witness?: string;
  /** The file that the pre-push hook of the worktree writes when it runs. */
  hookWitness?: string;
  /** The exit code the gate ends with; 0 leaves a verdict naming the commit. */
  gateCode: number;
  /** The receipt of the gate names the destination `p0`. */
  gateDestination: boolean;
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
  const committed = JSON.parse(readFileSync(COMMITTED, 'utf8')) as Record<string, unknown>;
  const gateCommand = [process.execPath, FAKE_GATE, 'publish', command.gateCode === 0 ? hash : 'none'];
  // The report of the receipt names the destination the gate judged the commit against: `p0`, unless none.
  const destination = command.gateDestination ? command.git.hashOf('p0') : 'none';
  writeFileSync(
    command.config,
    JSON.stringify({ ...committed, gateCommand: [...gateCommand, String(command.gateCode), destination] }),
  );
}

Given(
  'a delivery command over a throwaway repository, the commit {string} ahead of the destination at {string}',
  function (commit: string, parent: string) {
    const git = gitFixture(this);
    git.commit(parent, undefined);
    git.setRemote('main', parent);
    // What the gate leaves in the worktree is not a change of the tree.
    writeFileSync(join(git.work, '.gitignore'), 'reports/\n');
    git.commitWith(commit, parent, { file: { path: 'steps/step/record.json', text: stepRecordText() } });
    // The runs of the forge carry the display name the committed file asks for: the push entry of the gate.
    const { workflow } = JSON.parse(readFileSync(COMMITTED, 'utf8')) as { workflow: string };
    const gh = ghForge(this, workflow);
    gh.hasRun(git.hashOf(commit), {
      id: 42,
      completed: true,
      jobs: [
        'gate-linux',
        'gate-macos',
        'gate-linux-cucumber-1',
        'gate-linux-cucumber-2',
        'gate-linux-plan',
        // The lanes this run planned: the delivery takes however many the run holds.
        ...Array.from({ length: 3 }, (_, i) => i + 1).flatMap((lane) => [
          'gate-linux-lane-' + lane + ' / mutation',
          'gate-linux-lane-' + lane + ' / replay',
        ]),
      ].map((name) => ({ name, conclusion: 'success', hadRunner: true, failedStep: false })),
    });
    // What the forge sees of the work branch once the delivery pushed it.
    gh.hasBranch('deliver/step', git.hashOf(commit));
    const home = temporaryDirectory(this);
    const runtime = gateRuntime(this);
    const runtimeRoot = runtime.root;
    const command: Command = {
      runtimeRoot,
      git,
      gh,
      home,
      environment: {
        ...(hostOf(this).env as Record<string, string>),
        ...runtime.env,
        ARCHITECT_OS_HOST_XDG_CONFIG_HOME: 'set:' + home,
      },
      gateCode: 0,
      gateDestination: true,
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

Given('the receipt of the gate of the delivery command names no destination', function () {
  commandOf(this).gateDestination = false;
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
    env: {
      ...command.environment,
      ARCHITECT_OS_RUNTIME_ROOT: command.runtimeRoot,
      ...(fromWorktree ? {} : { INIT_CWD: command.git.work }),
    },
    stdout: { write: (text: string) => void (out.stdout += text) },
    stderr: { write: (text: string) => void (out.stderr += text) },
    git: 'git',
    gh: { program: command.gh.program, prefix: command.gh.prefix },
    // A timer that fires at once: the polls are not waited for.
    setTimer: (handler) => handler(),
    config: command.config,
  };
  command.code = await runDeliver(dependencies);
  command.stdout = out.stdout;
  command.stderr = out.stderr;
}

Given('the delivery command is told its runtime root as a path that is not absolute', function () {
  // The temporary home itself, written from the working directory of this process. Should the refusal ever be lost
  // (the mutation run removes it on purpose), the log lands in that temporary home, which the scenario removes, and
  // nowhere in a worktree of the repository.
  const command = commandOf(this);
  command.runtimeRoot = relative(process.cwd(), command.runtimeRoot);
  assert.equal(isAbsolute(command.runtimeRoot), false);
});

Then('the home of the delivery command holds no delivery log', function () {
  assert.equal(existsSync(join(commandOf(this).home, '.local/state/architect-os/deliveries.jsonl')), false);
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

/** The SHA-256 of the body of the pull request of the commit `h1`. */
const bodyOf = (command: Command): string =>
  createHash('sha256')
    .update(pullRequestBody(stepRecord(), { repository: REPO, hash: command.git.hashOf('h1'), name: 'step' }))
    .digest('hex');

/** The two hashes of the scenario by their names, and the SHA-256 of the body of its pull request as `BODY`. */
const named = (command: Command, text: string): string =>
  ['h1', 'p0'].reduce(
    (shown, label) => shown.replaceAll(command.git.hashOf(label), label),
    text.replaceAll(bodyOf(command), 'BODY'),
  );

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

Then(
  'the scripted forge of the delivery command was asked for {int} new pull request(s)',
  function (count: number) {
    assert.equal(commandOf(this).gh.created().length, count);
  },
);

Then('every new pull request the delivery command asked for is asked as no draft', function () {
  const { gh } = commandOf(this);
  const argv = gh.createdArguments();
  assert.ok(argv.length > 0);
  // Every field of the call: `draft` once, false, as a typed field; the others raw.
  const fields = argv.flatMap((argument, index) =>
    ['-f', '-F'].includes(argv[index - 1] ?? '') ? [argument] : [],
  );
  assert.deepEqual(
    fields.filter((field) => field.startsWith('draft=')),
    ['draft=false'],
  );
  assert.equal(argv[argv.indexOf('draft=false') - 1], '-F');
  assert.deepEqual(
    fields.map((field) => field.slice(0, field.indexOf('='))),
    ['head', 'base', 'title', 'body', 'draft'],
  );
});

Then(
  'the delivery command asked for a pull request from {string} to {string} titled {string}, with the body of the record',
  function (head: string, base: string, title: string) {
    const command = commandOf(this);
    const argv = command.gh.createdArguments();
    const field = (name: string): string | undefined =>
      argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
    assert.deepEqual(
      [field('head'), field('base'), field('title'), field('body')],
      [
        head,
        base,
        title,
        pullRequestBody(stepRecord(), { repository: REPO, hash: command.git.hashOf('h1'), name: 'step' }),
      ],
    );
  },
);

Then('the log of the delivery command holds {int} lines', function (count: number) {
  const path = join(commandOf(this).runtimeRoot, LOG);
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

Then('the delivery dependencies hold git, gh and the timer of node', function () {
  const { built } = this.state['dependencies'] as { built: DeliverDependencies };
  assert.equal(built.git, 'git');
  assert.deepEqual(built.gh, { program: 'gh', prefix: [] });
  assert.equal(built.setTimer, setTimeout);
});

Then('the delivery dependencies hold the descriptive file of this package', function () {
  const { built } = this.state['dependencies'] as { built: DeliverDependencies };
  assert.equal(built.config, COMMITTED);
});

When('I start cli.ts of the delivery command with no argument', function () {
  const keys = [
    'ARCHITECT_OS_RUNTIME_ROOT',
    'ARCHITECT_OS_RUN_DIR',
    'ARCHITECT_OS_HOST_XDG_CONFIG_HOME',
    'ARCHITECT_OS_ADMISSION_BINDING',
    ...Object.keys(runLocations('/', '/run')),
  ];
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  for (const key of keys) if (process.env[key] !== undefined) env[key] = process.env[key]!;
  const stderr = join(temporaryDirectory(this), 'cli.stderr');
  this.state['started'] = runToEnd(
    '/bin/sh',
    ['-c', 'exec "$@" 2>"$0"', stderr, process.execPath, '--import', 'tsx', 'tools/deliver/src/cli.ts'],
    REPOSITORY,
    env,
  );
  assert.equal(readFileSync(stderr, 'utf8'), 'architect-os deliver: usage: deliver <name> [--until ci]\n');
});

Then(
  'cli.ts of the delivery command exited {int} and printed nothing on its standard output',
  function (code: number) {
    assert.deepEqual(this.state['started'], { status: code, out: '' });
  },
);

// The closed environment of the real adapters (command.feature, rule: the environment of the process is not given to git)

Given(
  'the process of the delivery command has the variable {string} set to {string}',
  function (name: string, value: string) {
    commandOf(this).environment[name] = value;
  },
);

Given('the process of the delivery command has a GIT_DIR that names another repository', function () {
  const command = commandOf(this);
  const other = join(command.git.root, 'elsewhere.git');
  command.git.git(command.git.root, 'init', '--quiet', '--bare', other);
  command.environment['GIT_DIR'] = other;
});

Given(
  'the process of the delivery command injects by GIT_CONFIG_COUNT the rewrite of its remote to another remote',
  function () {
    const command = commandOf(this);
    const other = join(command.git.root, 'other.git');
    command.git.git(command.git.root, 'init', '--quiet', '--bare', other);
    command.other = other;
    Object.assign(command.environment, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${other}.insteadOf`,
      GIT_CONFIG_VALUE_0: command.git.bare,
    });
  },
);

Then('the other remote of the delivery command holds no branch', function () {
  const { git } = commandOf(this).git;
  assert.equal(git(commandOf(this).other as string, 'for-each-ref', 'refs/heads'), '');
});

Given(
  'the process of the delivery command names a witness program as its GIT_SSH_COMMAND and its GIT_ASKPASS',
  function () {
    const command = commandOf(this);
    const witness = join(temporaryDirectory(this), 'witness');
    writeFileSync(witness, '#!/bin/sh\n: > "$0.ran"\nexit 1\n');
    chmodSync(witness, 0o755);
    command.witness = witness;
    Object.assign(command.environment, { GIT_SSH_COMMAND: witness, GIT_ASKPASS: witness });
  },
);

Given('the remote of the delivery command is an address that only ssh could reach', function () {
  const { git, work } = commandOf(this).git;
  git(work, 'remote', 'set-url', 'origin', 'ssh://127.0.0.1:1/nothing.git');
});

When('git is started directly with the environment of the delivery command, witness included', function () {
  const command = commandOf(this);
  runToEnd('git', ['fetch', 'origin'], command.git.work, command.environment);
});

Then('the witness program of the delivery command has not run', function () {
  assert.equal(existsSync(`${commandOf(this).witness}.ran`), false);
});

Then('the witness program of the delivery command has run', function () {
  assert.equal(existsSync(`${commandOf(this).witness}.ran`), true);
});

Then(
  'every call of the scripted forge received exactly the variables of the list that the process had set, GH_TOKEN among them',
  function () {
    const set = committedNames().filter((name) => commandOf(this).environment[name] !== undefined);
    assert.ok(set.includes('GH_TOKEN'));
    const received = commandOf(this).gh.environments();
    assert.ok(received.length > 0);
    for (const names of received) assert.equal(names, [...set].sort().join(' '));
  },
);

Given('the worktree of the delivery command has a pre-push hook that writes a witness file', function () {
  const command = commandOf(this);
  const hooks = join(command.git.work, '.git', 'hooks');
  const witness = join(temporaryDirectory(this), 'pre-push.ran');
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, 'pre-push'), `#!/bin/sh\n: > '${witness}'\n`);
  chmodSync(join(hooks, 'pre-push'), 0o755);
  command.hookWitness = witness;
});

When(
  'git pushes directly from the worktree of the delivery command, without the options of the delivery',
  function () {
    const command = commandOf(this);
    const finished = runToEnd(
      'git',
      ['push', '--quiet', 'origin', 'HEAD:refs/heads/witness'],
      command.git.work,
      command.environment,
    );
    assert.equal(finished?.status, 0);
  },
);

Then('the pre-push hook of the delivery command has not run', function () {
  assert.equal(existsSync(commandOf(this).hookWitness as string), false);
});

Then('the pre-push hook of the delivery command has run', function () {
  assert.equal(existsSync(commandOf(this).hookWitness as string), true);
});

Given('the delivery command has its required producer only in the preceding attempt', function () {
  const { git, gh, config } = commandOf(this);
  const settings = JSON.parse(readFileSync(config, 'utf8'));
  settings.jobDependencies = {
    'gate-linux': { producers: ['producer'], admissionStep: 'Require all producers' },
  };
  writeFileSync(config, JSON.stringify(settings));
  const jobs = ['gate-linux', 'gate-macos'].map((name) => ({
    name,
    conclusion: 'success' as const,
    hadRunner: true,
    failedStep: false,
  }));
  gh.hasRun(git.hashOf('h1'), { id: 42, completed: true, attempt: 3, jobs });
  gh.answers('attempt', '42/2', {
    stdout: JSON.stringify([
      {
        total_count: 1,
        jobs: [{ id: 31, name: 'producer', conclusion: 'success', runner_name: 'runner', steps: [] }],
      },
    ]),
  });
  gh.answers('attempt', '42/1', { exit: 89 });
});

Given(
  'the {word} delivery command has a {word} latest pair with an older {word} lane',
  function (groups: string, pair: string, outcome: string) {
    const { git, gh, config } = commandOf(this);
    const settings = JSON.parse(readFileSync(config, 'utf8'));
    const planned = {
      'gate-linux': {
        producers: ['plan'],
        plannedProducers: { prefix: 'lane-', suffixes: ['-mutation', '-replay'] },
        admissionStep: 'Require all producers',
      },
    };
    const fixed = { 'gate-macos': { producers: ['mac-preflight'], admissionStep: 'Check macOS' } };
    const names = ['gate-linux', 'gate-macos', 'plan', 'lane-1-replay'];
    const configurations = {
      'planned-only': planned,
      'fixed-first': { ...fixed, ...planned },
      'planned-first': { ...planned, ...fixed },
    };
    assert.ok(Object.hasOwn(configurations, groups), groups);
    settings.jobDependencies = configurations[groups as keyof typeof configurations];
    if (Object.hasOwn(settings.jobDependencies, 'gate-macos')) names.push('mac-preflight');
    writeFileSync(config, JSON.stringify(settings));
    if (pair === 'complete') names.push('lane-1-mutation');
    const jobs = names.map((name) => ({
      name,
      conclusion: 'success' as const,
      hadRunner: true,
      failedStep: false,
    }));
    gh.hasRun(git.hashOf('h1'), { id: 42, completed: true, attempt: 2, jobs });
    const prior = ['lane-1-mutation', 'lane-2-mutation', 'lane-2-replay'].map((name, index) => ({
      id: index + 1,
      name,
      conclusion: name === 'lane-2-replay' ? outcome : 'success',
      runner_name: 'runner',
      steps: [],
    }));
    gh.answers('attempt', '42/1', { stdout: JSON.stringify([{ total_count: prior.length, jobs: prior }]) });
  },
);

Given('the older delivery attempt returns only one already seen job of three', function () {
  commandOf(this).gh.answers('attempt', '42/1', {
    stdout: JSON.stringify([
      {
        total_count: 3,
        jobs: [{ id: 91, name: 'lane-1-mutation', runner_name: 'runner', conclusion: 'success' }],
      },
    ]),
  });
});

Then('the delivery command read only job attempts {string} in order', function (attempts: string) {
  const calls = commandOf(this)
    .gh.asked()
    .filter((line) => line.includes('/attempts/'));
  assert.deepEqual(
    calls.map((line) => /\/attempts\/(\d+)\/jobs/.exec(line)?.[1]),
    attempts.split(', '),
  );
});

// What ./aos hands over to the delivery (environment-fresh.feature, rule: a delivery admitted by ./aos)

/** `NAME=VALUE,...`, each split at its first `=`, as an environment. */
const environmentOf = (text: string): Record<string, string> =>
  Object.fromEntries(
    text.split(',').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
  );

When('the host environment of a delivery is taken from a process with {string}', function (text: string) {
  this.state['hostEnvironment'] = hostEnvironment(environmentOf(text));
});

Then('the host environment of the delivery is {string}', function (text: string) {
  assert.deepEqual(this.state['hostEnvironment'], environmentOf(text));
});

Then(
  'every call of the scripted forge received exactly the variables of the list that the process had set but XDG_CONFIG_HOME',
  function () {
    const set = committedNames().filter(
      (name) => name !== 'XDG_CONFIG_HOME' && commandOf(this).environment[name] !== undefined,
    );
    assert.ok(
      commandOf(this).environment['XDG_CONFIG_HOME'] !== undefined,
      'the process has an XDG_CONFIG_HOME',
    );
    const received = commandOf(this).gh.environments();
    assert.ok(received.length > 0);
    for (const names of received) assert.equal(names, [...set].sort().join(' '));
  },
);
