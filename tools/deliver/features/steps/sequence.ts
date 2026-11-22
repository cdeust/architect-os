import assert from 'node:assert/strict';
import { deliver, type Delivery } from '../../src/application/deliver.js';
import type { DeliverConfig } from '../../src/domain/config.js';
import type { CiRun, RuleSuite } from '../../src/domain/ports.js';
import { InMemoryClock } from '../../src/infrastructure/in-memory-clock.js';
import { InMemoryForge } from '../../src/infrastructure/in-memory-forge.js';
import { InMemoryGate } from '../../src/infrastructure/in-memory-gate.js';
import { Journal } from '../../src/infrastructure/in-memory-journal.js';
import { InMemoryLog } from '../../src/infrastructure/in-memory-log.js';
import { InMemoryProgress } from '../../src/infrastructure/in-memory-progress.js';
import { InMemoryRepository } from '../../src/infrastructure/in-memory-repository.js';
import { Given, Then, When, type DeliverWorld } from './support.js';

interface Scene {
  config: DeliverConfig;
  /** The commit to deliver and its parent, as hexadecimal hashes. */
  commit: string;
  parent: string;
  journal: Journal;
  repository: InMemoryRepository;
  forge: InMemoryForge;
  gate: InMemoryGate;
  clock: InMemoryClock;
  log: InMemoryLog;
  progress: InMemoryProgress;
  result?: Delivery;
}
/**
 * A scenario speaks of commits by short names (`h1`, `p0`); the ports hold 40 hexadecimal characters, which the names
 * stand for on the way in (`hex`) and on the way out (`named`).
 */
const LETTERS = 'abcdefabcd';
const hex = (name: string): string => {
  const match = /^([hp])([0-9])$/.exec(name);
  if (match === null) return name;
  return (match[1] === 'h' ? (match[2] as string) : (LETTERS[Number(match[2])] as string)).repeat(40);
};
const SHORT_NAMES = ['h', 'p'].flatMap((letter) =>
  Array.from({ length: 10 }, (_, digit) => `${letter}${digit}`),
);
const named = (text: string): string =>
  text.replace(/[0-9a-f]{40}/g, (found) => SHORT_NAMES.find((name) => hex(name) === found) ?? found);

const scene = (world: DeliverWorld): Scene => world.state['delivery'] as Scene;
const result = (world: DeliverWorld): Delivery => scene(world).result as Delivery;

const job = (
  name: string,
  conclusion: CiRun['jobs'][number]['conclusion'],
  hadRunner: boolean,
  failedStep: boolean,
) => ({
  name,
  conclusion,
  hadRunner,
  failedStep,
});

/** The runs a scenario can make the forge answer; the id is that of the run all along (a rerun keeps it). */
function ciRun(kind: string): CiRun | undefined {
  switch (kind) {
    case 'admission-1':
    case 'admission-unnumbered':
    case 'accepted-2': {
      const passed = kind === 'accepted-2';
      return {
        id: 42,
        completed: true,
        ...(kind === 'admission-unnumbered' ? {} : { attempt: passed ? 2 : 1 }),
        jobs: [
          {
            ...job('gate-linux', passed ? 'success' : 'failure', true, !passed),
            ...(passed ? {} : { firstStepFailure: 'Require all producers' }),
          },
          job('producer', passed ? 'success' : 'cancelled', passed, false),
          job('gate-macos', 'success', true, false),
        ],
      };
    }
    case 'missing':
      return undefined;
    case 'waiting':
      return { id: 42, completed: false, jobs: [] };
    case 'green':
      return {
        id: 42,
        completed: true,
        jobs: [job('gate-linux', 'success', true, false), job('gate-macos', 'success', true, false)],
      };
    case 'no-runner':
      return {
        id: 42,
        completed: true,
        jobs: [job('gate-linux', 'success', true, false), job('gate-macos', 'cancelled', false, false)],
      };
    case 'failed':
      return {
        id: 42,
        completed: true,
        jobs: [job('gate-linux', 'failure', true, true), job('gate-macos', 'success', true, false)],
      };
    default:
      throw new Error(`unknown CI run kind: ${kind}`);
  }
}

