import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  branches: ['feat/gate-1a', 'main'],
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
  ruleSuitePolls: 10,
});

Given('a deliver config of the base form', function () {
  this.state['deliverConfig'] = { raw: base() } satisfies Scene;
});

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
  'the accepted deliver config holds the branches {string} and the required jobs {string}',
  function (branches: string, jobs: string) {
    const result = parsed(this);
    assert.ok(result.ok);
    const config: DeliverConfig = result.config;
    assert.deepEqual(config.branches, branches.split(', '));
    assert.deepEqual(config.requiredJobs, jobs.split(', '));
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
  'the committed Linux gate requires its two cucumber shards and mutation at {string}',
  function (step: string) {
    const result = parsed(this);
    assert.ok(result.ok);
    assert.deepEqual(result.config.jobDependencies, {
      'gate-linux': {
        producers: [
          'gate-linux-cucumber-1',
          'gate-linux-cucumber-2',
          ...Array.from({ length: 16 }, (_, i) => i + 1).flatMap((lane) => [
            'gate-linux-lane-' + lane + ' / mutation',
            'gate-linux-lane-' + lane + ' / replay',
          ]),
        ],
        admissionStep: step,
      },
    });
  },
);
