import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { checkoutIsClean, visibleNestedMarker } from '../../src/git-worktree.js';
import { fingerprintTree, type TreeFingerprint } from '../../src/tree-fingerprint.js';
import { gitInFixture } from '../git-fixture.js';
import { Given, ROOT, Then, When } from './helpers.js';

// Where throwaway directories go, whatever TMPDIR a scenario sets for the fingerprint.
const ROOT_TMP = tmpdir();

interface Fingerprinting {
  directory: string;
  /** What the fingerprint of the first call, and of the last, gave. */
  results: TreeFingerprint[];
  error?: unknown;
  before?: { status: string; index: Buffer };
  after?: { status: string; index: Buffer };
  /** The directory that is the TMPDIR of the fingerprint, which must be left empty. */
  tmp?: string;
  /** The log of the fake git. */
  log?: string;
  /** The directory of the fake git: the log, and the answers it is told to give. */
  bin?: string;
  /** The second repository, which the variables of the process name. */
  other?: string;
}
/** The state of the scenario, made by the first step that needs it: the Given steps come in any order. */
const fp = (world: { state: Record<string, unknown> }): Fingerprinting =>
  (world.state['fingerprinting'] ??= { directory: '', results: [] }) as Fingerprinting;

export const git = (directory: string, ...args: string[]): string =>
  gitInFixture(directory, [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    '-c',
    'commit.gpgsign=false',
    ...args,
  ]).trim();

const throwaway = (world: { state: Record<string, unknown>; cleanups: (() => void)[] }): string => {
  const directory = mkdtempSync(join(ROOT_TMP, 'aos-fp-'));
  world.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  fp(world).directory = directory;
  return directory;
};

/** A repository of one commit that holds `.gitignore` and the file `tracked`. */
const commitOne = (directory: string, tracked: string): void => {
  git(directory, 'init', '-q');
  writeFileSync(join(directory, '.gitignore'), '*.log\n');
  writeFileSync(join(directory, tracked), 'first\n');
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'first');
};

Given('a throwaway repository with one commit', function () {
  commitOne(throwaway(this), 'a.txt');
});

// A repository nested in the tree: what a session can leave in its worktree. Its own configuration names the witness as
// the `clean` filter of one file, left racy (rewritten with the same size right after it entered the nested index), so
// that a git that enters the nested repository must run the filter to know whether the file changed.
Given(
  'a repository nested in the repository at {string} names a witness program as a filter',
  function (name: string) {
    const witness = join(mkdtempSync(join(ROOT_TMP, 'aos-fp-witness-')), 'witness');
    this.cleanups.push(() => rmSync(dirname(witness), { recursive: true, force: true }));
    writeFileSync(witness, `#!/bin/sh\n: > '${witness}.ran'\ncat\n`);
    chmodSync(witness, 0o755);
    const nested = join(fp(this).directory, name);
    mkdirSync(nested, { recursive: true });
    git(nested, 'init', '-q');
    writeFileSync(join(nested, '.gitattributes'), 'f.txt filter=witness\n');
    writeFileSync(join(nested, 'f.txt'), 'inner\n');
    git(nested, 'add', '-A');
    git(nested, 'commit', '-q', '-m', 'inner');
    const configuration = join(nested, '.git', 'config');
    writeFileSync(
      configuration,
      `${readFileSync(configuration, 'utf8')}[filter "witness"]\n\tclean = ${witness}\n`,
    );
    git(nested, 'add', 'f.txt');
    writeFileSync(join(nested, 'f.txt'), 'outer\n');
    rmSync(`${witness}.ran`, { force: true });
    this.state['fingerprintWitness'] = witness;
  },
);

Given('the repository replaces its head commit by a commit of another tree', function () {
  const { directory } = fp(this);
  const other = git(directory, 'commit-tree', git(directory, 'mktree', '--missing'), '-m', 'other');
  git(directory, 'replace', git(directory, 'rev-parse', 'HEAD'), other);
});