Given('the delivery Linux gate has a required producer', function () {
  scene(this).config.jobDependencies = {
    'gate-linux': { producers: ['producer'], admissionStep: 'Require all producers' },
  };
});

Given(
  'a delivery over the in-memory ports, the commit {string} ahead of both branches at {string}',
  function (commit: string, parent: string) {
    const journal = new Journal();
    const repository = new InMemoryRepository(journal, hex(commit));
    repository.link(hex(parent), hex(commit));
    repository.remotes.set('feat/gate-1a', hex(parent));
    repository.remotes.set('main', hex(parent));
    const forge = new InMemoryForge(journal, repository.remotes);
    forge.script(hex(commit), [ciRun('green')]);
    forge.evaluate('feat/gate-1a', hex(commit), ['pass']);
    forge.evaluate('main', hex(commit), ['pass']);
    const gate = new InMemoryGate(journal);
    gate.afterRun = hex(commit);
    this.state['delivery'] = {
      config: {
        description: 'scenario',
        remote: 'origin',
        repository: 'cdeust/architect-os',
        branches: ['feat/gate-1a', 'main'],
        trialPrefix: 'sentinel/gate-1a-',
        workflow: 'gate',
        requiredJobs: ['gate-linux', 'gate-macos'],
        appendOnly: ['docs/design/journal.md'],
        gateCommand: ['npm', 'run', 'gate'],
        gateLog: 'reports/deliver-gate.log',
        log: '${state}/deliveries.jsonl',
        environment: ['PATH'],
        ciAttempts: 3,
        pollSeconds: 30,
        ciPolls: 5,
        ruleSuitePolls: 3,
      },
      commit: hex(commit),
      parent: hex(parent),
      journal,
      repository,
      forge,
      gate,
      clock: new InMemoryClock(journal),
      log: new InMemoryLog(journal),
      progress: new InMemoryProgress(),
    } satisfies Scene;
  },
);

Given('the delivery setting {string} is {int}', function (key: string, value: number) {
  (scene(this).config as unknown as Record<string, unknown>)[key] = value;
});

Given('the delivery tree is not clean', function () {
  scene(this).repository.clean = false;
});

Given('the delivery remote branch {string} is at {string}', function (branch: string, hash: string) {
  scene(this).repository.remotes.set(branch, hex(hash));
});

Given('the delivery remote branch {string} is absent', function (branch: string) {
  scene(this).repository.remotes.delete(branch);
});

Given(
  'the delivery remote branch {string} moves to {string} after the first fetch',
  function (branch: string, hash: string) {
    scene(this).repository.moved.set(branch, hex(hash));
  },
);

Given('the delivery remote branch {string} is deleted after the first fetch', function (branch: string) {
  scene(this).repository.deleted.add(branch);
});

Given(
  'the delivery history holds {string} as an ancestor of {string}',
  function (ancestor: string, descendant: string) {
    scene(this).repository.link(hex(ancestor), hex(descendant));
  },
);

Given('the delivery file {string} lost {int} lines', function (path: string, lines: number) {
  const { repository, commit } = scene(this);
  repository.removes(commit, path, lines);
});

Given('the delivery append-only files are {string}', function (paths: string) {
  scene(this).config.appendOnly = paths === '' ? [] : paths.split(', ');
});

Given('the delivery push to {string} is refused', function (branch: string) {
  scene(this).repository.refusing.add(branch);
});

Given('the delivery gate verdict already names {string}', function (hash: string) {
  scene(this).gate.verdict = hex(hash);
});

Given(
  'the delivery gate exits {int} and then leaves the verdict {string}',
  function (code: number, verdict: string) {
    scene(this).gate.code = code;
    scene(this).gate.afterRun = verdict === 'none' ? undefined : hex(verdict);
  },
);

Given('the delivery CI answers {string}', function (kinds: string) {
  const { forge, commit } = scene(this);
  forge.script(commit, kinds.split(', ').map(ciRun));
});

