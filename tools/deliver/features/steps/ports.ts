import assert from 'node:assert/strict';
import type { CiJob, DeliveryEntry, PullRequestResult, Stage } from '../../src/domain/ports.js';
import { InMemoryClock } from '../../src/infrastructure/in-memory-clock.js';
import { InMemoryForge } from '../../src/infrastructure/in-memory-forge.js';
import { InMemoryGate } from '../../src/infrastructure/in-memory-gate.js';
import { Journal } from '../../src/infrastructure/in-memory-journal.js';
import { InMemoryLog } from '../../src/infrastructure/in-memory-log.js';
import { InMemoryProgress } from '../../src/infrastructure/in-memory-progress.js';
import { InMemoryRepository } from '../../src/infrastructure/in-memory-repository.js';
import {
  DESTINATION,
  TRIAL,
  type ClockFixture,
  type ForgeFixture,
  type GateFixture,
  type LogFixture,
  type ProgressFixture,
  type RepositoryFixture,
} from './fixtures.js';
import { ghForge, REPO } from './gh-fixture.js';
import { gitFixture } from './git-fixture.js';
import { fileLog, processGate, streamProgress, timerClock } from './process-fixtures.js';
import { Given, Then, When, type DeliverWorld } from './support.js';

// The contracts of the ports (ports.feature). Each adapter comes with a fixture (fixtures.ts): what a scenario needs to
// put the world of the port in a state (a history, a remote, a run, a verdict), which no port can do. The fixtures of
// the real adapters are in git-fixture.ts and process-fixtures.ts; the scenarios of one adapter alone are in
// real-adapters.ts.

function inMemoryRepository(): RepositoryFixture {
  const repository = new InMemoryRepository(new Journal(), '0'.repeat(40));
  const hashes = new Map<string, string>();
  const hashOf = (label: string): string => hashes.get(label) as string;
  // A commit records what its parent records, as in git, and what it adds.
  const commit: RepositoryFixture['commit'] = (label, parent) => {
    const hash = (hashes.size + 1).toString(16).padStart(40, '0');
    hashes.set(label, hash);
    if (parent === undefined) return;
    const from = hashOf(parent);
    repository.link(from, hash);
    for (const [key, bytes] of [...repository.files]) {
      if (key.startsWith(`${from} `)) repository.files.set(`${hash}${key.slice(from.length)}`, bytes);
    }
    for (const key of [...repository.others]) {
      if (key.startsWith(`${from} `)) repository.others.add(`${hash}${key.slice(from.length)}`);
    }
  };
  return {
    repository,
    commit,
    commitFile(label, parent, path, text) {
      commit(label, parent);
      repository.files.set(`${hashOf(label)} ${path}`, Buffer.from(text));
    },
    commitLink(label, parent, path) {
      commit(label, parent);
      repository.others.add(`${hashOf(label)} ${path}`);
    },
    checkout(label) {
      repository.hash = hashOf(label);
    },
    setRemote(branch, label) {
      repository.remotes.set(branch, hashOf(label));
    },
    touchWorktree() {
      repository.touch();
    },
    nestRepository() {
      repository.nested = true;
    },
    // The double holds no file: the tree is the one the port describes, not clean and with no nested repository.
    changeIgnoreFileOverIgnoredRepository() {
      repository.touch();
    },
    hashOf,
  };
}

function inMemoryForge(): ForgeFixture {
  const journal = new Journal();
  const forge = new InMemoryForge(journal, REPO);
  return {
    forge,
    hasRun: (hash, run) => forge.script(hash, TRIAL, [run]),
    hasAttempts: (hash, id, attempts) => forge.scriptAttempts(hash, TRIAL, id, attempts),
    hasBranch: (branch, hash) => void forge.remote.set(branch, hash),
    // The double sees only the branches it was given.
    lacksBranch: () => undefined,
    hasDraft: (head, hash) => {
      forge.remote.set(head, hash);
      forge.openDraft(head, DESTINATION);
    },
    refusesPullRequests: () => void (forge.refusing = 'refused'),
    answersMerged: () => void (forge.refusing = 'merged'),
    reruns: () => journal.calls.filter((call) => call.startsWith('rerun ')),
  };
}

