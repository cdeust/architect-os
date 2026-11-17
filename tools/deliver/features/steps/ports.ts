import assert from 'node:assert/strict';
import type {
  CiJob,
  CiRun,
  Clock,
  DeliveryEntry,
  DeliveryLog,
  Forge,
  Gate,
  Repository,
  RuleSuite,
} from '../../src/domain/ports.js';
import { InMemoryClock } from '../../src/infrastructure/in-memory-clock.js';
import { InMemoryForge } from '../../src/infrastructure/in-memory-forge.js';
import { InMemoryGate } from '../../src/infrastructure/in-memory-gate.js';
import { Journal } from '../../src/infrastructure/in-memory-journal.js';
import { InMemoryLog } from '../../src/infrastructure/in-memory-log.js';
import { InMemoryRepository } from '../../src/infrastructure/in-memory-repository.js';
import { Given, Then, When, type DeliverWorld } from './support.js';

// The contracts of the ports (ports.feature). Each adapter comes with a fixture: what a scenario needs to put the
// world of the port in a state (a history, a remote, a run, a verdict), which no port can do. The next adapters add
// their fixture here and their row to the outlines.

/** Commits are named by the scenario; their hashes are the adapter's. */
interface RepositoryFixture {
  repository: Repository;
  /** `removal`: the lines the commit removed from a file, relative to its parent. */
  commit(label: string, parent: string | undefined, removal?: { path: string; lines: number }): void;
  checkout(label: string): void;
  setRemote(branch: string, label: string): void;
  touchWorktree(): void;
  hashOf(label: string): string;
}