// The configuration names an attributes file outside the tree that gives every file a filter whose program is the witness.
Given(
  'the configuration of the repository names an attributes file whose filter is a witness program',
  function () {
    const witness = join(mkdtempSync(join(ROOT_TMP, 'aos-fp-witness-')), 'witness');
    this.cleanups.push(() => rmSync(dirname(witness), { recursive: true, force: true }));
    writeFileSync(witness, `#!/bin/sh\n: > '${witness}.ran'\nexec cat\n`);
    chmodSync(witness, 0o755);
    writeFileSync(join(dirname(witness), 'attributes'), '* filter=witness\n');
    const configuration = join(fp(this).directory, '.git', 'config');
    writeFileSync(
      configuration,
      `${readFileSync(configuration, 'utf8')}[core]\n\tattributesFile = ${join(dirname(witness), 'attributes')}\n` +
        `[filter "witness"]\n\tclean = ${witness}\n`,
    );
    this.state['fingerprintWitness'] = witness;
  },
);

Then('the witness program of the configuration of the repository has not run', function () {
  assert.equal(witnessRan(this), false);
});

Given('the file {string} of the repository is committed whatever ignores it', function (file: string) {
  const { directory } = fp(this);
  mkdirSync(dirname(join(directory, file)), { recursive: true });
  writeFileSync(join(directory, file), 'kept\n');
  git(directory, 'add', '-A');
  git(directory, 'add', '-f', file);
  git(directory, 'commit', '-q', '-m', 'kept');
});

Given('everything in the repository is committed', function () {
  const { directory } = fp(this);
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'everything');
});

When(
  'a git with none of the options of the fingerprint is asked for the status of the repository',
  function () {
    git(fp(this).directory, 'status', '--porcelain');
  },
);

const witnessRan = (world: { state: Record<string, unknown> }): boolean => {
  const witness = world.state['fingerprintWitness'];
  assert.equal(typeof witness, 'string', 'a nested repository with a witness program must be given first');
  return existsSync(`${witness as string}.ran`);
};

Then('the witness program of the nested repository has not run', function () {
  assert.equal(witnessRan(this), false);
});

Then('the witness program of the nested repository has run', function () {
  assert.equal(witnessRan(this), true);
});

Then('the fingerprint tree holds the file {string} with the bytes it has on disk', function (file: string) {
  const state = fp(this);
  const raw = git(state.directory, 'hash-object', '--no-filters', '--', file);
  const entry = git(state.directory, 'ls-tree', state.results[0]?.tree ?? '', '--', file);
  assert.equal(entry.split(/\s+/)[2], raw);
});

Given('a second throwaway repository with one commit', function () {
  const directory = mkdtempSync(join(ROOT_TMP, 'aos-fp-other-'));
  this.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  commitOne(directory, 'other.txt');
  fp(this).other = directory;
});

Given('the GIT_DIR and the GIT_WORK_TREE of the process name the second repository', function () {
  const other = fp(this).other as string;
  setEnv(this, 'GIT_DIR', join(other, '.git'));
  setEnv(this, 'GIT_WORK_TREE', other);
});

Given('the configuration of the process, by GIT_CONFIG_COUNT, makes core.autocrlf input', function () {
  setEnv(this, 'GIT_CONFIG_COUNT', '1');
  setEnv(this, 'GIT_CONFIG_KEY_0', 'core.autocrlf');
  setEnv(this, 'GIT_CONFIG_VALUE_0', 'input');
});

Given('a directory that is not a repository', function () {
  throwaway(this);
});

Given('a throwaway directory', function () {
  throwaway(this);
});

Given('the file {string} of the repository holds {string}', function (file: string, text: string) {
  const path = join(fp(this).directory, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replaceAll('\\n', '\n').replaceAll('\\r', '\r'));
});

