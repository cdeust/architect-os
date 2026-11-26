import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closedGit,
  closedGitOptions,
  hostConfiguredGitEnvironment,
  loadClosedGit,
  machineIndependentGitEnvironment,
  parseClosedGit,
  takenByName,
  type ClosedGit,
} from '../../src/git-closed.js';
import { Given, PKG, ROOT, Then, When, stored, type SandboxWorld } from './helpers.js';

const pairs = (variables: Readonly<Record<string, string>>): string =>
  Object.entries(variables)
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');

When('the committed closed git file is loaded', function () {
  this.state['closedGit'] = closedGit();
});

Then('the closed git options are {string}', function (options: string) {
  assert.equal(stored<ClosedGit>(this, 'closedGit').options.join(' '), options);
});

Then('the closed git variables are {string}', function (variables: string) {
  assert.equal(pairs(stored<ClosedGit>(this, 'closedGit').environment), variables);
});

Then(
  'the closed git variables of a call that reads no configuration of the machine are {string}',
  function (variables: string) {
    assert.equal(pairs(stored<ClosedGit>(this, 'closedGit').machineIndependent), variables);
  },
);

Then('the closed git names taken from the host are {string}', function (names: string) {
  assert.equal(stored<ClosedGit>(this, 'closedGit').host.join(' '), names);
});

interface File {
  options: unknown[];
  environment: Record<string, unknown>;
  machineIndependent: Record<string, unknown>;
  host: unknown[];
}

/** The committed file, changed in one way. */
const CHANGES: Record<string, (file: File) => string> = {
  nothing: (file) => JSON.stringify(file),
  'text that is not JSON': () => '{ not json',
  'a list in place of the object': () => '[]',
  'a key of its own': (file) => JSON.stringify({ ...file, extra: true }),
  'a key removed': ({ options, environment, host }) => JSON.stringify({ options, environment, host }),
  'no option': (file) => JSON.stringify({ ...file, options: [] }),
  'options that are not a list': (file) => JSON.stringify({ ...file, options: '--no-pager' }),
  'an option that is not text': (file) => JSON.stringify({ ...file, options: [...file.options, 1] }),
  'an option that is a subcommand': (file) =>
    JSON.stringify({ ...file, options: [...file.options, 'status'] }),
  'an option with one dash': (file) => JSON.stringify({ ...file, options: [...file.options, '-p'] }),
  'a -c with no value after it': (file) => JSON.stringify({ ...file, options: [...file.options, '-c'] }),
  'a -c whose value is another -c': (file) =>
    JSON.stringify({ ...file, options: [...file.options, '-c', '-c', 'a.b=c'] }),
  'a -c whose value sets nothing': (file) =>
    JSON.stringify({ ...file, options: [...file.options, '-c', 'a.b='] }),
  'a first option that is a configuration': (file) =>
    JSON.stringify({ ...file, options: ['a.b=c', ...file.options] }),
  'a variable that is not of git': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, XGIT_A: '1' } }),
  'a variable in lower case': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, GIT_a: '1' } }),
  'a variable with no value': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, GIT_X: '' } }),
  'a variable that is not text': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, GIT_X: 1 } }),
  'variables that are a list': (file) => JSON.stringify({ ...file, environment: [] }),
  'a machine variable that is not of git': (file) =>
    JSON.stringify({ ...file, machineIndependent: { ...file.machineIndependent, HOME: '/h' } }),
  'no name of the host': (file) => JSON.stringify({ ...file, host: [] }),
  'names of the host that are not a list': (file) => JSON.stringify({ ...file, host: 'PATH' }),
  'the name HOME': (file) => JSON.stringify({ ...file, host: [...file.host, 'HOME'] }),
  'the name XDG_CONFIG_HOME': (file) => JSON.stringify({ ...file, host: [...file.host, 'XDG_CONFIG_HOME'] }),
  'a name of the host that is a git variable': (file) =>
    JSON.stringify({ ...file, host: [...file.host, 'GIT_DIR'] }),
  'a name of the host in lower case': (file) => JSON.stringify({ ...file, host: [...file.host, 'path'] }),
  'a name of the host followed by a line end': (file) =>
    JSON.stringify({ ...file, host: [...file.host, 'USER\n'] }),
  'a name of the host that is not text': (file) => JSON.stringify({ ...file, host: [...file.host, 1] }),
  'a name of the host twice': (file) => JSON.stringify({ ...file, host: [...file.host, 'PATH'] }),
  'an option and a configuration added': (file) =>
    JSON.stringify({ ...file, options: [...file.options, '--no-pager', '-c', 'core.quotePath=false'] }),
  'no variable': (file) => JSON.stringify({ ...file, environment: {} }),
  'names that begin like refused ones': (file) =>
    JSON.stringify({ ...file, host: [...file.host, 'HOMEBREW_PREFIX', 'XDG_CONFIG_HOMES', 'GITHUB_ACTOR'] }),
};

Given('a copy of the committed closed git file with the change {string}', function (change: string) {
  const changed = CHANGES[change];
  assert.ok(changed !== undefined, change);
  this.state['closedGitText'] = changed(JSON.parse(readFileSync(join(PKG, 'git-closed.json'), 'utf8')));
});

