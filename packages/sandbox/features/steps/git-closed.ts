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

const withOptions = (file: File, ...added: unknown[]): string =>
  JSON.stringify({ ...file, options: [...file.options, ...added] });
const withVariable = (file: File, name: string, value: unknown): string =>
  JSON.stringify({ ...file, environment: { ...file.environment, [name]: value } });
const withHost = (file: File, ...added: unknown[]): string =>
  JSON.stringify({ ...file, host: [...file.host, ...added] });

/** The committed file, changed in one way: its text, or its bytes when the change is one of bytes. */
const CHANGES: Record<string, (file: File) => string | Buffer> = {
  nothing: (file) => JSON.stringify(file),
  'text that is not JSON': () => '{ not json',
  // Python reads NaN as a number unless told not to, and keeps the last of a key given twice, as JSON.parse does.
  'a number that JSON does not have': (file) =>
    JSON.stringify(file).replace('"options":', '"options":NaN,"options":'),
  'a byte order mark': (file) =>
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(file))]),
  'the file in UTF-16': (file) =>
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(file), 'utf16le')]),
  'a byte that is not UTF-8': (file) => {
    const bytes = Buffer.from(withVariable(file, 'GIT_X', 'a?b'));
    bytes[bytes.indexOf('a?b') + 1] = 0xff;
    return bytes;
  },
  'a list in place of the object': () => '[]',
  'a key of its own': (file) => JSON.stringify({ ...file, extra: true }),
  'a key removed': ({ options, environment, host }) => JSON.stringify({ options, environment, host }),
  'no option': (file) => JSON.stringify({ ...file, options: [] }),
  'options that are not a list': (file) => JSON.stringify({ ...file, options: '--no-pager' }),
  'an option that is not text': (file) => withOptions(file, 1),
  'an option that is a subcommand': (file) => withOptions(file, 'status'),
  'an option with one dash': (file) => withOptions(file, '-p'),
  'an option with dashes after its first character': (file) => withOptions(file, 'x--no-pager'),
  'an option that holds a space': (file) => withOptions(file, '--no-pager status'),
  'a -c with no value after it': (file) => withOptions(file, '-c'),
  'a -c whose value is another -c': (file) => withOptions(file, '-c', '-c', 'a.b=c'),
  'a -c whose value sets nothing': (file) => withOptions(file, '-c', 'a.b='),
  'a -c whose value begins with dashes': (file) => withOptions(file, '-c', '--a.b=c'),
  'a -c whose value ends with a carriage return': (file) => withOptions(file, '-c', 'a.b=c\r'),
  'a first option that is a configuration': (file) =>
    JSON.stringify({ ...file, options: ['a.b=c', ...file.options] }),
  'a variable that is not of git': (file) => withVariable(file, 'XGIT_A', '1'),
  'a variable in lower case': (file) => withVariable(file, 'GIT_a', '1'),
  'a variable that ends in lower case': (file) => withVariable(file, 'GIT_Xa', '1'),
  'a variable named __proto__': (file) => withVariable(file, '__proto__', '1'),
  'a variable with no value': (file) => withVariable(file, 'GIT_X', ''),
  'a variable whose value ends with a line end': (file) => withVariable(file, 'GIT_X', '1\n'),
  'a variable whose value begins with a space': (file) => withVariable(file, 'GIT_X', ' 1'),
  'a variable that is not text': (file) => withVariable(file, 'GIT_X', 1),
  'variables that are a list': (file) => JSON.stringify({ ...file, environment: [] }),
  'variables that are a number': (file) => JSON.stringify({ ...file, environment: 1 }),
  'variables that are null': (file) => JSON.stringify({ ...file, environment: null }),
  'a machine variable that is not of git': (file) =>
    JSON.stringify({ ...file, machineIndependent: { ...file.machineIndependent, HOME: '/h' } }),
  'no name of the host': (file) => JSON.stringify({ ...file, host: [] }),
  'names of the host that are not a list': (file) => JSON.stringify({ ...file, host: 'PATH' }),
  'the name HOME': (file) => withHost(file, 'HOME'),
  'the name XDG_CONFIG_HOME': (file) => withHost(file, 'XDG_CONFIG_HOME'),
  'a name of the host that is a git variable': (file) => withHost(file, 'GIT_DIR'),
  'a name of the host in lower case': (file) => withHost(file, 'path'),
  'a name of the host that begins in lower case': (file) => withHost(file, 'xPATH'),
  'a name of the host followed by a line end': (file) => withHost(file, 'USER\n'),
  'a name of the host that is not text': (file) => withHost(file, 1),
  'a name of the host twice': (file) => withHost(file, 'PATH'),
  'an option and a configuration added': (file) =>
    withOptions(file, '--no-pager', '-c', 'core.quotePath=false'),
  'no variable': (file) => JSON.stringify({ ...file, environment: {} }),
  'names that begin like refused ones': (file) =>
    withHost(file, 'HOMEBREW_PREFIX', 'XDG_CONFIG_HOMES', 'GITHUB_ACTOR'),
};