Given(
  'the configuration of the host, in the HOME and in the XDG_CONFIG_HOME of the process, converts line endings and excludes {string}',
  function (pattern: string) {
    // The global configuration of git, for this scenario, in the two places where git looks for it: `~/.gitconfig` and
    // `$XDG_CONFIG_HOME/git/config`. Each sets `core.autocrlf` and names an exclusion file that names the pattern.
    const home = mkdtempSync(join(ROOT_TMP, 'aos-fp-home-'));
    const xdg = mkdtempSync(join(ROOT_TMP, 'aos-fp-xdg-'));
    this.cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    this.cleanups.push(() => rmSync(xdg, { recursive: true, force: true }));
    writeFileSync(join(home, 'ignore'), `${pattern}\n`);
    const configuration = (ignore: string) => `[core]\n\tautocrlf = true\n\texcludesFile = ${ignore}\n`;
    writeFileSync(join(home, '.gitconfig'), configuration(join(home, 'ignore')));
    mkdirSync(join(xdg, 'git'));
    writeFileSync(join(xdg, 'ignore'), `${pattern}\n`);
    writeFileSync(join(xdg, 'git', 'config'), configuration(join(xdg, 'ignore')));
    // The default global exclusion files, which git reads without any configuration, even when GIT_CONFIG_GLOBAL is an
    // empty file: `$XDG_CONFIG_HOME/git/ignore`, and `$HOME/.config/git/ignore` when XDG_CONFIG_HOME is not set.
    writeFileSync(join(xdg, 'git', 'ignore'), `${pattern}\n`);
    mkdirSync(join(home, '.config', 'git'), { recursive: true });
    writeFileSync(join(home, '.config', 'git', 'ignore'), `${pattern}\n`);
    setEnv(this, 'HOME', home);
    setEnv(this, 'XDG_CONFIG_HOME', xdg);
  },
);

Given('a temporary directory that the fingerprint must leave empty', function () {
  const tmp = mkdtempSync(join(ROOT_TMP, 'aos-fp-tmp-'));
  const before = process.env['TMPDIR'];
  process.env['TMPDIR'] = tmp;
  this.cleanups.push(() => {
    if (before === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = before;
    rmSync(tmp, { recursive: true, force: true });
  });
  fp(this).tmp = tmp;
});

const take = (state: Fingerprinting, timeoutMs?: number): void => {
  state.results.push(fingerprintTree(state.directory, timeoutMs));
};

When('I take the fingerprint of the repository', function () {
  take(fp(this));
});
When('I take the fingerprint of the repository again', function () {
  take(fp(this));
});
When('I take the fingerprint of the directory', function () {
  take(fp(this));
});

const attempt = (state: Fingerprinting, timeoutMs?: number): void => {
  try {
    take(state, timeoutMs);
  } catch (error) {
    state.error = error;
  }
};
When('I try to take the fingerprint of it', function () {
  attempt(fp(this));
});
When('I try to take the fingerprint of the directory', function () {
  attempt(fp(this));
});
When(
  'I try to take the fingerprint of the directory with a bound of {int} milliseconds',
  function (ms: number) {
    attempt(fp(this), ms);
  },
);

const status = (directory: string): string => git(directory, 'status', '--porcelain');

When(
  'I take the fingerprint of the repository, noting the status and the index before and after',
  function () {
    const state = fp(this);
    const index = () => readFileSync(join(state.directory, '.git', 'index'));
    // Git refreshes the index when it reads the status: the bytes are read after it, and before the next one.
    const beforeStatus = status(state.directory);
    state.before = { status: beforeStatus, index: index() };
    take(state);
    const afterIndex = index();
    state.after = { status: status(state.directory), index: afterIndex };
  },
);

Then('the fingerprint commit is the HEAD of the repository', function () {
  const state = fp(this);
  assert.equal(state.results[0]?.commit, git(state.directory, 'rev-parse', 'HEAD'));
  assert.match(state.results[0]?.commit ?? '', /^[0-9a-f]{40}$/);
});

Then('the fingerprint tree is the tree of HEAD', function () {
  const state = fp(this);
  assert.equal(state.results[0]?.tree, git(state.directory, 'rev-parse', 'HEAD^{tree}'));
});

Then('the fingerprint is clean', function () {
  assert.equal(fp(this).results[0]?.clean, true);
});

Then('the fingerprint is not clean', function () {
  assert.equal(fp(this).results[0]?.clean, false);
});

Then('the fingerprint tree is the tree that committing everything would give', function () {
  const state = fp(this);
  git(state.directory, 'add', '-A');
  git(state.directory, 'commit', '-q', '-m', 'second');
  assert.equal(state.results[0]?.tree, git(state.directory, 'rev-parse', 'HEAD^{tree}'));
});

Then('the two fingerprints are the same', function () {
  const { results } = fp(this);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], results[1]);
});