function inMemoryProgress(): ProgressFixture {
  const progress = new InMemoryProgress();
  return { progress, phases: () => progress.phases };
}

function inMemoryGate(): GateFixture {
  const gate = new InMemoryGate(new Journal());
  return {
    gate,
    willLeave(verdict, code, destination) {
      gate.afterRun =
        verdict === undefined
          ? undefined
          : { hash: verdict, destination: destination === 'none' ? undefined : destination };
      gate.code = code;
    },
  };
}

/** The in-memory clock also counts, which only its own scenario reads. */
interface InMemoryClockFixture extends ClockFixture {
  slept(): number;
}

function inMemoryClock(): InMemoryClockFixture {
  const clock = new InMemoryClock(new Journal());
  return { clock, slept: () => clock.slept };
}

function inMemoryLog(): LogFixture {
  const log = new InMemoryLog(new Journal());
  return { log, entries: () => log.entries };
}

/** The fixture of the adapter a scenario names; the real ones own a directory, released with the scenario. */
function adapter<T>(
  name: string,
  fixtures: Record<string, (world: DeliverWorld) => T>,
  world: DeliverWorld,
): T {
  const build = fixtures[name];
  assert.ok(build !== undefined, `no fixture for the adapter ${name}`);
  return build(world);
}

const repo = (world: DeliverWorld): RepositoryFixture => world.state['portRepository'] as RepositoryFixture;
const forgeOf = (world: DeliverWorld): ForgeFixture => world.state['portForge'] as ForgeFixture;
const clockOf = (world: DeliverWorld): ClockFixture => world.state['portClock'] as ClockFixture;
const logOf = (world: DeliverWorld): LogFixture => world.state['portLog'] as LogFixture;
const progressOf = (world: DeliverWorld): ProgressFixture => world.state['portProgress'] as ProgressFixture;
const gateOf = (world: DeliverWorld): GateFixture => world.state['portGate'] as GateFixture;

// Repository

Given('a delivery repository of the {word} adapter', function (name: string) {
  this.state['portRepository'] = adapter(name, { 'in-memory': inMemoryRepository, git: gitFixture }, this);
});

Given('the delivery repository holds the commit {string}', function (label: string) {
  repo(this).commit(label, undefined);
});

Given(
  'the delivery repository holds the commit {string} after {string}',
  function (label: string, parent: string) {
    repo(this).commit(label, parent);
  },
);

Given('the delivery repository is at the commit {string}', function (label: string) {
  repo(this).checkout(label);
});

Given(
  'the delivery remote holds the branch {string} at the commit {string}',
  function (branch: string, label: string) {
    repo(this).setRemote(branch, label);
  },
);

When('a repository is left nested in the delivery worktree', function () {
  repo(this).nestRepository();
});

When(
  'a tracked ignore file of the delivery worktree changes over an ignored directory that holds a repository',
  function () {
    repo(this).changeIgnoreFileOverIgnoredRepository();
  },
);

Then('the delivery repository holds no nested repository', function () {
  assert.equal(repo(this).repository.holdsNestedRepository(), false);
});

Then('the delivery repository holds a nested repository', function () {
  assert.equal(repo(this).repository.holdsNestedRepository(), true);
});

When('a file of the delivery worktree changes', function () {
  repo(this).touchWorktree();
});

When('the delivery repository fetches', function () {
  repo(this).repository.fetch();
});

When('I push the commit {string} to the delivery branch {string}', function (label: string, branch: string) {
  const { repository, hashOf } = repo(this);
  this.state['portPush'] = repository.push(hashOf(label), branch);
});

When('I delete the delivery remote branch {string}', function (branch: string) {
  repo(this).repository.deleteRemoteBranch(branch);
});

