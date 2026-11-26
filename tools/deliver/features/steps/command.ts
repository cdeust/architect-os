import { gateRuntime } from './gate-runtime.js';
import { runLocations } from '@architect-os/sandbox/runtime-context';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  statSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deliverDependencies,
  hostEnvironment,
  parseArguments,
  runDeliver,
  type DeliverDependencies,
} from '../../src/main.js';
import { runToEnd } from '../../src/infrastructure/host-process.js';
import { committedNames, hostOf, temporaryDirectory } from './fixtures.js';
import { ghForge, type GhForgeFixture } from './gh-fixture.js';
import { gitFixture, type GitFixture } from './git-fixture.js';
import { REPOSITORY, Given, Then, When, type DeliverWorld } from './support.js';

// The command as a whole (command.feature): the real adapters over a throwaway repository with a bare remote, the
// scripted client of the forge, the fixture gate and a temporary home. Nothing reaches the network.

const FAKE_GATE = `${REPOSITORY}tools/deliver/fixtures/fake-gate.mjs`;
const APPROVE = `${REPOSITORY}tools/deliver/approve`;
const COMMITTED = `${REPOSITORY}tools/deliver/deliver.json`;
// Stryker copies the scenario sources and links the installed workspace packages.
const INSTALLED = join(
  dirname(fileURLToPath(import.meta.resolve('@architect-os/sandbox/require-run'))),
  '../..',
);
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
  writeFileSync(
    command.config,
    JSON.stringify({ ...committed, gateCommand: [...gateCommand, String(command.gateCode)] }),
  );
}

Given(
  'a delivery command over a throwaway repository, the commit {string} ahead of both branches at {string}',
  function (commit: string, parent: string) {
    const git = gitFixture(this);
    writeFileSync(join(git.work, '.gitignore'), 'reports/\nnode_modules/\n');
    const edit = this.state['preflightEdit'] as { kind: string; path: string } | undefined;
    const file = join(git.work, edit?.path ?? 'ordinary.txt');
    mkdirSync(dirname(file), { recursive: true });
    if (edit && ['delete', 'rename out', 'mode'].includes(edit.kind)) writeFileSync(file, 'fixture\n');
    if (edit?.kind === 'rename in') writeFileSync(join(git.work, 'old-name'), 'fixture\n');
    git.commit(parent, undefined);
    git.setRemote('feat/gate-1a', parent);
    git.setRemote('main', parent);
    if (edit) {
      if (edit.kind === 'add') writeFileSync(file, 'fixture\n');
      if (edit.kind === 'delete') unlinkSync(file);
      if (edit.kind === 'rename out') renameSync(file, join(git.work, 'new-name'));
      if (edit.kind === 'rename in') renameSync(join(git.work, 'old-name'), file);
      if (edit.kind === 'mode') chmodSync(file, 0o755);
    }
    git.commit(commit, parent);
    const gh = ghForge(this);
    gh.hasRun(git.hashOf(commit), {
      id: 42,
      completed: true,
      jobs: [
        'gate-linux',
        'gate-macos',
        'gate-linux-cucumber-1',
        'gate-linux-cucumber-2',
        ...Array.from({ length: 16 }, (_, i) => i + 1).flatMap((lane) => [
          'gate-linux-lane-' + lane + ' / mutation',
          'gate-linux-lane-' + lane + ' / replay',
        ]),
      ].map((name) => ({ name, conclusion: 'success', hadRunner: true, failedStep: false })),
    });
    for (const branch of ['feat/gate-1a', 'main']) gh.evaluated(branch, git.hashOf(commit), 'pass');
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
      config: join(home, 'deliver.json'),
      stdout: '',
      stderr: '',
    };
    this.state['command'] = command;
    writeConfig(command);
    // The owner approved the publication of the commit, with the command of the repository.
    approve(command, ['publication', 'cdeust/architect-os', git.hashOf(commit)]);
  },
);

/** The owner's directory of approvals in a scenario: under the temporary home, written by the scenario's uid. */
const approvalsOf = (command: Command): string => join(command.home, 'approvals');