/**
 * The guard reads the file beside itself: a copy of the guard in a throwaway tree laid out like the repository, with
 * the copy of the file, asked for the markers of an empty directory. Started as its launcher starts it
 * (packages/sandbox/src/git-worktree.ts): python in isolated mode, an empty environment.
 */
function guardReads(world: SandboxWorld, text: string): { status: number | null; stderr: string } {
  const tree = mkdtempSync(join(tmpdir(), 'aos-closed-git-'));
  world.cleanups.push(() => rmSync(tree, { recursive: true, force: true }));
  for (const folder of ['tools/test-gate', 'packages/sandbox', 'empty'])
    mkdirSync(join(tree, folder), { recursive: true });
  const guard = join(tree, 'tools/test-gate/with-tree-lock.py');
  copyFileSync(join(ROOT, 'tools/test-gate/with-tree-lock.py'), guard);
  writeFileSync(join(tree, 'packages/sandbox/git-closed.json'), text);
  const { status, stderr } = spawnSync('/usr/bin/python3', ['-I', guard, 'inspect-markers'], {
    cwd: join(tree, 'empty'),
    env: {},
    input: '',
    encoding: 'utf8',
  });
  return { status, stderr };
}

Then('the TypeScript module accepts the closed git copy', function () {
  const parsed = parseClosedGit(stored<string>(this, 'closedGitText'));
  assert.ok(!('failure' in parsed), JSON.stringify(parsed));
  assert.deepEqual(parsed, JSON.parse(stored<string>(this, 'closedGitText')));
});

Then('the TypeScript module refuses the closed git copy', function () {
  const text = stored<string>(this, 'closedGitText');
  const failure = text.startsWith('{ not')
    ? 'git-closed.json : JSON invalide'
    : 'git-closed.json : schéma refusé';
  assert.deepEqual(parseClosedGit(text), { failure });
});

Then('the guard accepts the closed git copy', function () {
  assert.deepEqual(guardReads(this, stored<string>(this, 'closedGitText')), { status: 0, stderr: '' });
});

Then('the guard refuses the closed git copy', function () {
  assert.deepEqual(guardReads(this, stored<string>(this, 'closedGitText')), {
    status: 2,
    stderr: 'gate: GATE_CLOSED_GIT_REFUSED\n',
  });
});

Then('loading the closed git copy throws {string}', function (message: string) {
  assert.throws(() => loadClosedGit(stored<string>(this, 'closedGitText')), { message });
});

Then(
  'the closed git options of a caller that adds {string} are {string}',
  function (own: string, options: string) {
    const added = own === '' ? [] : (own.split(' ') as `${string}=${string}`[]);
    assert.equal((own === '' ? closedGitOptions() : closedGitOptions(added)).join(' '), options);
  },
);

function setVariable(world: SandboxWorld, name: string, value: string | undefined): void {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  world.cleanups.push(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
}

Given(
  'the process has the closed git variable {string} set to {string}',
  function (name: string, value: string) {
    setVariable(this, name, value);
  },
);

Given('the process has no closed git variable {string}', function (name: string) {
  setVariable(this, name, undefined);
});

const expected = (table: { raw: () => string[][] }): Record<string, string> =>
  Object.fromEntries(table.raw().map(([name, value]) => [name as string, value ?? '']));

/** PATH and TMPDIR are those of the suite: checked against the process, then set aside. */
function besidePathAndTmpdir(environment: Record<string, string>): Record<string, string> {
  const { PATH, TMPDIR, ...rest } = environment;
  assert.equal(PATH, process.env['PATH']);
  assert.equal(TMPDIR, process.env['TMPDIR']);
  return rest;
}

Then(
  'the environment of a git that reads no configuration of the machine has, beside PATH and TMPDIR, exactly:',
  function (table: { raw: () => string[][] }) {
    assert.deepEqual(besidePathAndTmpdir(machineIndependentGitEnvironment()), expected(table));
  },
);

Then(
  'the environment of a git that reads no configuration of the machine, with the index {string}, has, beside PATH and TMPDIR, exactly:',
  function (index: string, table: { raw: () => string[][] }) {
    assert.deepEqual(
      besidePathAndTmpdir(machineIndependentGitEnvironment({ GIT_INDEX_FILE: index })),
      expected(table),
    );
  },
);

const hostOf = (text: string): Record<string, string> =>
  Object.fromEntries(text.split(' ').map((pair) => pair.split('=', 2) as [string, string]));

Then(
  'the environment of the git of a delivery whose list is {string} on a host that sets {string} is exactly:',
  function (names: string, host: string, table: { raw: () => string[][] }) {
    assert.deepEqual(
      hostConfiguredGitEnvironment(
        { names: names.split(' '), env: hostOf(host) },
        { GIT_TERMINAL_PROMPT: '0' },
      ),
      expected(table),
    );
  },
);

Then(
  'the names {string} taken from a host that sets {string} are {string}',
  function (names: string, host: string, taken: string) {
    assert.equal(pairs(takenByName(names.split(' '), hostOf(host))), taken);
  },
);
