import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { InMemoryPassRepository } from '../../src/in-memory-pass-repository.js';
import type { PassRepository } from '../../src/pass-commit.js';
import { gitPassRepository } from '../../src/pass-repository.js';
import { fingerprintTree, type TreeFingerprint } from '../../src/tree-fingerprint.js';
import { gitInFixture } from '../git-fixture.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';

/**
 * What a scenario of the contract does to the repository besides the port: write and remove files of the working tree,
 * detach the head, take the snapshot (the fingerprint), and read back a commit and the index.
 */
interface Driver {
  readonly repository: PassRepository;
  write(path: string, text: string): void;
  remove(path: string): void;
  detach(): void;
  snapshot(): TreeFingerprint;
  /** The parents, tree, message and committer date of a commit. */
  describe(commit: string): { parents: string[]; tree: string; message: string; seconds: number };
  /** The tree of the index of the worktree. */
  indexTree(): string;
}

interface Contract {
  driver: Driver;
  first: string;
  snapshot?: TreeFingerprint;
  written?: string;
  advanced?: boolean;
}

const contract = (world: SandboxWorld) => stored<Contract>(world, 'passContract');

/** Git of the scenario itself, to set the repository up and read it back: never the adapter under test. */
export const fixtureGit = (directory: string, ...args: string[]): string =>
  gitInFixture(directory, [
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    ...args,
  ]).trim();

/** A throwaway repository on `branch` whose first commit holds `files`, each with the text `first`. */
export function throwawayRepository(world: SandboxWorld, branch: string, files: readonly string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'aos-pass-'));
  world.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  fixtureGit(directory, 'init', '-q');
  fixtureGit(directory, 'checkout', '-q', '-b', branch);
  for (const file of files) writeFileSync(join(directory, file), 'first\n');
  fixtureGit(directory, 'add', '-A');
  fixtureGit(directory, 'commit', '-q', '-m', 'first');
  return directory;
}

function gitDriver(directory: string): Driver {
  return {
    repository: gitPassRepository(() => directory),
    write(path, text) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), text);
    },
    remove: (path) => rmSync(join(directory, path)),
    detach: () => void fixtureGit(directory, 'checkout', '-q', '--detach'),
    snapshot: () => fingerprintTree(directory),
    describe(commit) {
      // Not trimmed: a root commit prints an empty first line, its parents.
      const [parents, tree, seconds] = gitInFixture(directory, [
        'log',
        '-1',
        '--format=%P%n%T%n%ct',
        commit,
      ]).split('\n');
      const message = gitInFixture(directory, ['log', '-1', '--format=%B', commit]);
      // `%B` ends the message with the line feed of the commit and one of `log`.
      return {
        parents: (parents as string).split(' ').filter((p) => p !== ''),
        tree: tree as string,
        message: message.slice(0, -1),
        seconds: Number(seconds),
      };
    },
    indexTree: () => fixtureGit(directory, 'write-tree'),
  };
}

function inMemoryDriver(files: readonly string[]): Driver {
  const repository = new InMemoryPassRepository({
    branch: 'step/demo',
    files: Object.fromEntries(files.map((file) => [file, 'first\n'])),
  });
  return {
    repository,
    write: (path, text) => void repository.files.set(path, text),
    remove: (path) => void repository.files.delete(path),
    detach: () => repository.detach(),
    snapshot: () => repository.snapshot(),
    describe(commit) {
      const known = repository.commits.get(commit);
      assert.ok(known, `no commit ${commit}`);
      return {
        parents: known.parent === undefined ? [] : [known.parent],
        tree: known.tree,
        message: known.message,
        seconds: known.seconds,
      };
    },
    indexTree: () => repository.index,
  };
}

Given(
  'a pass repository {string} on the branch {string} whose first commit holds {string} and {string}',
  function (adapter: string, branch: string, one: string, two: string) {
    assert.ok(adapter === 'in memory' || adapter === 'git', `no adapter ${adapter}`);
    assert.equal(branch, 'step/demo', 'the in-memory driver starts on step/demo');
    const driver =
      adapter === 'git'
        ? gitDriver(throwawayRepository(this, branch, [one, two]))
        : inMemoryDriver([one, two]);
    this.state['passContract'] = { driver, first: driver.repository.head().commit } satisfies Contract;
  },
);

