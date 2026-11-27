import assert from 'node:assert/strict';
import { deliver, type Delivery } from '../../src/application/deliver.js';
import type { DeliverConfig } from '../../src/domain/config.js';
import type { CiRun } from '../../src/domain/ports.js';
import { pullRequestBody } from '../../src/domain/pull-request.js';
import { InMemoryClock } from '../../src/infrastructure/in-memory-clock.js';
import { InMemoryForge } from '../../src/infrastructure/in-memory-forge.js';
import { InMemoryGate } from '../../src/infrastructure/in-memory-gate.js';
import { Journal } from '../../src/infrastructure/in-memory-journal.js';
import { InMemoryLog } from '../../src/infrastructure/in-memory-log.js';
import { InMemoryProgress } from '../../src/infrastructure/in-memory-progress.js';
import { InMemoryRepository } from '../../src/infrastructure/in-memory-repository.js';
import { parseStepRecord } from '../../src/infrastructure/step-record.js';
import { stepRecord, stepRecordText } from './record-fixture.js';
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
  parseRecord: typeof parseStepRecord;
  result?: Delivery;
}

/** The trial branch and the work branch of the name `step`. */
const TRIAL = 'sentinel/gate-1a-step';
const WORK = 'deliver/step';
const RECORD = 'steps/step/record.json';
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
  'a delivery over the in-memory ports, the commit {string} ahead of the destination at {string}',
  function (commit: string, parent: string) {
    const journal = new Journal();
    const repository = new InMemoryRepository(journal, hex(commit));
    repository.link(hex(parent), hex(commit));
    repository.remotes.set('main', hex(parent));
    repository.files.set(`${hex(commit)} ${RECORD}`, Buffer.from(stepRecordText()));
    const forge = new InMemoryForge(journal, 'cdeust/architect-os', repository.remotes);
    forge.script(hex(commit), TRIAL, [ciRun('green')]);
    const gate = new InMemoryGate(journal);
    gate.afterRun = { hash: hex(commit), destination: hex(parent) };
    this.state['delivery'] = {
      config: {
        description: 'scenario',
        remote: 'origin',
        repository: 'cdeust/architect-os',
        destination: 'main',
        workPrefix: 'deliver/',
        pullRequestTitle: 'Deliver the step ${name}',
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
      parseRecord: parseStepRecord,
    } satisfies Scene;
  },
);

Given('the delivery setting {string} is {int}', function (key: string, value: number) {
  (scene(this).config as unknown as Record<string, unknown>)[key] = value;
});