const committed = (): File => JSON.parse(readFileSync(join(PKG, 'git-closed.json'), 'utf8')) as File;
const copy = (world: SandboxWorld): Buffer => stored<Buffer>(world, 'closedGitCopy');

Given('a copy of the committed closed git file with the change {string}', function (change: string) {
  const changed = CHANGES[change];
  assert.ok(changed !== undefined, change);
  this.state['closedGitCopy'] = Buffer.from(changed(committed()));
});

Given(
  'a copy of the committed closed git file with the variable {string} in its {string}',
  function (name: string, place: 'environment' | 'machineIndependent') {
    const file = committed();
    this.state['closedGitCopy'] = Buffer.from(
      JSON.stringify({ ...file, [place]: { ...file[place], [name]: 'of-the-copy' } }),
    );
  },
);

/**
 * The guard reads the file beside itself: a copy of the guard in a throwaway tree laid out like the repository, with
 * the copy of the file, asked for the markers of an empty directory. Started as its launcher starts it
 * (packages/sandbox/src/git-worktree.ts): python in isolated mode, an empty environment.
 */
function guardReads(world: SandboxWorld, bytes: Buffer): { status: number | null; stderr: string } {
  const tree = mkdtempSync(join(tmpdir(), 'aos-closed-git-'));
  world.cleanups.push(() => rmSync(tree, { recursive: true, force: true }));
  for (const folder of ['tools/test-gate', 'packages/sandbox', 'empty'])
    mkdirSync(join(tree, folder), { recursive: true });
  const guard = join(tree, 'tools/test-gate/with-tree-lock.py');
  copyFileSync(join(ROOT, 'tools/test-gate/with-tree-lock.py'), guard);
  writeFileSync(join(tree, 'packages/sandbox/git-closed.json'), bytes);
  const { status, stderr } = spawnSync('/usr/bin/python3', ['-I', guard, 'inspect-markers'], {
    cwd: join(tree, 'empty'),
    env: {},
    input: '',
    encoding: 'utf8',
  });
  return { status, stderr };
}

Then('the TypeScript module accepts the closed git copy', function () {
  assert.deepEqual(parseClosedGit(copy(this)), JSON.parse(copy(this).toString('utf8')));
});

Then('the TypeScript module refuses the closed git copy as text that is not JSON', function () {
  assert.deepEqual(parseClosedGit(copy(this)), { failure: 'git-closed.json : JSON invalide' });
});

Then('the TypeScript module refuses the closed git copy for its schema', function () {
  assert.deepEqual(parseClosedGit(copy(this)), { failure: 'git-closed.json : schéma refusé' });
});

Then('the guard accepts the closed git copy', function () {
  assert.deepEqual(guardReads(this, copy(this)), { status: 0, stderr: '' });
});