Then('the delivery repository head is 40 lower-case hexadecimal characters', function () {
  assert.match(repo(this).repository.head(), /^[0-9a-f]{40}$/);
});

Then('the delivery repository is clean', function () {
  assert.equal(repo(this).repository.isClean(), true);
});

Then('the delivery repository is not clean', function () {
  assert.equal(repo(this).repository.isClean(), false);
});

Then('the delivery remote head of {string} is the commit {string}', function (branch: string, label: string) {
  const { repository, hashOf } = repo(this);
  assert.equal(repository.remoteHead(branch), hashOf(label));
});

Given(
  'the delivery repository holds the commit {string} after {string} that records {string} as the text {string}',
  function (label: string, parent: string, path: string, text: string) {
    repo(this).commitFile(label, parent, path, text);
  },
);

Then(
  'the delivery commit {string} records at {string} the text {string}',
  function (label: string, path: string, text: string) {
    const { repository, hashOf } = repo(this);
    assert.deepEqual(Buffer.from(repository.committedFile(hashOf(label), path) ?? []), Buffer.from(text));
  },
);

Given(
  'the delivery repository holds the commit {string} after {string} that records a link at {string} to {string}',
  function (label: string, parent: string, path: string, target: string) {
    repo(this).commitLink(label, parent, path, target);
  },
);

Then(
  'the delivery commit {string} records at {string} and under it the entries {string}',
  function (label: string, path: string, expected: string) {
    const { repository, hashOf } = repo(this);
    const entries = repository
      .committedEntries(hashOf(label), path)
      .map((entry) => `${entry.path} ${entry.regular ? 'file' : 'other'}`)
      .sort();
    assert.deepEqual(entries, expected === '' ? [] : expected.split(', '));
  },
);

Then('the delivery commit {string} records no file at {string}', function (label: string, path: string) {
  const { repository, hashOf } = repo(this);
  assert.equal(repository.committedFile(hashOf(label), path), undefined);
});

Then('the delivery remote head of {string} is undefined', function (branch: string) {
  assert.equal(repo(this).repository.remoteHead(branch), undefined);
});

Then('the delivery push answered {string}', function (answer: string) {
  assert.equal(this.state['portPush'], answer);
});

Then(
  'the delivery commit {string} is an ancestor of {string}',
  function (ancestor: string, descendant: string) {
    const { repository, hashOf } = repo(this);
    assert.equal(repository.isAncestor(hashOf(ancestor), hashOf(descendant)), true);
  },
);

Then(
  'the delivery commit {string} is not an ancestor of {string}',
  function (ancestor: string, descendant: string) {
    const { repository, hashOf } = repo(this);
    assert.equal(repository.isAncestor(hashOf(ancestor), hashOf(descendant)), false);
  },
);

// Forge

Given('a delivery forge of the {word} adapter', function (name: string) {
  this.state['portForge'] = adapter(name, { 'in-memory': inMemoryForge, gh: ghForge }, this);
});

Given(
  'the delivery forge holds for the commit {string} the run {int}, completed {string}, with the jobs {string}',
  function (hash: string, id: number, completed: string, jobs: string) {
    forgeOf(this).hasRun(hash, { id, completed: completed === 'yes', jobs: JSON.parse(jobs) as CiJob[] });
  },
);

Given(
  'the delivery forge sees the branch {string} at the commit {string}',
  function (branch: string, hash: string) {
    forgeOf(this).hasBranch(branch, hash);
  },
);

Given('the delivery forge does not see the branch {string}', function (branch: string) {
  forgeOf(this).lacksBranch(branch);
});

Given(
  'a pull request from {string} at the commit {string} is open as a draft on the delivery forge',
  function (head: string, hash: string) {
    forgeOf(this).hasDraft(head, hash);
  },
);

Given(
  'the delivery forge sees the branch {string} at the commit {string}, and answers that the destination holds the commit',
  function (branch: string, hash: string) {
    forgeOf(this).hasBranch(branch, hash);
    forgeOf(this).answersMerged();
  },
);

