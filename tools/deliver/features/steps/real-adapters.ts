import assert from 'node:assert/strict';
import { hasAdmittedRun } from '@architect-os/sandbox/runtime-context';
import { ProcessGate } from '../../src/infrastructure/process-gate.js';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryEntry, Repository, RuleSuite } from '../../src/domain/ports.js';
import { GitRepository } from '../../src/infrastructure/git-repository.js';
import { hostOf, temporaryDirectory } from './fixtures.js';
import type { GitFixture } from './git-fixture.js';
import {
  modeOf,
  type FileLogFixture,
  type ProcessGateFixture,
  type TimerClockFixture,
} from './process-fixtures.js';
import { Given, Then, When, type DeliverWorld } from './support.js';

// The scenarios of one real adapter alone (ports.feature): what its contract rows cannot say.

const gitOf = (world: DeliverWorld): GitFixture => world.state['portRepository'] as GitFixture;
const gateOf = (world: DeliverWorld): ProcessGateFixture => world.state['portGate'] as ProcessGateFixture;
const logOf = (world: DeliverWorld): FileLogFixture => world.state['portLog'] as FileLogFixture;

Then('a real Gate subprocess has exactly its admitted paths, PATH and PG_BIN', async function () {
  const { runtime, worktree, log, logPath } = gateOf(this);
  const original = {
    ...runtime.env,
    PATH: '/usr/bin:/bin',
    PG_BIN: '/operator/postgresql',
    HOME: '/operator/home',
    GH_TOKEN: 'test',
    GITHUB_TOKEN: 'test',
    SSH_AUTH_SOCK: 'agent',
    ANTHROPIC_API_KEY: 'test',
    NODE_OPTIONS: 'no-node-injection',
    ARCHITECT_OS_HOST_XDG_CONFIG_HOME: 'set:/operator/identity',
  };
  const gate = new ProcessGate(worktree, ['/usr/bin/env'], 'reports/deliver-gate.log', original);
  assert.equal(await gate.run(), 0);
  const child = Object.fromEntries(
    log()
      .trimEnd()
      .split('\n')
      .map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
  assert.deepEqual(child, { ...runtime.env, PATH: original.PATH, PG_BIN: original.PG_BIN });
  assert.equal(hasAdmittedRun(child), true);
  assert.equal(modeOf(logPath), '600');
  assert.equal(modeOf(join(runtime.run, 'reports')), '700');
});
Then('a legacy checkout verdict cannot satisfy the delivery Gate', function () {
  const { gate, worktree, runtime } = gateOf(this);
  for (const parent of [worktree, runtime.run]) {
    mkdirSync(join(parent, 'reports'), { mode: 0o700 });
    writeFileSync(join(parent, 'reports/gate-base.json'), JSON.stringify({ sha: '1'.repeat(40) }));
  }
  assert.equal(gate.verdictHash(), undefined);
});

// Repository over git

Given(
  'the delivery repository holds the commit {string} after {string} with the file {string} of {int} lines',
  function (label: string, parent: string, path: string, count: number) {
    gitOf(this).commitWith(label, parent, { lines: { path, count } });
  },
);

Given(
  'the delivery repository holds the commit {string} after {string} with the binary file {string}',
  function (label: string, parent: string, path: string) {
    gitOf(this).commitWith(label, parent, { binary: path });
  },
);

Given('the delivery remote cannot be reached', function () {
  const { git, work, root } = gitOf(this);
  git(work, 'remote', 'set-url', 'origin', join(root, 'missing.git'));
});

When('another clone deletes the delivery remote branch {string}', function (branch: string) {
  gitOf(this).deleteFromAnotherClone(branch);
});

When('an untracked file is added to the delivery worktree', function () {
  writeFileSync(join(gitOf(this).work, 'untracked.txt'), 'untracked\n');
});

Then(
  'the remote repository holds the branch {string} at the commit {string}',
  function (branch: string, label: string) {
    const { git, bare, hashOf } = gitOf(this);
    assert.equal(git(bare, 'rev-parse', '--verify', `refs/heads/${branch}`).trim(), hashOf(label));
  },
);

Given(
  'the delivery repository replaces the blob of {string} at {string} by its blob at {string}',
  function (path: string, from: string, to: string) {
    const { git, work, hashOf } = gitOf(this);
    const blob = (label: string) => git(work, 'rev-parse', `${hashOf(label)}:${path}`).trim();
    git(work, 'replace', blob(from), blob(to));
  },
);

Given('the git configuration of the host marks {string} as binary', function (pattern: string) {
  const directory = join(gitOf(this).hostConfiguration, 'git');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'attributes'), `${pattern} binary\n`);
});