/** `tools/deliver/approve` with these arguments, into the scenario's directory; its exit code and its two outputs. */
function approve(command: Command, args: readonly string[]): { status: number; out: string; err: string } {
  const err = join(command.home, 'approve.stderr');
  const result = runToEnd('/bin/sh', ['-c', 'exec "$@" 2>"$0"', err, APPROVE, ...args], command.home, {
    PATH: '/usr/bin:/bin',
    ARCHITECT_OS_APPROVAL_DIRECTORY: approvalsOf(command),
  });
  assert.ok(result);
  return { ...result, err: readFileSync(err, 'utf8') };
}

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
    ...deliverDependencies(process),
    approvals: {
      directory: approvalsOf(command),
      owner: (world.state['approvalOwner'] as number | undefined) ?? process.getuid!(),
    },
    argv: argv === '' ? [] : argv.split(' '),
    cwd: fromWorktree ? command.git.work : command.home,
    env: {
      ...command.environment,
      ARCHITECT_OS_RUNTIME_ROOT: command.runtimeRoot,
      ...(fromWorktree ? {} : { INIT_CWD: command.git.work }),
    },
    stdout: { write: (text: string) => void (out.stdout += text) },
    stderr: { write: (text: string) => void (out.stderr += text) },
    gh: { program: command.gh.program, prefix: command.gh.prefix },
    // A timer that fires at once: the polls are not waited for.
    setTimer: (handler) => handler(),
    config: command.config,
  };
  await assert.doesNotReject(async () => {
    command.code = await runDeliver(dependencies);
  });
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

/** The two hashes of the scenario by their names. */
const named = (command: Command, text: string): string =>
  ['h1', 'p0'].reduce((shown, label) => shown.replaceAll(command.git.hashOf(label), label), text);

Then('the delivery command exited {int}', function (code: number) {
  assert.equal(commandOf(this).code, code);
});

/**
 * The bounds of the owner's record, given by the clock of the host when the scenario approved: shown as `NOW` and
 * `NOW+24h` once checked to be a day apart, the first within a minute of now.
 */
function approvalShown(text: string): string {
  return text.replace(
    /"approval":\{"approvedAt":(\d+),"expiresAt":(\d+)\}/,
    (_all, at: string, end: string) => {
      assert.equal(Number(end) - Number(at), 86_400);
      assert.ok(Math.abs(Number(at) - Date.now() / 1000) < 60, 'approved within the minute');
      return '"approval":{"approvedAt":"NOW","expiresAt":"NOW+24h"}';
    },
  );
}

Then('the delivery command printed on its standard output:', function (expected: string) {
  const command = commandOf(this);
  assert.equal(approvalShown(named(command, command.stdout)), `${expected}\n`);
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
    platform: process.platform,
    arch: process.arch,
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
  assert.equal(built.git, '/usr/bin/git');
  const gh =
    process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? '/opt/homebrew/bin/gh'
        : '/usr/local/bin/gh'
      : '/usr/bin/gh';
  assert.deepEqual(built.gh, { program: gh, prefix: [] });
  assert.deepEqual(built.approvals, { directory: '/etc/architect-os', owner: 0 });
  assert.equal(built.now, Date.now);
  assert.equal(
    built.hostPath,
    [
      dirname(process.execPath),
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ].join(':'),
  );
  assert.equal(built.gatePath, built.hostPath + ':' + join(INSTALLED, 'node_modules/.bin'));
  assert.equal(built.setTimer, setTimeout);
});

Then('the delivery dependencies hold the descriptive file of this package', function () {
  const { built } = this.state['dependencies'] as { built: DeliverDependencies };
  assert.equal(built.config, join(INSTALLED, 'tools/deliver/deliver.json'));
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
      { jobs: [{ name: 'producer', conclusion: 'success', runner_name: 'runner', steps: [] }] },
    ]),
  });
  gh.answers('attempt', '42/1', { exit: 89 });
});