Given(
  'the delivery forge sees the branch {string} at the commit {string}, and refuses every new pull request',
  function (branch: string, hash: string) {
    forgeOf(this).hasBranch(branch, hash);
    forgeOf(this).refusesPullRequests();
  },
);

/** Asks the forge of the scenario for a pull request, and keeps what it answered. */
function askPull(world: DeliverWorld, head: string, base: string, hash: string): void {
  const results = (world.state['portPulls'] ?? []) as PullRequestResult[];
  results.push(
    forgeOf(world).forge.openPullRequest({
      head,
      base,
      hash,
      title: 'Deliver the step step',
      body: '@someone closes #1\n',
    }),
  );
  world.state['portPulls'] = results;
}

When(
  'I ask the delivery forge for a pull request from {string} at the commit {string}',
  function (head: string, hash: string) {
    askPull(this, head, DESTINATION, hash);
  },
);

When(
  'I ask the delivery forge for a pull request from {string} to {string} at the commit {string}',
  function (head: string, base: string, hash: string) {
    askPull(this, head, base, hash);
  },
);

Then('the delivery forge refused the pull request because {string}', function (reason: string) {
  assert.deepEqual(this.state['portPulls'], [{ ok: false, reason }]);
});

Then('the delivery forge answered the pull requests {string}', function (expected: string) {
  assert.deepEqual(this.state['portPulls'], JSON.parse(expected));
});

Given(
  'the delivery forge holds for the commit {string} the run {int}, whose attempts executed the jobs {string}',
  function (hash: string, id: number, attempts: string) {
    forgeOf(this).hasAttempts(hash, id, JSON.parse(attempts) as CiJob[][]);
  },
);

Then(
  'the delivery forge gives for the commit {string}, asked for no job, the run {int} at attempt {int} with the jobs {string}',
  function (hash: string, id: number, attempt: number, jobs: string) {
    assert.deepEqual(forgeOf(this).forge.run(hash, 'gate', TRIAL), {
      id,
      completed: true,
      attempt,
      jobs: JSON.parse(jobs),
    });
  },
);

Then(
  'the delivery forge gives for the commit {string}, asked for {string}, the run {int} at attempt {int} with the jobs {string}',
  function (hash: string, asked: string, id: number, attempt: number, jobs: string) {
    const names = asked === 'all' ? 'all' : (JSON.parse(asked) as string[]);
    assert.deepEqual(forgeOf(this).forge.run(hash, 'gate', TRIAL, names), {
      id,
      completed: true,
      attempt,
      jobs: JSON.parse(jobs),
    });
  },
);

When('I ask the delivery forge to rerun the failed jobs of the run {int}', function (id: number) {
  forgeOf(this).forge.rerunFailed(id);
});

Then('the delivery forge has no run of the commit {string}', function (hash: string) {
  assert.equal(forgeOf(this).forge.run(hash, 'gate', TRIAL), undefined);
});

Then(
  'the delivery forge gives for the commit {string} the run {int}, completed {string}, with the jobs {string}',
  function (hash: string, id: number, completed: string, jobs: string) {
    assert.deepEqual(forgeOf(this).forge.run(hash, 'gate', TRIAL), {
      id,
      completed: completed === 'yes',
      jobs: JSON.parse(jobs),
    });
  },
);

Then(
  'the delivery forge run of the commit {string} is not completed and has no jobs',
  function (hash: string) {
    const run = forgeOf(this).forge.run(hash, 'gate', TRIAL);
    assert.equal(run?.completed, false);
    assert.deepEqual(run?.jobs, []);
  },
);

Then('the delivery forge recorded the rerun of the run {int}', function (id: number) {
  assert.deepEqual(forgeOf(this).reruns(), [`rerun ${id}`]);
});

Then(
  'the delivery forge has no run of the push of the commit {string} to {string}',
  function (hash: string, branch: string) {
    assert.equal(forgeOf(this).forge.run(hash, 'gate', branch), undefined);
  },
);

// Gate

