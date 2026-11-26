import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ciState } from '../../src/domain/ci.js';
import type { DeliverConfig } from '../../src/domain/config.js';
import { parseDeliverConfig } from '../../src/infrastructure/deliver-schema.js';
import { Given, REPOSITORY, Then, When, type DeliverWorld } from './support.js';

type Parsed = ReturnType<typeof parseDeliverConfig>;

interface Scene {
  raw: Record<string, unknown>;
  parsed?: Parsed;
}

const scene = (world: DeliverWorld): Scene => world.state['deliverConfig'] as Scene;
const parsed = (world: DeliverWorld): Parsed => scene(world).parsed as Parsed;

/** The form of the committed file, written out so that a scenario does not move with the file. */
const base = (): Record<string, unknown> => ({
  description: 'La commande de livraison.',
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
  environment: ['PATH', 'HOME', 'GH_TOKEN'],
  log: '${state}/deliveries.jsonl',
  ciAttempts: 6,
  pollSeconds: 30,
  ciPolls: 90,
});

Given('a deliver config of the base form', function () {
  this.state['deliverConfig'] = { raw: base() } satisfies Scene;
});

Given(
  'its Linux and macOS families use {string} and {string} in {string} order with a shared preflight',
  function (linux: string, macos: string, order: string) {
    const group = (prefix: string, suffix: string) => ({
      admissionStep: 'Check',
      producers: ['preflight'],
      plannedProducers: { prefix, suffixes: [suffix] },
    });
    const linuxGroup = group(linux, ':m');
    const macGroup = group(macos, ':r');
    assert.ok(['Linux first', 'macOS first'].includes(order));
    scene(this).raw['jobDependencies'] =
      order === 'Linux first'
        ? { 'gate-linux': linuxGroup, 'gate-macos': macGroup }
        : { 'gate-macos': macGroup, 'gate-linux': linuxGroup };
  },
);

Then(
  'the accepted deliver config judges the names {string} with {string} failing as {string}',
  function (names: string, failed: string, expected: string) {
    const result = parsed(this);
    assert.ok(result.ok);
    const jobs = names.split(', ').map((name) => ({
      name,
      conclusion: name === failed ? ('failure' as const) : ('success' as const),
      hadRunner: true,
      failedStep: name === failed,
    }));
    assert.ok(jobs.some((job) => job.name === failed));
    assert.equal(
      ciState({ id: 1, completed: true, jobs }, result.config.requiredJobs, result.config.jobDependencies),
      expected,
    );
  },
);

Then(
  'the accepted config judges {int} numbered lanes with {string} as {string}',
  function (count: number, observations: string, expected: string) {
    const result = parsed(this);
    assert.ok(result.ok);
    const group = result.config.jobDependencies?.['gate-linux'];
    assert.ok(group?.plannedProducers);
    const { prefix, suffixes } = group.plannedProducers;
    const names = [...result.config.requiredJobs, ...group.producers];
    for (let lane = 1; lane <= count; lane++) {
      for (const suffix of suffixes) names.push(prefix + lane + suffix);
    }
    assert.ok(['unique names', 'all jobs'].includes(observations));
    const rows = observations === 'unique names' ? [...new Set(names)] : names;
    const jobs = rows.map((name) => ({
      name,
      conclusion: 'success' as const,
      hadRunner: true,
      failedStep: false,
    }));
    assert.equal(
      ciState({ id: 1, completed: true, jobs }, result.config.requiredJobs, result.config.jobDependencies),
      expected,
    );
  },
);

Given('the deliver config field {string} is set to {string}', function (field: string, value: string) {
  scene(this).raw[field] = JSON.parse(value);
});

Given(
  'the deliver config field {string} is set to a string of {int} characters',
  function (field: string, length: number) {
    scene(this).raw[field] = 'x'.repeat(length);
  },
);

Given(
  'the deliver config field {string} is set to a list of one string of {int} characters',
  function (field: string, length: number) {
    scene(this).raw[field] = ['x'.repeat(length)];
  },
);

Given('the deliver config field {string} is removed', function (field: string) {
  delete scene(this).raw[field];
});

When('the deliver config is parsed', function () {
  scene(this).parsed = parseDeliverConfig(scene(this).raw);
});

When('the committed deliver config is loaded', function () {
  const text = readFileSync(`${REPOSITORY}tools/deliver/deliver.json`, 'utf8');
  this.state['deliverConfig'] = { raw: JSON.parse(text) as Record<string, unknown> } satisfies Scene;
  scene(this).parsed = parseDeliverConfig(scene(this).raw);
});

Then('the parsed dependency declarations equal every entry of the input', function () {
  const result = parsed(this);
  assert.ok(result.ok);
  assert.deepEqual(result.config.jobDependencies, scene(this).raw['jobDependencies']);
});

Then('the deliver config is accepted', function () {
  const result = parsed(this);
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
});

Then('the deliver config is refused with a reason holding {string}', function (reason: string) {
  const result = parsed(this);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason.includes(reason), result.ok ? '' : result.reason);
});

Then('the deliver config is refused with the reason {string}', function (reason: string) {
  const result = parsed(this);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.reason, reason);
});

Then(
  'the accepted deliver config asks for a pull request to {string} from a branch under {string}, titled {string}, and requires the jobs {string}',
  function (destination: string, prefix: string, title: string, jobs: string) {
    const result = parsed(this);
    assert.ok(result.ok);
    const config: DeliverConfig = result.config;
    assert.deepEqual(
      [config.destination, config.workPrefix, config.pullRequestTitle, config.requiredJobs],
      [destination, prefix, title, jobs.split(', ')],
    );
  },
);

Then('the committed deliver config names the section of its design', function () {
  assert.equal(typeof scene(this).raw['description'], 'string');
  assert.ok(
    (scene(this).raw['description'] as string).includes('docs/design/orchestration-fable-5-2.md §14'),
  );
});

Then('the committed deliver config says what its environment key is', function () {
  const description = scene(this).raw['description'] as string;
  assert.ok(description.includes('`environment`'));
  assert.ok(description.includes('liste fermée des noms des variables de l'));
});

Then('the committed deliver config gives the host variables of git and of the forge client', function () {
  assert.deepEqual(scene(this).raw['environment'], [
    'PATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'SSH_AUTH_SOCK',
    'XDG_CONFIG_HOME',
    'GH_TOKEN',
    'GITHUB_TOKEN',
  ]);
});

Then(
  'the committed Linux gate requires its two cucumber shards, its plan and the lanes the run planned at {string}',
  function (step: string) {
    const result = parsed(this);
    assert.ok(result.ok);
    assert.deepEqual(result.config.jobDependencies, {
      'gate-linux': {
        producers: ['gate-linux-cucumber-1', 'gate-linux-cucumber-2', 'gate-linux-plan'],
        plannedProducers: { prefix: 'gate-linux-lane-', suffixes: [' / mutation', ' / replay'] },
        admissionStep: step,
      },
    });
  },
);