Given('the delivery tree holds a nested repository', function () {
  scene(this).repository.nested = true;
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

Given('the receipt of the delivery gate names no destination', function () {
  const { gate } = scene(this);
  for (const verdict of [gate.held, gate.afterRun])
    if (verdict !== undefined) verdict.destination = undefined;
});

Given('the receipt of the delivery gate names the destination {string}', function (hash: string) {
  const { gate } = scene(this);
  for (const verdict of [gate.held, gate.afterRun])
    if (verdict !== undefined) verdict.destination = hex(hash);
});

Given(
  'the delivery file {string} holds {string} at {string}',
  function (path: string, text: string, hash: string) {
    // `{lf}` is a line break; `none`: the commit records no such file.
    const { files } = scene(this).repository;
    if (text === 'none') files.delete(`${hex(hash)} ${path}`);
    else files.set(`${hex(hash)} ${path}`, Buffer.from(text.replaceAll('{lf}', '\n')));
  },
);

Given('the delivery append-only files are {string}', function (paths: string) {
  scene(this).config.appendOnly = paths === '' ? [] : paths.split(', ');
});

Given('the delivery push to {string} is refused', function (branch: string) {
  scene(this).repository.refusing.add(branch);
});

Given('the delivery gate verdict already names {string}', function (hash: string) {
  scene(this).gate.held = { hash: hex(hash), destination: scene(this).parent };
});

Given(
  'the delivery gate exits {int} and then leaves the verdict {string}',
  function (code: number, verdict: string) {
    scene(this).gate.code = code;
    scene(this).gate.afterRun =
      verdict === 'none' ? undefined : { hash: hex(verdict), destination: scene(this).parent };
  },
);

Given('the delivery CI answers {string}', function (kinds: string) {
  const { forge, commit } = scene(this);
  forge.script(commit, TRIAL, kinds.split(', ').map(ciRun));
});

Given('the delivery commit records no record of the step', function () {
  const { repository, commit } = scene(this);
  repository.files.delete(`${commit} ${RECORD}`);
});

Given('the delivery commit records as the record of the step the text {string}', function (text: string) {
  const { repository, commit } = scene(this);
  // `{bytes}`: two bytes that are not UTF-8.
  repository.files.set(
    `${commit} ${RECORD}`,
    text === '{bytes}' ? Buffer.from([0xff, 0xfe]) : Buffer.from(text),
  );
});

Given(
  'the delivery commit records as the record of the step the record of the step {string}',
  function (step: string) {
    const { repository, commit } = scene(this);
    repository.files.set(`${commit} ${RECORD}`, Buffer.from(stepRecordText(step)));
  },
);

Given(
  'the delivery commit records as the record of the step one that its schema accepts but for a byte that is not UTF-8',
  function () {
    const { repository, commit } = scene(this);
    // A model name is any text to the schema: decoded without refusal, the byte would become U+FFFD and pass.
    const session = {
      role: 'review',
      name: 'correctness',
      model: 'MODEL-X',
      effort: 'high',
      completed: true,
      stopped: false,
      durationSeconds: 1,
      costUsd: 0,
      costByModel: {},
    };
    const text = JSON.stringify({ ...stepRecord(), sessions: [session] });
    assert.ok(
      parseStepRecord(Buffer.from(text)) !== undefined,
      'the record is valid before its byte is changed',
    );
    const bytes = Buffer.from(text);
    bytes[bytes.indexOf('MODEL-X') + 6] = 0xff;
    repository.files.set(`${commit} ${RECORD}`, bytes);
  },
);

Given('the forge of the delivery sequence refuses every new pull request', function () {
  scene(this).forge.refusing = true;
});

Given(
  'a draft pull request from {string} to {string} is open on the forge of the delivery sequence',
  function (head: string, base: string) {
    scene(this).forge.openDraft(head, base);
  },
);

Given('the forge of the delivery sequence opens pull requests again', function () {
  scene(this).forge.refusing = false;
});

Given(
  'the delivery commit {string} follows {string}, records the record of the step, and is the one to deliver',
  function (commit: string, parent: string) {
    const { repository, forge, gate } = scene(this);
    repository.link(hex(parent), hex(commit));
    repository.files.set(`${hex(commit)} ${RECORD}`, Buffer.from(stepRecordText()));
    repository.hash = hex(commit);
    forge.script(hex(commit), TRIAL, [ciRun('green')]);
    gate.afterRun = { hash: hex(commit), destination: scene(this).parent };
    scene(this).commit = hex(commit);
  },
);

Then('the delivery forge holds only the draft pull request', function () {
  assert.deepEqual(scene(this).forge.pulls, [{ number: 1, head: WORK, base: 'main', draft: true }]);
});

Then('the delivery forge holds {int} pull request(s), none a draft', function (count: number) {
  const { pulls } = scene(this).forge;
  assert.equal(pulls.length, count);
  assert.ok(pulls.every((pull) => !pull.draft));
});

Then(
  'the delivery pull request was asked from {string} to {string} with the title {string} and the body of the record',
  function (head: string, base: string, title: string) {
    const { forge, commit } = scene(this);
    assert.ok(forge.requests.length > 0);
    for (const request of forge.requests) {
      assert.deepEqual(
        { head: request.head, base: request.base, hash: request.hash, title: request.title },
        { head, base, hash: commit, title },
      );
      assert.equal(
        request.body,
        pullRequestBody(stepRecord(), { repository: 'cdeust/architect-os', hash: commit, name: 'step' }),
      );
    }
  },
);

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

const ACTS = ['fetch', 'push', 'gate', 'sleep', 'rerun', 'pullRequest', 'delete', 'log'];

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

Given('the delivery setting {string} is the text {string}', function (key: string, value: string) {
  (scene(this).config as unknown as Record<string, unknown>)[key] = value;
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

Given('the delivery CI follows {string} exactly across a rerun request', function (timeline: string) {
  const { forge, commit, journal } = scene(this);
  forge.script(commit, TRIAL, timeline.split(', ').map(ciRun));
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
