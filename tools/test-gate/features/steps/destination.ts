import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataTable } from '@cucumber/cucumber';
import { parse } from 'yaml';
import { judgedParent } from '../../src/domain/destination.js';
import { git, gitWithOptions, GitRepository } from '../../src/infrastructure/git.js';
import { fixtureSource, replaceLine } from './reports.js';
import { Given, Then, When, repository } from './repository.js';

// The destination the gate judges against (destination.feature). The fixture repository is a scenario's own: its
// branches, merges and references are made here, never in a worktree of the repository.

const DESTINATION = 'refs/remotes/origin/main';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const IDENTITY = [
  '-c',
  'user.name=gate',
  '-c',
  'user.email=gate@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

Given(
  'the gate destination gains a commit where {string} is the mutation fixture {string} with line {int} changed',
  function (path: string, fixture: string, line: number) {
    const repo = repository(this);
    // On a branch of the fixture at the destination, then back: the head and its working tree are as they were.
    git(repo.dir, ['checkout', '-q', '-B', 'gate-destination', DESTINATION]);
    repo.write(path, replaceLine(fixtureSource(fixture, path), line, '// changed on the destination'));
    git(repo.dir, ['add', '-A']);
    git(repo.dir, [...IDENTITY, 'commit', '-q', '-m', 'destination']);
    git(repo.dir, ['update-ref', DESTINATION, 'HEAD']);
    git(repo.dir, ['checkout', '-q', '-']);
  },
);

Given('the gate head merges its destination', function () {
  git(repository(this).dir, [
    ...IDENTITY,
    'merge',
    '-q',
    '--no-edit',
    '-m',
    'merge the destination',
    DESTINATION,
  ]);
});

Given('the gate destination is moved to the first parent of the head', function () {
  git(repository(this).dir, ['update-ref', DESTINATION, 'HEAD^1']);
});

Given('the gate destination is deleted', function () {
  git(repository(this).dir, ['update-ref', '-d', DESTINATION]);
});

Given('the gate destination is moved to a commit made with the tree of the head', function () {
  const repo = repository(this);
  // The diff of the working tree against it would be empty: every production line of the branch would escape.
  const forged = git(repo.dir, [
    ...IDENTITY,
    'commit-tree',
    'HEAD^{tree}',
    '-p',
    DESTINATION,
    '-m',
    'forged',
  ]).trim();
  git(repo.dir, ['update-ref', DESTINATION, forged]);
});

Then('the gate decides, for these facts, {string}', function (expected: string, table: DataTable) {
  const [row] = table.hashes() as [Record<string, string>];
  const asked: string[] = [];
  const decision = judgedParent({
    head: row['head']!,
    parent: row['parent'] === '' ? null : row['parent']!,
    destination: row['destination'] === '' ? undefined : row['destination'],
    behind: Number(row['behind']),
    ahead: Number(row['ahead']),
    headTree: row['tree']!,
    merged: () => (asked.push('merged'), row['merged'] as string),
  });
  const shown =
    'refusal' in decision
      ? decision.refusal
      : `${decision.firstParent ?? 'none'} D=${decision.destination ?? 'none'} ${decision.commits}`;
  assert.equal(shown, expected);
  // The merge is built only when the destination is neither the head nor its first parent.
  const shortcut =
    row['destination'] === '' || row['destination'] === row['head'] || row['destination'] === row['parent'];
  assert.deepEqual(asked, shortcut ? [] : ['merged']);
});

interface Forge {
  root: string;
  origin: string;
  main: [string, string];
  merge: string;
  checkout?: string;
}

const forgeOf = (world: object): Forge =>
  (world as { state: Record<string, unknown> }).state['forge'] as Forge;

Given(
  "a forge repository whose main has two commits and a pull request of one commit, with GitHub's merge commit",
  function () {
    const root = mkdtempSync(join(tmpdir(), 'aos-gate-forge-'));
    this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const work = join(root, 'work');
    const origin = join(root, 'origin.git');
    git(root, ['init', '-q', '--bare', origin]);
    git(root, ['init', '-q', work]);
    const commit = (file: string, message: string): string => {
      writeFileSync(join(work, file), message + '\n');
      git(work, ['add', '-A']);
      git(work, [...IDENTITY, 'commit', '-q', '-m', message]);
      return git(work, ['rev-parse', 'HEAD']).trim();
    };
    const first = commit('a.txt', 'main 1');
    git(work, ['checkout', '-q', '-b', 'topic']);
    const topic = commit('b.txt', 'topic');
    git(work, ['checkout', '-q', '-B', 'main', first]);
    const second = commit('c.txt', 'main 2');
    // What GitHub builds for a pull request: first parent the base, second the head of the pull request.
    git(work, [...IDENTITY, 'merge', '-q', '--no-ff', '--no-edit', '-m', 'merge', topic]);
    const merge = git(work, ['rev-parse', 'HEAD']).trim();
    git(work, ['push', '-q', origin, `${second}:refs/heads/main`, `${merge}:refs/pull/1/merge`]);
    this.state['forge'] = { root, origin, main: [first, second], merge } satisfies Forge;
  },
);

Given('a checkout of depth 2 of {}, as actions\\/checkout leaves it', function (which: string) {
  const forge = forgeOf(this);
  const target = which === 'the merge commit' ? 'refs/pull/1/merge' : 'refs/heads/main';
  const checkout = join(forge.root, 'checkout');
  git(forge.root, ['init', '-q', checkout]);
  git(checkout, ['remote', 'add', 'origin', `file://${forge.origin}`]);
  git(checkout, ['fetch', '-q', '--no-tags', '--depth=2', 'origin', target]);
  git(checkout, ['checkout', '-q', '--detach', 'FETCH_HEAD']);
  assert.equal(git(checkout, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
  forge.checkout = checkout;
});

function runFetchStep(world: object, depth?: number): void {
  const forge = forgeOf(world);
  const doc = parse(readFileSync(join(ROOT, '.github/workflows/gate.yml'), 'utf8')) as {
    jobs: Record<string, { steps?: { name?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  const step = doc.jobs['gate-linux']?.steps?.find(
    (candidate) => candidate.name === 'Fetch the destination the gate judges against',
  );
  assert.ok(step?.run !== undefined && step.env !== undefined);
  // The command of the workflow as it is written, its env as the workflow gives it.
  const run = depth === undefined ? step.run : step.run.replace('--depth=2', `--depth=${depth}`);
  assert.ok(depth === undefined || run !== step.run);
  // The line as the shell of the runner reads it: words split on blanks outside double quotes, `$NAME` expanded from
  // the env of the step. Nothing else is shell syntax in it (the workflow contract of workflows.feature pins it).
  const words = [...run.matchAll(/"([^"]*)"|(\S+)/g)].map(([, quoted, bare]) =>
    (quoted ?? bare ?? '').replace(/\$([A-Z_]+)/g, (_all, name: string) => step.env?.[name] ?? ''),
  );
  assert.equal(words[0], 'git');
  gitWithOptions(forge.checkout as string, [], words.slice(1));
}

When('the fetch step of gate.yml runs in that checkout', function () {
  runFetchStep(this);
});

When('the fetch step of gate.yml runs in that checkout at depth {int}', function (depth: number) {
  runFetchStep(this, depth);
});

Then('the gate of that checkout sees the head as a root commit', function () {
  assert.equal(new GitRepository(forgeOf(this).checkout as string).commits().firstParent, null);
});

Then(
  'the gate of that checkout takes {} as its first parent, the destination at {}, {int} commit judged',
  function (judged: string, destination: string, commits: number) {
    const forge = forgeOf(this);
    const repository = new GitRepository(forge.checkout as string);
    const result = repository.judged('refs/remotes/origin/main');
    const parent = judged === 'the second commit of main' ? forge.main[1] : forge.main[0];
    assert.equal(result.firstParent, parent);
    const head = git(forge.checkout as string, ['rev-parse', 'HEAD']).trim();
    const expected = destination === 'the head' ? head : parent;
    assert.deepEqual(result.destination, {
      reference: 'refs/remotes/origin/main',
      commit: expected,
      commits,
    });
  },
);