Given('everything in the delivery worktree is committed', function () {
  gitOf(this).commitEverything();
});

When(
  'the fixture git, without the options of the delivery, is asked for the {word} of the delivery worktree',
  function (command: string) {
    const { git, work } = gitOf(this);
    if (command === 'status') git(work, 'status', '--porcelain');
    else git(work, 'fetch', '--quiet', '--prune', 'origin');
  },
);

Then('the witness program of the nested delivery repository has not run', function () {
  assert.equal(gitOf(this).witnessRan(), false);
});

Then('the witness program of the nested delivery repository has run', function () {
  assert.equal(gitOf(this).witnessRan(), true);
});

/** The methods a scenario calls by name, with arguments that are the scenario's own. */
const calls: Record<string, (repository: Repository) => unknown> = {
  holdsNestedRepository: (repository) => repository.holdsNestedRepository(),
  isClean: (repository) => repository.isClean(),
  head: (repository) => repository.head(),
  fetch: (repository) => repository.fetch(),
  remoteHead: (repository) => repository.remoteHead('main'),
  isAncestor: (repository) => repository.isAncestor('aaa', 'bbb'),
  deletedLines: (repository) => repository.deletedLines('aaa', 'bbb', 'docs/a.md'),
  push: (repository) => repository.push('aaa', 'main'),
  deleteRemoteBranch: (repository) => repository.deleteRemoteBranch('main'),
};

const callOf = (name: string): ((repository: Repository) => unknown) => {
  const call = calls[name];
  assert.ok(call !== undefined, `no call named ${name}`);
  return call;
};

const repositoryOf = (world: DeliverWorld): Repository =>
  (world.state['portRepository'] as { repository: Repository }).repository;

Given('a delivery repository over a directory that is not a repository', function () {
  this.state['portRepository'] = {
    repository: new GitRepository(temporaryDirectory(this), 'origin', 'git', hostOf(this)),
  };
});

Given('a delivery repository over the git executable {string}', function (git: string) {
  this.state['portRepository'] = {
    repository: new GitRepository(temporaryDirectory(this), 'origin', git, hostOf(this)),
  };
});

/** A `git` that writes its arguments, one per line, and the prompt variable it was started with, next to itself. */
Given('a delivery repository over a git that records what it is asked', function () {
  const directory = temporaryDirectory(this);
  const script = join(directory, 'git');
  writeFileSync(
    script,
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$0.argv"\nprintf \'%s\' "$GIT_TERMINAL_PROMPT" > "$0.prompt"\n',
  );
  chmodSync(script, 0o755);
  this.state['portRepository'] = {
    repository: new GitRepository(directory, 'origin', script, hostOf(this)),
    script,
  };
});

When('I call {string} on the delivery repository', function (name: string) {
  callOf(name)(repositoryOf(this));
});

Then('calling {string} on the delivery repository throws {string}', function (name: string, message: string) {
  assert.throws(() => callOf(name)(repositoryOf(this)), { message });
});

Then(
  'deleting the delivery remote branch {string} throws {string}',
  function (branch: string, message: string) {
    assert.throws(() => repositoryOf(this).deleteRemoteBranch(branch), { message });
  },
);

const scriptOf = (world: DeliverWorld): string =>
  (world.state['portRepository'] as { script: string }).script;

Then('git was asked {string}', function (argv: string) {
  assert.equal(
    readFileSync(`${scriptOf(this)}.argv`, 'utf8')
      .trimEnd()
      .split('\n')
      .join(' '),
    argv,
  );
});

Then('git saw the terminal prompt variable {string}', function (value: string) {
  assert.equal(readFileSync(`${scriptOf(this)}.prompt`, 'utf8'), value);
});

// Gate over a process

Given(
  'the delivery gate leaves the verdict file {string} and exits {int}',
  function (text: string, code: number) {
    gateOf(this).leaves(text, code, 'quiet');
  },
);

Given('the noisy delivery gate leaves no verdict and exits {int}', function (code: number) {
  gateOf(this).leaves(undefined, code, 'noisy');
});

Given('the delivery gate ends on a signal', function () {
  gateOf(this).leaves(undefined, 0, 'signal');
});

Given('the delivery gate command is {string}', function (program: string) {
  gateOf(this).commandIs([program]);
});