const GUARD_REFUSAL = { status: 2, stderr: 'gate: GATE_CLOSED_GIT_REFUSED\n' };

Then('the guard refuses the closed git copy as text that is not JSON', function () {
  assert.deepEqual(guardReads(this, copy(this)), GUARD_REFUSAL);
});

Then('the guard refuses the closed git copy for its schema', function () {
  assert.deepEqual(guardReads(this, copy(this)), GUARD_REFUSAL);
});

Then('loading the closed git copy throws {string}', function (message: string) {
  assert.throws(() => loadClosedGit(copy(this)), { message });
});

Then(
  'the closed git options of a caller that adds {string} are {string}',
  function (own: string, options: string) {
    const added = own === '' ? [] : (own.split(' ') as `${string}=${string}`[]);
    assert.equal((own === '' ? closedGitOptions() : closedGitOptions(added)).join(' '), options);
  },
);

Then(
  'the closed git options of the copy for a caller that adds {string} end with {string}',
  function (own: string, end: string) {
    const options = closedGitOptions([own as `${string}=${string}`], loadClosedGit(copy(this))).join(' ');
    assert.ok(options.endsWith(` ${end}`), options);
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

Then(
  'the environment of the git of a delivery that took {string} from the host is exactly:',
  function (taken: string, table: { raw: () => string[][] }) {
    const host = Object.fromEntries(taken.split(' ').map((pair) => pair.split('=', 2) as [string, string]));
    assert.deepEqual(hostConfiguredGitEnvironment(host, { GIT_TERMINAL_PROMPT: '0' }), expected(table));
  },
);

/** What each caller sets for itself, as it calls the module (tree-fingerprint.ts, the delivery's git-repository.ts). */
const BUILDERS: Record<string, (closed: ClosedGit) => Record<string, string>> = {
  'the fingerprint': (closed) => machineIndependentGitEnvironment({ GIT_INDEX_FILE: '/t/index' }, closed),
  'the delivery': (closed) =>
    hostConfiguredGitEnvironment({ PATH: '/bin' }, { GIT_TERMINAL_PROMPT: '0' }, closed),
};

function built(world: SandboxWorld, caller: string): Record<string, string> {
  const build = BUILDERS[caller];
  assert.ok(build !== undefined, caller);
  return build(loadClosedGit(copy(world)));
}

Then(
  /^building the environment of (the fingerprint|the delivery) from the copy throws "(.*)"$/,
  function (caller: string, message: string) {
    assert.throws(() => built(this, caller), { message });
  },
);

Then(
  /^building the environment of (the fingerprint|the delivery) from the copy gives the variable "(.*)" of the copy$/,
  function (caller: string, name: string) {
    assert.equal(built(this, caller)[name], 'of-the-copy');
  },
);

Then(
  /^building the environment of (the fingerprint|the delivery) from the copy gives no variable "(.*)"$/,
  function (caller: string, name: string) {
    assert.equal(Object.hasOwn(built(this, caller), name), false);
  },
);

Then(
  /^building the environment of (the fingerprint|the delivery) from the copy gives the variable "(.*)" of the delivery$/,
  function (caller: string, name: string) {
    assert.equal(built(this, caller)[name], '0');
  },
);

Then(
  'a real git given the environment of a git that reads no configuration of the machine lists only the configuration of its repository',
  function () {
    const repository = mkdtempSync(join(tmpdir(), 'aos-closed-git-'));
    this.cleanups.push(() => rmSync(repository, { recursive: true, force: true }));
    const env = machineIndependentGitEnvironment();
    const git = (...args: string[]): string => {
      const result = spawnSync('git', args, { cwd: repository, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    git('init', '-q');
    const scopes = git('config', '--list', '--show-scope')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('\t')[0]);
    assert.ok(scopes.length > 0);
    assert.deepEqual([...new Set(scopes)], ['local']);
  },
);