Given('the delivery rule suite of {string} answers {string}', function (branch: string, answers: string) {
  const { forge, commit } = scene(this);
  forge.evaluate(
    branch,
    commit,
    answers.split(', ').map((answer) => (answer === 'none' ? undefined : (answer as RuleSuite))),
  );
});

When('I deliver {string} until {string}', async function (name: string, until: string) {
  const s = scene(this);
  s.result = await deliver({ name, until: until as 'end' | 'ci' }, s.config, s);
});

/** The result as JSON: the maps of a result become objects, the keys left undefined are absent. */
const describe = (value: unknown): unknown =>
  JSON.parse(
    named(
      JSON.stringify(value, (_key, item: unknown) => (item instanceof Map ? Object.fromEntries(item) : item)),
    ),
  );

Then('the delivery result is:', function (expected: string) {
  assert.deepEqual(describe(result(this)), JSON.parse(expected));
});

Then('the delivery log holds exactly the result', function () {
  assert.equal(scene(this).log.entries.length, 1);
  assert.equal(scene(this).log.entries[0], result(this));
});

Then('the delivery log holds no entry', function () {
  assert.deepEqual(scene(this).log.entries, []);
});

const ACTS = ['fetch', 'push', 'gate', 'sleep', 'rerun', 'delete', 'log'];

const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '');

Then('the delivery acts are:', function (expected: string) {
  const acts = scene(this)
    .journal.calls.filter((call) => ACTS.includes(call.split(' ')[0] as string))
    .map(named);
  assert.deepEqual(acts, lines(expected));
});

Then('the delivery phases reported are:', function (expected: string) {
  assert.deepEqual(scene(this).progress.phases, lines(expected));
});

Then('the delivery calls named {string} are:', function (names: string, expected: string) {
  const wanted = names.split(', ');
  const calls = scene(this)
    .journal.calls.filter((call) => wanted.includes(call.split(' ')[0] as string))
    .map(named);
  assert.deepEqual(calls, lines(expected));
});

Then('the delivery clock slept {int} seconds', function (seconds: number) {
  assert.equal(scene(this).clock.slept, seconds);
});

Then('the delivery stopped at the phase {string} because {string}', function (phase: string, reason: string) {
  const got = result(this);
  assert.equal(got.outcome, 'stopped');
  assert.equal(got.phase, phase);
  assert.equal(got.reason, reason);
});

Given('the delivery commit to deliver is {string}', function (hash: string) {
  scene(this).repository.hash = hex(hash);
});

Given('the delivery branches are {string}', function (branches: string) {
  scene(this).config.branches = branches.split(', ');
});

Then('the delivery outcome is {string}', function (outcome: string) {
  assert.equal(result(this).outcome, outcome);
});

Then('the delivery journal is empty', function () {
  assert.deepEqual(scene(this).journal.calls, []);
});

When('the delivery repository pushes {string} to {string}', function (hash: string, branch: string) {
  assert.equal(scene(this).repository.push(hex(hash), branch), 'pushed');
});

Then(
  'the delivery forge gives no rule suite of the branch {string} at {string}',
  function (branch: string, hash: string) {
    assert.equal(scene(this).forge.ruleSuite(branch, hex(hash)), undefined);
  },
);

Then(
  'the delivery forge gives the rule suite {string} of the branch {string} at {string}',
  function (suite: string, branch: string, hash: string) {
    assert.equal(scene(this).forge.ruleSuite(branch, hex(hash)), suite);
  },
);

Given('the delivery CI follows {string} exactly across a rerun request', function (timeline: string) {
  const { forge, commit, journal } = scene(this);
  forge.script(commit, timeline.split(', ').map(ciRun));
  forge.rerunFailed = (id) => journal.record('rerun', id);
});

Then(
  'delivery is ready after {int} attempts and {int} polls, with one rerun',
  function (attempts: number, polls: number) {
    const delivered = result(this);
    assert.equal(delivered.outcome, 'ready');
    assert.deepEqual(delivered.ci, { run: 42, attempts, polls });
    assert.deepEqual(
      scene(this).journal.calls.filter((call) => call.startsWith('rerun ')),
      ['rerun 42'],
    );
  },
);