Given('the delivery gate log already holds {string}', function (text: string) {
  const { logPath } = gateOf(this);
  mkdirSync(join(logPath, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(logPath, text);
});

Then('the delivery gate log holds {string} and {string}', function (first: string, second: string) {
  const log = gateOf(this).log();
  assert.ok(log.includes(first), log);
  assert.ok(log.includes(second), log);
});

Then('the delivery gate log is empty', function () {
  assert.equal(gateOf(this).log(), '');
});

// Clock over a timer

Then('the timer delivery clock asked for {string} milliseconds', function (milliseconds: string) {
  const { asked } = this.state['portClock'] as TimerClockFixture;
  assert.equal(asked.join(', '), milliseconds);
});

// DeliveryLog in a file

Given('the process umask is 0 until the scenario ends', function () {
  const previous = process.umask(0);
  this.cleanups.push(() => void process.umask(previous));
});

Given('the delivery log file already holds the line {string}', function (line: string) {
  logOf(this).prepare(`${line}\n`);
});

When('I append to the delivery log an entry with the rule suites {string}', function (suites: string) {
  const entry: DeliveryEntry = {
    outcome: 'ready',
    hash: '0'.repeat(40),
    trial: 'sentinel/gate-1a-x',
    parent: '1'.repeat(40),
    ci: { attempts: 1, polls: 1 },
    gate: undefined,
    published: [],
    ruleSuites: new Map(
      suites === 'none'
        ? []
        : suites.split(',').map((pair) => {
            const [branch, suite] = pair.split('=');
            return [branch as string, suite as RuleSuite] as const;
          }),
    ),
  };
  logOf(this).log.append(entry);
});

Then('the delivery log file holds {int} lines, each ended by a line break', function (count: number) {
  const text = logOf(this).text();
  assert.ok(text.endsWith('\n'));
  assert.equal(text.split('\n').length, count + 1);
});

Then('the delivery log directory has the mode {string}', function (mode: string) {
  assert.equal(modeOf(logOf(this).directory), mode);
});

Then('the delivery log file has the mode {string}', function (mode: string) {
  assert.equal(modeOf(logOf(this).path), mode);
});

Then('the delivery log file holds the text {string}', function (text: string) {
  assert.ok(logOf(this).text().includes(text), logOf(this).text());
});

Then('the delivery log file holds the line {string} and then what was appended', function (line: string) {
  const lines = logOf(this).text().split('\n');
  assert.equal(lines[0], line);
  assert.equal(lines.length, 3);
  assert.deepEqual([logOf(this).parse(lines[1] as string)], this.state['portAppended']);
});

Given('the delivery checkout was converted by Git and has been left untouched', function () {
  const fixture = gitOf(this);
  const { git, work, root } = fixture;
  writeFileSync(join(work, '.gitattributes'), 'new.txt text eol=crlf\n');
  writeFileSync(join(work, 'new.txt'), 'first\n');
  git(work, 'add', '.gitattributes', 'new.txt');
  git(work, 'commit', '-qm', 'line endings');
  const converted = join(root, 'converted');
  git(work, 'worktree', 'add', '--detach', converted, 'HEAD');
  assert.equal(readFileSync(join(converted, 'new.txt'), 'utf8'), 'first\r\n');
  assert.equal(git(converted, 'status', '--porcelain'), '');
  assert.equal(git(converted, 'show', 'HEAD:new.txt'), 'first\n');
  fixture.repository = new GitRepository(converted, 'origin', 'git', hostOf(this));
});

Given('a linked worktree with an external gitdir is inside the delivery repository', function () {
  const { git, work, bare } = gitOf(this);
  const head = git(work, 'rev-parse', 'HEAD').trim();
  git(work, 'push', 'origin', `${head}:refs/heads/external-fixture`);
  const linked = join(work, 'linked');
  git(bare, 'worktree', 'add', '--detach', linked, head);
  assert.ok(
    readFileSync(join(linked, '.git'), 'utf8').startsWith(`gitdir: ${realpathSync(bare)}/worktrees/`),
  );
});

Given('the nested delivery marker points to a missing gitdir', function () {
  writeFileSync(join(gitOf(this).work, 'linked/.git'), 'gitdir: /missing-gitdir\n');
});

// A gitlink with no directory in the checkout: only the recorded mode 160000 can show it, no marker can.
Given(
  'a gitlink {string} is recorded only in the {word} of the delivery repository',
  function (name: string, place: string) {
    const { git, work } = gitOf(this);
    const head = git(work, 'rev-parse', 'HEAD').trim();
    git(work, 'update-index', '--add', '--cacheinfo', `160000,${head},${name}`);
    if (place === 'head') {
      git(work, 'commit', '-qm', 'gitlink');
      git(work, 'rm', '-q', '--cached', name);
    } else assert.equal(place, 'index');
    assert.equal(existsSync(join(work, name)), false);
  },
);
