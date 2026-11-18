import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fingerprintTree, type TreeFingerprint } from '../../src/tree-fingerprint.js';
import { Given, Then, When } from './helpers.js';

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
}
/** The state of the scenario, made by the first step that needs it: the Given steps come in any order. */
const fp = (world: { state: Record<string, unknown> }): Fingerprinting =>
  (world.state['fingerprinting'] ??= { directory: '', results: [] }) as Fingerprinting;

/** A git for the scenarios: no configuration of the machine, no signature, no editor. */
export const git = (directory: string, ...args: string[]): string => {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: directory, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } },
  );
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const throwaway = (world: { state: Record<string, unknown>; cleanups: (() => void)[] }): string => {
  const directory = mkdtempSync(join(ROOT_TMP, 'aos-fp-'));
  world.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  fp(world).directory = directory;
  return directory;
};

Given('a throwaway repository with one commit', function () {
  const directory = throwaway(this);
  git(directory, 'init', '-q');
  writeFileSync(join(directory, '.gitignore'), '*.log\n');
  writeFileSync(join(directory, 'a.txt'), 'first\n');
  git(directory, 'add', '-A');
  git(directory, 'commit', '-q', '-m', 'first');
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
  writeFileSync(path, text.replaceAll('\\n', '\n'));
});

Given('the exclusion file of the host names {string}', function (pattern: string) {
  // The global configuration of git, for this scenario: an exclusion file that names the pattern.
  const home = mkdtempSync(join(ROOT_TMP, 'aos-fp-home-'));
  this.cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, 'ignore'), `${pattern}\n`);
  writeFileSync(join(home, 'gitconfig'), `[core]\n\texcludesFile = ${join(home, 'ignore')}\n`);
  setEnv(this, 'GIT_CONFIG_GLOBAL', join(home, 'gitconfig'));
});

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

const FAKE_GIT = `#!/bin/sh
printf '%s|%s|%s\\n' "$*" "$GIT_INDEX_FILE" "$(pwd -P)" >> "$FAKE_GIT_LOG"
shift 6
if [ "$*" = "$FAKE_GIT_ON" ]; then
  if [ -n "$FAKE_GIT_SLEEP" ]; then exec sleep "$FAKE_GIT_SLEEP"; fi
  printf '%s\\n' "$FAKE_GIT_TEXT"
  printf '%s\\n' "$FAKE_GIT_TEXT" >&2
  exit "$FAKE_GIT_EXIT"
fi
printf '%s\\n' cccccccccccccccccccccccccccccccccccccccc
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

Given('a fake git that records its calls', function () {
  const bin = mkdtempSync(join(ROOT_TMP, 'aos-fp-bin-'));
  this.cleanups.push(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'git'), FAKE_GIT);
  chmodSync(join(bin, 'git'), 0o755);
  const log = join(bin, 'calls.log');
  writeFileSync(log, '');
  setEnv(this, 'PATH', `${bin}:${process.env['PATH']}`);
  setEnv(this, 'FAKE_GIT_LOG', log);
  setEnv(this, 'FAKE_GIT_ON', '');
  setEnv(this, 'FAKE_GIT_SLEEP', '');
  fp(this).log = log;
});

Given('the fake git never answers the call {string}', function (call: string) {
  setEnv(this, 'FAKE_GIT_ON', call);
  setEnv(this, 'FAKE_GIT_SLEEP', '30');
});

Given('the fake git answers the call {string} with the hash {string}', function (call: string, hash: string) {
  setEnv(this, 'FAKE_GIT_ON', call);
  setEnv(this, 'FAKE_GIT_TEXT', hash);
  setEnv(this, 'FAKE_GIT_EXIT', '0');
});

Given(
  'the fake git answers the call {string} with the exit code {int} and a marker',
  function (call: string, code: number) {
    setEnv(this, 'FAKE_GIT_ON', call);
    setEnv(this, 'FAKE_GIT_TEXT', 'MARKER');
    setEnv(this, 'FAKE_GIT_EXIT', String(code));
  },
);

Given(
  'the fake git answers the call {string} with the text {string} and the exit code {int}',
  function (call: string, text: string, code: number) {
    setEnv(this, 'FAKE_GIT_ON', call);
    setEnv(this, 'FAKE_GIT_TEXT', text);
    setEnv(this, 'FAKE_GIT_EXIT', String(code));
  },
);

const calls = (world: { state: Record<string, unknown> }) =>
  readFileSync(fp(world).log as string, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('|') as [string, string, string]);

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
  assert.equal(indexes.length, 3);
  assert.deepEqual(new Set(indexes).size, 1);
  const folder = dirname(indexes[0] as string);
  assert.equal(dirname(folder), tmp);
  assert.match(basename(folder), /^aos-tree-/);
  assert.equal(basename(indexes[0] as string), 'index');
});