Then('the two fingerprints have two different trees', function () {
  const { results } = fp(this);
  assert.equal(results.length, 3);
  assert.notEqual(results[2]?.tree, results[1]?.tree);
  assert.equal(results[2]?.commit, results[1]?.commit);
});

Then('the status and the index file are the same before and after', function () {
  const { before, after } = fp(this);
  assert.ok(before && after);
  assert.equal(after.status, before.status);
  assert.ok(after.index.equals(before.index));
});

Then('the status still lists the untracked file {string}', function (file: string) {
  assert.ok(fp(this).after?.status.split('\n').includes(`?? ${file}`));
});

Then('the temporary directory is empty', function () {
  assert.deepEqual(readdirSync(fp(this).tmp as string), []);
});

Then('the fingerprint throws {string}', function (message: string) {
  const { error } = fp(this);
  assert.ok(error instanceof Error);
  assert.equal(error.message, message);
});

Then('the fingerprint error does not contain {string}', function (text: string) {
  assert.ok(!String((fp(this).error as Error).message).includes(text));
});

Then('the fingerprint commit is {string}', function (commit: string) {
  assert.equal(fp(this).results[0]?.commit, commit);
});

Then('the fingerprint tree is {string}', function (tree: string) {
  assert.equal(fp(this).results[0]?.tree, tree);
});

// --- a fake git -----------------------------------------------------------------------------------------------