Then('the delivery command only read the third and second job attempts, in order', function () {
  const calls = commandOf(this)
    .gh.asked()
    .filter((line) => line.includes('/attempts/'));
  assert.deepEqual(
    calls.map((line) => /\/attempts\/(\d+)\/jobs/.exec(line)?.[1]),
    ['3', '2'],
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

Given('the delivery preflight fixture applies {string} to {string}', function (kind: string, path: string) {
  this.state['preflightEdit'] = { kind, path };
});

Given('the delivery has a second unpublished commit', function () {
  commandOf(this).git.commit('h2', 'h1');
});

Given('the delivery candidate merges a second parent', function () {
  const { git } = commandOf(this);
  git.commit('other', 'p0');
  const merge = git
    .git(
      git.work,
      'commit-tree',
      git.hashOf('h1') + '^{tree}',
      '-p',
      git.hashOf('p0'),
      '-p',
      git.hashOf('other'),
      '-m',
      'two parents',
    )
    .trim();
  git.git(git.work, 'checkout', '--quiet', '--detach', merge);
});

Given(
  'the delivery owner approves the maintenance of {string} in {string} with intent {string}',
  function (name: string, repository: string, intent: string) {
    const c = commandOf(this);
    const given = approve(c, ['maintenance', repository, c.git.hashOf(name), intent]);
    assert.equal(given.status, 0, given.err);
  },
);

Given(
  'the delivery owner approves the publication of {string} in {string}',
  function (name: string, repository: string) {
    const c = commandOf(this);
    const given = approve(c, ['publication', repository, c.git.hashOf(name)]);
    assert.equal(given.status, 0, given.err);
  },
);

Given('the delivery owner withdraws the {word} approval', function (kind: string) {
  unlinkSync(join(approvalsOf(commandOf(this)), `delivery-${kind}.json`));
});

/** The record of that kind in the scenario's owner directory, changed by `edit`, rewritten by a rename as the owner's command does. */
function rewriteRecord(
  world: DeliverWorld,
  kind: string,
  edit: (record: Record<string, unknown>, now: number) => void,
): void {
  const path = join(approvalsOf(commandOf(world)), `delivery-${kind}.json`);
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  edit(record, Math.floor(Date.now() / 1000));
  writeFileSync(path + '.new', JSON.stringify(record), { mode: 0o644 });
  renameSync(path + '.new', path);
}

Given(
  'the delivery owner record of {word} has {string} set to {string}',
  function (kind: string, field: string, value: string) {
    // `NOW+90000`: 25 hours ahead of the host's clock; any other value as JSON.
    rewriteRecord(this, kind, (record, now) => {
      const at = /^NOW([+-]\d+)$/.exec(value);
      record[field] = at ? now + Number(at[1]) : JSON.parse(value);
    });
  },
);

Given(
  'the delivery owner record of {word} was given {int} seconds ago for {int} seconds',
  function (kind: string, ago: number, life: number) {
    rewriteRecord(this, kind, (record, now) => {
      record['approvedAt'] = now - ago;
      record['expiresAt'] = now - ago + life;
    });
  },
);

Given("the owner's approval directory of the delivery command is altered: {}", function (change: string) {
  const c = commandOf(this);
  const directory = approvalsOf(c);
  if (change === 'the record writable by all') chmodSync(join(directory, 'delivery-publication.json'), 0o666);
  else if (change === 'the directory writable by all') chmodSync(directory, 0o777);
  else if (change === 'the directory writable by its group') chmodSync(directory, 0o775);
  else if (change === 'the directory a link') {
    renameSync(directory, directory + '-elsewhere');
    symlinkSync(directory + '-elsewhere', directory);
  }
  // No file can be given to another uid without root: the command is told another uid is the owner instead.
  else if (change === 'the owner another uid') this.state['approvalOwner'] = process.getuid!() + 1;
  else assert.fail(`unknown change ${change}`);
});

Given('the gate of the delivery command withdraws the publication approval when it runs', function () {
  const c = commandOf(this);
  const config = JSON.parse(readFileSync(c.config, 'utf8')) as { gateCommand: string[] };
  const record = join(approvalsOf(c), 'delivery-publication.json');
  const wrapper = join(dirname(c.config), 'withdrawing-gate');
  writeFileSync(wrapper, `#!/bin/sh\n/bin/rm -f -- '${record}'\nexec "$@"\n`, { mode: 0o755 });
  config.gateCommand.unshift('withdrawing-gate');
  writeFileSync(c.config, JSON.stringify(config));
});

When('the owner runs the approval command with {string}', function (argv: string) {
  const c = commandOf(this);
  const result = approve(
    c,
    argv.split(' ').map((word) => word.replaceAll('HASH', c.git.hashOf('h1')).replaceAll('_', ' ')),
  );
  this.state['approval'] = result;
});

Then('the approval command refused with {string} and wrote nothing', function (code: string) {
  const c = commandOf(this);
  const result = this.state['approval'] as { status: number; out: string; err: string };
  assert.deepEqual(result, { status: 2, out: '', err: `approve: ${code}\n` });
  // The background's publication record is the only file: nothing was added, nothing left behind.
  assert.deepEqual(readdirSync(approvalsOf(c)), ['delivery-publication.json']);
});

Then(
  'the approval command wrote the {word} record of {string} for {int} hours',
  function (kind: string, name: string, hours: number) {
    const c = commandOf(this);
    const result = this.state['approval'] as { status: number; out: string; err: string };
    assert.equal(result.status, 0, result.err);
    const path = join(approvalsOf(c), `delivery-${kind}.json`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const stat = statSync(path);
    assert.equal(stat.mode & 0o777, 0o644);
    assert.equal(stat.nlink, 1);
    assert.equal(record['kind'], kind);
    assert.equal(record['repository'], 'cdeust/architect-os');
    assert.equal(record['commit'], c.git.hashOf(name));
    assert.equal(Number(record['expiresAt']) - Number(record['approvedAt']), hours * 3600);
    assert.ok(Math.abs(Number(record['approvedAt']) - Date.now() / 1000) < 60);
    assert.equal(
      result.out,
      `approved ${kind} of ${c.git.hashOf(name)} in cdeust/architect-os for ${hours} hours, until ${String(record['expiresAt'])} (epoch seconds)\n`,
    );
    assert.deepEqual(
      readdirSync(approvalsOf(c)).filter((n) => n.startsWith('.')),
      [],
      'no temporary file is left',
    );
  },
);

When(
  'the owner runs the approval command into the directory {string}, which root owns',
  function (directory: string) {
    const c = commandOf(this);
    // The suite does not run as root: a directory root owns is one the writing uid does not.
    assert.notEqual(process.getuid!(), 0);
    assert.equal(statSync(directory).uid, 0);
    const err = join(c.home, 'approve-usr.stderr');
    const result = runToEnd(
      '/bin/sh',
      ['-c', 'exec "$@" 2>"$0"', err, APPROVE, 'publication', 'cdeust/architect-os', c.git.hashOf('h1')],
      c.home,
      { PATH: '/usr/bin:/bin', ARCHITECT_OS_APPROVAL_DIRECTORY: directory },
    );
    assert.ok(result);
    this.state['approval'] = { ...result, err: readFileSync(err, 'utf8') };
  },
);

When('the approval command is run as this user into the owner directory', function () {
  const c = commandOf(this);
  const err = join(c.home, 'approve-root.stderr');
  const result = runToEnd(
    '/bin/sh',
    ['-c', 'exec "$@" 2>"$0"', err, APPROVE, 'publication', 'cdeust/architect-os', c.git.hashOf('h1')],
    c.home,
    { PATH: '/usr/bin:/bin' },
  );
  assert.ok(result);
  this.state['approval'] = { ...result, err: readFileSync(err, 'utf8') };
});

Then('the delivery preflight refused {string} without a trial', function (reason: string) {
  const c = commandOf(this);
  assert.deepEqual(JSON.parse(c.stdout), { outcome: 'stopped', phase: 'préalables', reason });
  assert.equal(c.code, 1);
  assert.equal(c.git.git(c.git.bare, 'for-each-ref', 'refs/heads/sentinel/'), '');
  assert.deepEqual(c.gh.asked(), []);
});

Given('the candidate puts harmless program names first on the delivery PATH', function () {
  const c = commandOf(this);
  const directory = join(c.git.work, 'node_modules/.bin');
  mkdirSync(directory, { recursive: true });
  for (const program of ['git', 'gh', 'npm', 'fixture-gate', 'node', 'deliver']) {
    writeFileSync(join(directory, program), '#!/bin/sh\n: > "$0.ran"\nexit 81\n', { mode: 0o755 });
  }
  c.environment.PATH = directory + ':' + c.environment.PATH;
  const config = JSON.parse(readFileSync(c.config, 'utf8'));
  writeFileSync(
    join(dirname(c.config), 'fixture-gate'),
    '#!/bin/sh\nprintf %s "$PATH" > "$0.path"\nexec "$@"\n',
    { mode: 0o755 },
  );
  config.gateCommand.unshift('fixture-gate');
  writeFileSync(c.config, JSON.stringify(config));
});

Then('the candidate program names recorded zero delivery calls', function () {
  const directory = join(commandOf(this).git.work, 'node_modules/.bin');
  for (const program of ['git', 'gh', 'npm', 'fixture-gate', 'node', 'deliver']) {
    assert.equal(existsSync(join(directory, program + '.ran')), false, program);
  }
});

When('the owner launcher delivers the candidate with a misleading INIT_CWD', function () {
  const c = commandOf(this);
  // Even a regression that tries to push stops at this disposable remote, before a real Gate or forge.
  c.git.git(c.git.bare, 'config', 'receive.hideRefs', 'refs/heads/sentinel/');
  const error = join(c.home, 'launcher.stderr');
  const result = runToEnd(
    '/bin/sh',
    ['-c', 'exec "$@" 2>"$0"', error, join(REPOSITORY, 'aos'), '--', 'deliver', 'step', '--until', 'ci'],
    c.git.work,
    { ...c.environment, INIT_CWD: c.home },
  );
  assert.ok(result);
  c.code = result.status;
  c.stdout = result.out;
  c.stderr = readFileSync(error, 'utf8');
});

Given('only the candidate holds exact {word} records', function (kind: string) {
  const c = commandOf(this);
  const now = Math.floor(Date.now() / 1000);
  const record = (k: string) =>
    JSON.stringify({
      kind: k,
      repository: 'cdeust/architect-os',
      commit: c.git.hashOf('h1'),
      approvedAt: now - 60,
      expiresAt: now + 3600,
      ...(k === 'maintenance' ? { intent: 'Change the fixture workflow' } : {}),
    });
  // In the tree, beside it, and named by the variables a regression might read: none is the owner's directory.
  // Both directories are ignored by the tree of the fixture: the tree stays clean, the refusal is the approval's.
  for (const directory of [join(c.git.work, 'node_modules'), join(c.git.work, 'reports/approvals')]) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `delivery-${kind}.json`), record(kind), { mode: 0o644 });
  }
  c.environment.ARCHITECT_OS_APPROVAL_DIRECTORY = join(c.git.work, 'reports/approvals');
  if (kind === 'publication') unlinkSync(join(approvalsOf(c), 'delivery-publication.json'));
});

Then(
  'on {word} {word} the installed forge program is {string}',
  function (platform: string, arch: string, program: string) {
    const dependencies = deliverDependencies({
      argv: [],
      env: {},
      platform,
      arch,
      stdout: process.stdout,
      stderr: process.stderr,
      cwd: () => '/fixture',
    });
    assert.deepEqual(dependencies.gh, { program, prefix: [] });
  },
);

Given('the delivery configuration itself is inside the candidate tree', function () {
  const c = commandOf(this);
  c.config = join(c.git.work, 'deliver.json');
  writeConfig(c);
});

When('the owner runs delivery from a directory outside a Git worktree', function () {
  const c = commandOf(this);
  const error = join(c.home, 'outside.stderr');
  const result = runToEnd(
    '/bin/sh',
    ['-c', 'exec "$@" 2>"$0"', error, join(REPOSITORY, 'aos'), '--', 'deliver', 'step'],
    c.home,
    { ...c.environment, PATH: c.home },
  );
  assert.deepEqual(result, { status: 2, out: '' });
  assert.equal(readFileSync(error, 'utf8'), 'aos: DELIVERY_WORKTREE_REQUIRED\n');
});

When('the installed launcher is itself the delivery subject', function () {
  const c = commandOf(this);
  const error = join(c.home, 'self.stderr');
  const result = runToEnd(
    '/bin/sh',
    ['-c', 'exec "$@" 2>"$0"', error, join(REPOSITORY, 'aos'), '--', 'deliver', 'step'],
    REPOSITORY,
    { ...c.environment, PATH: c.home },
  );
  assert.deepEqual(result, { status: 2, out: '' });
  assert.equal(readFileSync(error, 'utf8'), 'aos: DELIVERY_LAUNCHER_IN_SUBJECT\n');
});

Given('the installed delivery policy is in a sibling sharing the worktree name prefix', function () {
  const c = commandOf(this);
  const installed = c.git.work + '-release';
  mkdirSync(installed);
  const path = join(installed, 'deliver.json');
  copyFileSync(c.config, path);
  c.config = path;
});

Then('the scripted Gate and forge received their installed helper paths', function () {
  const c = commandOf(this);
  const installed = deliverDependencies(process);
  assert.equal(readFileSync(join(dirname(c.config), 'fixture-gate.path'), 'utf8'), installed.gatePath);
  assert.deepEqual(new Set(c.gh.searchPaths()), new Set([installed.hostPath]));
});