Given('the head of the pass repository is detached', function () {
  contract(this).driver.detach();
});

Given('the file {string} of the pass repository holds {string}', function (path: string, text: string) {
  contract(this).driver.write(path, text.replaceAll('\\n', '\n'));
});

Given('the file {string} of the pass repository is removed', function (path: string) {
  contract(this).driver.remove(path);
});

When('I take the snapshot of the pass repository', function () {
  const c = contract(this);
  c.snapshot = c.driver.snapshot();
  assert.match(c.snapshot.tree, /^[0-9a-f]{40}$/);
});

Then('the first commit has no parent and the message {string}', function (message: string) {
  const c = contract(this);
  const described = c.driver.describe(c.first);
  assert.deepEqual([described.parents, described.message], [[], message.replaceAll('\\n', '\n')]);
});

When(
  'I write the commit of the snapshot on the first commit with the subject {string}, the body {string} and the date {int}',
  function (subject: string, body: string, seconds: number) {
    const c = contract(this);
    c.written = c.driver.repository.writeCommit({
      tree: (c.snapshot as TreeFingerprint).tree,
      parent: c.first,
      subject,
      body,
      seconds,
    });
  },
);

const named = (c: Contract, which: string): string => {
  assert.ok(which === 'first' || which === 'written', `no commit ${which}`);
  return which === 'first' ? c.first : (c.written as string);
};

When(
  'I advance the branch {string} from the {word} commit to the written commit',
  function (branch: string, from: string) {
    const c = contract(this);
    c.advanced = c.driver.repository.advance(branch, named(c, from), c.written as string);
  },
);

When('I settle the index of the pass repository on the written commit', function () {
  const c = contract(this);
  c.driver.repository.settleIndex(c.written as string);
});

Then('the branch was advanced', function () {
  assert.equal(contract(this).advanced, true);
});

Then('the branch was not advanced', function () {
  assert.equal(contract(this).advanced, false);
});

Then(
  'the head of the pass repository is the branch {string} at the {word} commit',
  function (branch: string, which: string) {
    const c = contract(this);
    assert.deepEqual(c.driver.repository.head(), { branch, commit: named(c, which) });
  },
);

Then('the head of the pass repository names no branch, at the first commit', function () {
  const c = contract(this);
  assert.deepEqual(c.driver.repository.head(), { branch: undefined, commit: c.first });
});

Then('the snapshot of the pass repository is clean', function () {
  assert.equal(contract(this).snapshot?.clean, true);
});

Then('the snapshot of the pass repository is not clean', function () {
  assert.equal(contract(this).snapshot?.clean, false);
});

Then(
  'the paths changed from the {word} commit to the snapshot are {string}, in the order of their bytes',
  function (which: string, paths: string) {
    const c = contract(this);
    const changed = c.driver.repository.changedPaths(named(c, which), (c.snapshot as TreeFingerprint).tree);
    assert.deepEqual(changed, paths.split(' '));
  },
);

Then(
  'the paths changed from the {word} commit to the snapshot are {string}',
  function (which: string, paths: string) {
    const c = contract(this);
    const changed = c.driver.repository.changedPaths(named(c, which), (c.snapshot as TreeFingerprint).tree);
    assert.deepEqual(changed, paths === '' ? [] : paths.split(' '));
  },
);

Then('the written commit has the first commit for its only parent and the tree of the snapshot', function () {
  const c = contract(this);
  const described = c.driver.describe(c.written as string);
  assert.deepEqual(described.parents, [c.first]);
  assert.equal(described.tree, c.snapshot?.tree);
});

Then(
  'the written commit has the message {string} and the date {int}',
  function (message: string, seconds: number) {
    const c = contract(this);
    const described = c.driver.describe(c.written as string);
    assert.equal(described.message, message.replaceAll('\\n', '\n'));
    assert.equal(described.seconds, seconds);
  },
);

Then('the index of the pass repository is the tree of the written commit', function () {
  const c = contract(this);
  assert.equal(c.driver.indexTree(), c.driver.describe(c.written as string).tree);
});