/** The destination commit the report of a gate of these scenarios names, unless a scenario says it names none. */
const GATE_DESTINATION = '0000000000000000000000000000000000000005';

Then(
  'the delivery gate verdict names {string} against the destination {string}',
  function (hash: string, destination: string) {
    assert.deepEqual(gateOf(this).gate.verdict(), {
      hash,
      destination: destination === 'none' ? undefined : destination,
    });
  },
);

Given('a delivery gate of the {word} adapter', function (name: string) {
  this.state['portGate'] = adapter(name, { 'in-memory': inMemoryGate, process: processGate }, this);
});

Given(
  'the delivery gate leaves the verdict {string} and exits {int}',
  function (verdict: string, code: number) {
    gateOf(this).willLeave(verdict === 'none' ? undefined : verdict, code, GATE_DESTINATION);
  },
);

Given(
  'the delivery gate leaves the verdict {string} against no destination and exits {int}',
  function (verdict: string, code: number) {
    gateOf(this).willLeave(verdict, code, 'none');
  },
);

When('I run the delivery gate', async function () {
  this.state['portGateCode'] = await gateOf(this).gate.run();
});

Then('the delivery gate verdict is nothing', function () {
  assert.equal(gateOf(this).gate.verdict(), undefined);
});

Then('the delivery gate verdict names {string}', function (hash: string) {
  assert.equal(gateOf(this).gate.verdict()?.hash, hash);
});

Then('the delivery gate exited {int}', function (code: number) {
  assert.equal(this.state['portGateCode'], code);
});

// Clock

Given('a delivery clock of the {word} adapter', function (name: string) {
  this.state['portClock'] = adapter<ClockFixture>(
    name,
    { 'in-memory': inMemoryClock, timer: timerClock },
    this,
  );
});

When('I sleep {int} seconds on the delivery clock', async function (seconds: number) {
  const { clock } = clockOf(this);
  await clock.sleep(seconds);
  this.state['portSlept'] = true;
});

Then('the delivery clock sleep resolved', function () {
  assert.equal(this.state['portSlept'], true);
});

Then('the in-memory delivery clock counted {int} seconds', function (seconds: number) {
  assert.equal((clockOf(this) as InMemoryClockFixture).slept(), seconds);
});

// DeliveryLog

const entry = (outcome: DeliveryEntry['outcome'], hash: string): DeliveryEntry => ({
  outcome,
  hash,
  trial: 'sentinel/gate-1a-x',
  ci: { run: 7, attempts: 1, polls: 2 },
  gate: 'ran',
  published: ['deliver/x'],
  pullRequest: {
    number: 3,
    url: 'https://github.com/owner/name/pull/3',
    created: true,
    body: 'a'.repeat(64),
  },
});

Given('a delivery log of the {word} adapter', function (name: string) {
  this.state['portLog'] = adapter(name, { 'in-memory': inMemoryLog, file: fileLog }, this);
  this.state['portAppended'] = [];
});

When(
  'I append to the delivery log an entry {string} of the commit {string}',
  function (outcome: string, hash: string) {
    const appended = entry(outcome as DeliveryEntry['outcome'], hash);
    (this.state['portAppended'] as DeliveryEntry[]).push(appended);
    logOf(this).log.append(appended);
  },
);

Then('the delivery log holds, in order and whole, what was appended', function () {
  const read = logOf(this).entries();
  assert.equal(read.length, 2);
  assert.deepEqual(read, this.state['portAppended']);
});

// Progress

Given('a delivery progress of the {word} adapter', function (name: string) {
  this.state['portProgress'] = adapter(name, { 'in-memory': inMemoryProgress, stream: streamProgress }, this);
});

When('I report the phases {string} to the delivery progress', function (phases: string) {
  for (const phase of phases.split(', ')) progressOf(this).progress.phase(phase as Stage);
});

Then('the delivery progress holds the phases {string}', function (phases: string) {
  assert.equal(progressOf(this).phases().join(', '), phases);
});