function inMemoryRepository(): RepositoryFixture {
  const repository = new InMemoryRepository(new Journal(), '0'.repeat(40));
  const hashes = new Map<string, string>();
  const hashOf = (label: string): string => hashes.get(label) as string;
  return {
    repository,
    commit(label, parent, removal) {
      const hash = (hashes.size + 1).toString(16).padStart(40, '0');
      hashes.set(label, hash);
      if (parent !== undefined) repository.link(hashOf(parent), hash);
      if (removal !== undefined) repository.removes(hash, removal.path, removal.lines);
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
    hashOf,
  };
}

interface ForgeFixture {
  forge: Forge;
  hasRun(hash: string, run: CiRun): void;
  evaluated(branch: string, hash: string, suite: RuleSuite): void;
  reruns(): string[];
}

function inMemoryForge(): ForgeFixture {
  const journal = new Journal();
  const forge = new InMemoryForge(journal);
  return {
    forge,
    hasRun: (hash, run) => forge.script(hash, [run]),
    evaluated: (branch, hash, suite) => forge.evaluate(branch, hash, [suite]),
    reruns: () => journal.calls.filter((call) => call.startsWith('rerun ')),
  };
}

interface GateFixture {
  gate: Gate;
  /** What the gate leaves, and how it exits, when it runs. */
  willLeave(verdict: string | undefined, code: number): void;
}

function inMemoryGate(): GateFixture {
  const gate = new InMemoryGate(new Journal());
  return {
    gate,
    willLeave(verdict, code) {
      gate.afterRun = verdict;
      gate.code = code;
    },
  };
}

interface ClockFixture {
  clock: Clock;
}

/** The in-memory clock also counts, which only its own scenario reads. */
interface InMemoryClockFixture extends ClockFixture {
  slept(): number;
}

function inMemoryClock(): InMemoryClockFixture {
  const clock = new InMemoryClock(new Journal());
  return { clock, slept: () => clock.slept };
}

interface LogFixture {
  log: DeliveryLog;
  /** What the log holds, in order. */
  entries(): DeliveryEntry[];
}

function inMemoryLog(): LogFixture {
  const log = new InMemoryLog(new Journal());
  return { log, entries: () => log.entries };
}

function adapter<T>(name: string, fixtures: Record<'in-memory', () => T>): T {
  assert.ok(name in fixtures, `no fixture for the adapter ${name}`);
  return fixtures[name as 'in-memory']();
}

const repo = (world: DeliverWorld): RepositoryFixture => world.state['portRepository'] as RepositoryFixture;
const forgeOf = (world: DeliverWorld): ForgeFixture => world.state['portForge'] as ForgeFixture;
const clockOf = (world: DeliverWorld): ClockFixture => world.state['portClock'] as ClockFixture;
const logOf = (world: DeliverWorld): LogFixture => world.state['portLog'] as LogFixture;
const gateOf = (world: DeliverWorld): GateFixture => world.state['portGate'] as GateFixture;

// Repository

Given('a delivery repository of the {word} adapter', function (name: string) {
  this.state['portRepository'] = adapter(name, { 'in-memory': inMemoryRepository });
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

Given(
  'the delivery repository holds the commit {string} after {string} that removed {int} lines from {string}',
  function (label: string, parent: string, lines: number, path: string) {
    repo(this).commit(label, parent, { path, lines });
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

Then(
  'the delivery repository counts {int} deleted lines in {string} from {string} to {string}',
  function (count: number, path: string, from: string, to: string) {
    const { repository, hashOf } = repo(this);
    assert.equal(repository.deletedLines(hashOf(from), hashOf(to), path), count);
  },
);

// Forge

Given('a delivery forge of the {word} adapter', function (name: string) {
  this.state['portForge'] = adapter(name, { 'in-memory': inMemoryForge });
});

Given(
  'the delivery forge holds for the commit {string} the run {int}, completed {string}, with the jobs {string}',
  function (hash: string, id: number, completed: string, jobs: string) {
    forgeOf(this).hasRun(hash, { id, completed: completed === 'yes', jobs: JSON.parse(jobs) as CiJob[] });
  },
);

Given(
  'the delivery forge evaluated the push of the commit {string} to the branch {string} as {string}',
  function (hash: string, branch: string, suite: string) {
    forgeOf(this).evaluated(branch, hash, suite as RuleSuite);
  },
);

When('I ask the delivery forge to rerun the failed jobs of the run {int}', function (id: number) {
  forgeOf(this).forge.rerunFailed(id);
});

Then('the delivery forge has no run of the commit {string}', function (hash: string) {
  assert.equal(forgeOf(this).forge.run(hash, 'gate'), undefined);
});

Then(
  'the delivery forge gives for the commit {string} the run {int}, completed {string}, with the jobs {string}',
  function (hash: string, id: number, completed: string, jobs: string) {
    assert.deepEqual(forgeOf(this).forge.run(hash, 'gate'), {
      id,
      completed: completed === 'yes',
      jobs: JSON.parse(jobs),
    });
  },
);

Then(
  'the delivery forge run of the commit {string} is not completed and has no jobs',
  function (hash: string) {
    const run = forgeOf(this).forge.run(hash, 'gate');
    assert.equal(run?.completed, false);
    assert.deepEqual(run?.jobs, []);
  },
);

Then('the delivery forge recorded the rerun of the run {int}', function (id: number) {
  assert.deepEqual(forgeOf(this).reruns(), [`rerun ${id}`]);
});

Then(
  'the delivery forge rule suite of the branch {string} and the commit {string} is nothing',
  function (branch: string, hash: string) {
    assert.equal(forgeOf(this).forge.ruleSuite(branch, hash), undefined);
  },
);

Then(
  'the delivery forge rule suite of the branch {string} and the commit {string} is {string}',
  function (branch: string, hash: string, suite: string) {
    assert.equal(forgeOf(this).forge.ruleSuite(branch, hash), suite);
  },
);

// Gate

Given('a delivery gate of the {word} adapter', function (name: string) {
  this.state['portGate'] = adapter(name, { 'in-memory': inMemoryGate });
});

Given(
  'the delivery gate leaves the verdict {string} and exits {int}',
  function (verdict: string, code: number) {
    gateOf(this).willLeave(verdict === 'none' ? undefined : verdict, code);
  },
);

When('I run the delivery gate', async function () {
  this.state['portGateCode'] = await gateOf(this).gate.run();
});

Then('the delivery gate verdict is nothing', function () {
  assert.equal(gateOf(this).gate.verdictHash(), undefined);
});

Then('the delivery gate verdict names {string}', function (hash: string) {
  assert.equal(gateOf(this).gate.verdictHash(), hash);
});

Then('the delivery gate exited {int}', function (code: number) {
  assert.equal(this.state['portGateCode'], code);
});

// Clock

Given('a delivery clock of the {word} adapter', function (name: string) {
  this.state['portClock'] = adapter(name, { 'in-memory': inMemoryClock });
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
  parent: '0'.repeat(40),
  ci: { run: 7, attempts: 1, polls: 2 },
  gate: 'ran',
  published: ['main'],
  ruleSuites: new Map<string, RuleSuite>([['main', 'pass']]),
});

Given('a delivery log of the {word} adapter', function (name: string) {
  this.state['portLog'] = adapter(name, { 'in-memory': inMemoryLog });
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