// The fake git is a script of node, found through the PATH it is given. It reads what it must answer from files next to
// itself, not from the environment: the fingerprint gives git a closed environment. It writes, for each call, its
// arguments, its GIT_INDEX_FILE, its directory, the names (not the values) of its whole environment, and the values of
// the two variables that name the global and the system configuration of git.
const FAKE_GIT = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => (fs.existsSync(path.join(__dirname, name)) ? fs.readFileSync(path.join(__dirname, name), 'utf8') : '');
const args = process.argv.slice(2);
// macOS adds __CF_USER_TEXT_ENCODING to every process it starts: it is not a variable the fingerprint gave.
const names = Object.keys(process.env).filter((name) => name !== '__CF_USER_TEXT_ENCODING').sort();
const configuration = [process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM, process.env.GIT_ATTR_NOSYSTEM];
const line = [args.join(' '), process.env.GIT_INDEX_FILE ?? '', fs.realpathSync(process.cwd()), names, configuration];
fs.appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify(line) + '\\n');
// The ten arguments before the subcommand are the options the fingerprint gives every call (git-closed.json).
if (args.slice(10).join(' ') === read('on')) {
  if (read('sleep') !== '') setTimeout(() => {}, Number(read('sleep')) * 1000);
  else {
    process.stdout.write(read('text') + '\\n');
    process.stderr.write(read('text') + '\\n');
    process.exitCode = Number(read('exit'));
  }
} else process.stdout.write('cccccccccccccccccccccccccccccccccccccccc\\n');
`;

/** Sets an environment variable for the rest of the scenario. */
const setEnv = (world: { cleanups: (() => void)[] }, name: string, value: string): void => {
  const before = process.env[name];
  process.env[name] = value;
  world.cleanups.push(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
};

/** What the fake git is told to do on the call `on`: files next to it. */
const tell = (world: { state: Record<string, unknown> }, answers: Record<string, string>): void => {
  for (const [name, text] of Object.entries(answers))
    writeFileSync(join(fp(world).bin as string, name), text);
};

function installFakeGit(world: { state: Record<string, unknown>; cleanups: (() => void)[] }, script: string) {
  const bin = mkdtempSync(join(ROOT_TMP, 'aos-fp-bin-'));
  world.cleanups.push(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'git'), script);
  chmodSync(join(bin, 'git'), 0o755);
  writeFileSync(join(bin, 'calls.log'), '');
  setEnv(world, 'PATH', `${bin}:${process.env['PATH']}`);
  fp(world).bin = bin;
  fp(world).log = join(bin, 'calls.log');
}

Given('a fake git that records its calls', function () {
  installFakeGit(this, FAKE_GIT);
});

Given('a fake git with immediate responses before its deliberately silent call', function () {
  installFakeGit(
    this,
    [
      '#!/bin/sh',
      'set -eu',
      'shift 10',
      'IFS= read -r silent < "${0%/*}/on" || [ -n "$silent" ]',
      'printf "%s\\n" "$*" >> "${0%/*}/calls.log"',
      'if [ "$*" = "$silent" ]; then exec /bin/sleep 60; fi',
      'printf "%s\\n" cccccccccccccccccccccccccccccccccccccccc',
      '',
    ].join('\n'),
  );
});

Then('the timed out fake git call was {string}', function (call: string) {
  const observed = readFileSync(fp(this).log as string, 'utf8')
    .trimEnd()
    .split('\n');
  assert.equal(observed.at(-1), call);
});

Given('the fake git never answers the call {string}', function (call: string) {
  tell(this, { on: call, sleep: '60' });
});

Given('the fake git answers the call {string} with the hash {string}', function (call: string, hash: string) {
  tell(this, { on: call, text: hash, exit: '0' });
});

Given(
  'the fake git answers the call {string} with the exit code {int} and a marker',
  function (call: string, code: number) {
    tell(this, { on: call, text: 'MARKER', exit: String(code) });
  },
);

Given(
  'the fake git answers the call {string} with the text {string} and the exit code {int}',
  function (call: string, text: string, code: number) {
    tell(this, { on: call, text, exit: String(code) });
  },
);

const calls = (world: { state: Record<string, unknown> }) =>
  readFileSync(fp(world).log as string, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as [string, string, string, string[], string[]]);

Then('the fake git was called, in this order, with:', function (table: { raw: () => string[][] }) {
  const expected = table.raw().map(([args, index]) => [args?.trim(), index?.trim()]);
  assert.deepEqual(
    calls(this).map(([args, index]) => [args, index === '' ? 'no index' : 'the index']),
    expected,
  );
});

Then('the fake git ran in the directory', function () {
  const directory = realpathSync(fp(this).directory);
  for (const [, , cwd] of calls(this)) assert.equal(cwd, directory);
});

Then('the temporary index was in the temporary directory', function () {
  const { tmp } = fp(this);
  const indexes = calls(this)
    .map(([, index]) => index)
    .filter((index) => index !== '');
  assert.equal(indexes.length, 4);
  assert.deepEqual(new Set(indexes).size, 1);
  const folder = dirname(indexes[0] as string);
  assert.equal(dirname(folder), tmp);
  assert.match(basename(folder), /^aos-tree-/);
  assert.equal(basename(indexes[0] as string), 'index');
});

const CONFIGURATION = [
  'GIT_ATTR_NOSYSTEM',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_SYSTEM',
  'GIT_NO_REPLACE_OBJECTS',
];

Then(
  'each call of the fake git received exactly the names of the list that the process had, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due',
  function () {
    const list = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'];
    const had = list.filter((name) => process.env[name] !== undefined);
    // The scenario makes the check mean something: some names are set, one is not, and the list is not the whole process.
    assert.ok(had.includes('LANG') && had.includes('LC_CTYPE') && !had.includes('LC_ALL'));
    assert.ok(Object.keys(process.env).length > had.length);
    const recorded = calls(this);
    assert.equal(recorded.length, 6);
    for (const [, index, , names, configuration] of recorded) {
      assert.deepEqual(names, [...had, ...CONFIGURATION, ...(index === '' ? [] : ['GIT_INDEX_FILE'])].sort());
      assert.deepEqual(configuration, ['/dev/null', '/dev/null', '1']);
    }
  },
);

Then(
  'each call of the fake git received exactly the five names of the list, the two configuration variables set to the empty file, system attributes disabled, and GIT_INDEX_FILE where it is due',
  function () {
    const list = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'];
    assert.ok(list.every((name) => process.env[name] !== undefined));
    const recorded = calls(this);
    assert.equal(recorded.length, 6);
    for (const [, index, , names, configuration] of recorded) {
      assert.deepEqual(
        names,
        [...list, ...CONFIGURATION, ...(index === '' ? [] : ['GIT_INDEX_FILE'])].sort(),
      );
      assert.deepEqual(configuration, ['/dev/null', '/dev/null', '1']);
    }
  },
);

// A gitlink with no directory in the checkout: only its recorded mode 160000 shows it, no marker can.
Given(
  'the commit of the repository records a gitlink {string} with no directory in the tree',
  function (name: string) {
    const { directory } = fp(this);
    const head = git(directory, 'rev-parse', 'HEAD').trim();
    git(directory, 'update-index', '--add', '--cacheinfo', `160000,${head},${name}`);
    git(directory, 'commit', '-qm', 'gitlink');
    assert.equal(existsSync(join(directory, name)), false);
  },
);

Given('a linked worktree from the second repository is nested at {string}', function (name: string) {
  const { directory, other } = fp(this);
  const nested = join(directory, name);
  assert.ok(other);
  git(other, 'worktree', 'add', '--detach', nested, 'HEAD');
  assert.ok(
    readFileSync(join(nested, '.git'), 'utf8').startsWith(`gitdir: ${realpathSync(other)}/.git/worktrees/`),
  );
});

// --- the guard of the checkout (git-worktree.ts) ------------------------------------------------------------------

Given('a directory that does not exist', function () {
  const directory = throwaway(this);
  rmSync(directory, { recursive: true });
});

Given('a throwaway repository with a directory it cannot list', function () {
  const directory = throwaway(this);
  commitOne(directory, 'a.txt');
  const closed = join(directory, 'closed');
  mkdirSync(closed, { mode: 0o000 });
  // Cleanups run in reverse order: the directory is opened again before the repository is removed.
  this.cleanups.push(() => chmodSync(closed, 0o700));
});

Given('the ignore file of the repository is a symbolic link to {string}', function (target: string) {
  symlinkSync(target, join(fp(this).directory, '.gitignore'));
});

Given(
  'the ignore file of the repository ends with the comment {string} after one MiB of comments',
  function (tail: string) {
    const commentLine = '#'.repeat(1023) + '\n';
    writeFileSync(join(fp(this).directory, '.gitignore'), commentLine.repeat(1024) + '#' + tail);
  },
);

Then('the guard of the checkout finds it clean', function () {
  assert.equal(checkoutIsClean(fp(this).directory), true);
});

Then('the guard of the checkout finds it not clean', function () {
  assert.equal(checkoutIsClean(fp(this).directory), false);
});

Then(
  'the guard of the checkout refuses to say whether it is clean with {string}',
  function (message: string) {
    assert.throws(() => checkoutIsClean(fp(this).directory), { message });
  },
);

Then('the guard of the checkout refuses to name its markers with {string}', function (message: string) {
  assert.throws(() => visibleNestedMarker(fp(this).directory, ''), { message });
});

Then('the guard of the checkout names no marker', function () {
  assert.equal(visibleNestedMarker(fp(this).directory, ''), undefined);
});

// Observe the guard's decision at the point where it hands the sets to the directory walk.
// The real Git entries and the ordinary file suffice; there is no nested repository in the fixture.
Then(
  'the guard classifies the ignore file as {string} from both the head and the index',
  function (classification: string) {
    const { directory } = fp(this);
    const script = [
      'import os, runpy, sys',
      'from unittest.mock import Mock',
      'inspect = runpy.run_path(sys.argv[1])["visible_marker"]',
      'walk = Mock()',
      'inspect.__globals__["nested_marker"] = walk',
      'fd = os.open(".", os.O_RDONLY | os.O_DIRECTORY)',
      'try:',
      '    inspect(fd, sys.stdin.buffer.read())',
      'finally:',
      '    os.close(fd)',
      '_, trusted, changed, _ = walk.call_args.args',
      'sources = (("trusted", trusted), ("changed", changed))',
      'print(" ".join(label for label, paths in sources if b".gitignore" in paths))',
    ].join('\n');
    const guard = join(ROOT, 'tools/test-gate/with-tree-lock.py');
    const head = git(directory, 'ls-tree', '-r', '-z', 'HEAD');
    const index = git(directory, 'ls-files', '-s', '-z');
    for (const entries of [head, index]) {
      const result = spawnSync('/usr/bin/python3', ['-I', '-c', script, guard], {
        cwd: directory,
        env: {},
        input: entries,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), classification);
    }
  },
);

Then('the guard refuses the recorded markers of its head with {string}', function (message: string) {
  const { directory } = fp(this);
  const tree = git(directory, 'ls-tree', '-r', '-z', 'HEAD');
  assert.throws(() => visibleNestedMarker(directory, tree), { message });
});

Then('the guard of the checkout names no marker of its index', function () {
  const { directory } = fp(this);
  assert.equal(visibleNestedMarker(directory, git(directory, 'ls-files', '-s', '-z')), undefined);
});

Then('the guard of the checkout names no marker of its head', function () {
  const { directory } = fp(this);
  assert.equal(visibleNestedMarker(directory, git(directory, 'ls-tree', '-r', '-z', 'HEAD')), undefined);
});

Then('the guard of the checkout names the marker {string} of its head', function (path: string) {
  const { directory } = fp(this);
  assert.deepEqual(visibleNestedMarker(directory, git(directory, 'ls-tree', '-r', '-z', 'HEAD')), { path });
});

Then(
  'the guard of the checkout names the marker {string} under the changed ignore file {string}',
  function (path: string, changedIgnoreFile: string) {
    const { directory } = fp(this);
    assert.deepEqual(visibleNestedMarker(directory, git(directory, 'ls-tree', '-r', '-z', 'HEAD')), {
      path,
      changedIgnoreFile,
    });
  },
);

Given('the file {string} of the repository is removed', function (file: string) {
  rmSync(join(fp(this).directory, file));
});

Then('a git with none of the options of the guard lists no file in the head of the repository', function () {
  assert.equal(git(fp(this).directory, 'ls-tree', '-r', 'HEAD'), '');
});

// The file monitor of the configuration: a program git starts when it lists the untracked files (core.fsmonitor).
Given('the configuration of the repository names a witness program as its file monitor', function () {
  const witness = join(mkdtempSync(join(ROOT_TMP, 'aos-fp-witness-')), 'witness');
  this.cleanups.push(() => rmSync(dirname(witness), { recursive: true, force: true }));
  writeFileSync(witness, `#!/bin/sh\n: > '${witness}.ran'\nexit 1\n`);
  chmodSync(witness, 0o755);
  const configuration = join(fp(this).directory, '.git', 'config');
  writeFileSync(configuration, `${readFileSync(configuration, 'utf8')}[core]\n\tfsmonitor = ${witness}\n`);
  this.state['fingerprintWitness'] = witness;
});

When('a git with none of the options of the guard lists the untracked files of the repository', function () {
  git(fp(this).directory, 'ls-files', '--others', '--exclude-standard');
});

Then('the witness program of the configuration of the repository has run', function () {
  assert.equal(witnessRan(this), true);
});
