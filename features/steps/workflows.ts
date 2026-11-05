import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

/**
 * Shape of a GitHub Actions workflow as far as the guards need it (docs.github.com, "Workflow syntax for GitHub
 * Actions"): triggers under `on`, `permissions`, and per job a list of steps with `uses`, `run` and `with`.
 * YAML 1.2 (the `yaml` package default) reads the key `on` as a string, not as a boolean.
 */
const StepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
const WorkflowSchema = z.object({
  on: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  permissions: z.record(z.string(), z.string()).optional(),
  jobs: z.record(
    z.string(),
    z.object({
      name: z.string().optional(),
      if: z.string().optional(),
      environment: z.string().optional(),
      steps: z.array(StepSchema),
    }),
  ),
});
type Workflow = z.infer<typeof WorkflowSchema>;

interface Loaded {
  path: string;
  text: string;
}

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/;

function workflow(text: string): Workflow {
  return WorkflowSchema.parse(parse(text));
}

function steps(text: string): z.infer<typeof StepSchema>[] {
  return Object.values(workflow(text).jobs).flatMap((job) => job.steps);
}

function assertPinned(text: string): void {
  for (const { uses } of steps(text)) {
    if (uses !== undefined) assert.match(uses, PINNED, `action not pinned by a 40-hex SHA: ${uses}`);
  }
}

function assertNpmCiSafe(text: string): void {
  for (const { run } of steps(text)) {
    for (const line of (run ?? '').split('\n').filter((l) => /\bnpm ci\b/.test(l))) {
      assert.match(line, /--ignore-scripts/, `npm ci without --ignore-scripts: ${line}`);
    }
  }
}

function assertCheckoutWithoutCredentials(text: string): void {
  for (const { uses, with: inputs } of steps(text)) {
    if (uses?.startsWith('actions/checkout@') === true) {
      assert.equal(inputs?.['persist-credentials'], false, 'checkout without persist-credentials: false');
    }
  }
}

function assertGate(text: string): void {
  const doc = workflow(text);
  assert.ok(typeof doc.on === 'object' && !Array.isArray(doc.on), 'on is a mapping');
  assert.ok('pull_request' in doc.on, 'gate.yml has the pull_request trigger');
  assert.ok(!('pull_request_target' in doc.on), 'gate.yml must not use pull_request_target');
  assert.deepEqual(doc.permissions, { contents: 'read', actions: 'read' });
  assert.ok(!text.includes('secrets.'), 'gate.yml must not use a secret');
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['gate-linux', 'gate-macos']);
  for (const [id, job] of Object.entries(doc.jobs)) assert.equal(job.name, id);
  for (const step of Object.values(doc.jobs).flatMap((job) => job.steps)) {
    assert.ok(!('cache' in (step.with ?? {})), 'gate.yml must not use a cache');
    if (step.uses?.startsWith('actions/checkout@') === true) {
      assert.equal(step.with?.['fetch-depth'], 2, 'checkout with fetch-depth: 2');
    }
  }
}

/** The environment that holds the test key of T-04R, and its one secret (docs/infrastructure.md, Secrets broker). */
const LIVE_ENVIRONMENT = 'broker-live';
const LIVE_SECRET = '${{ secrets.ANTHROPIC_TEST_KEY }}';

/**
 * broker-live.yml: the only workflow with a secret of the broker. It runs on main only (push, schedule, dispatch; never
 * a pull request), with contents: read, in the environment whose branch policy the owner restricts to main, and the
 * secret enters one step by its env, never a run line or an action input.
 */
function assertLive(text: string): void {
  const doc = workflow(text);
  assert.ok(typeof doc.on === 'object' && !Array.isArray(doc.on), 'on is a mapping');
  for (const trigger of Object.keys(doc.on)) {
    assert.ok(['push', 'schedule', 'workflow_dispatch'].includes(trigger), `trigger refused: ${trigger}`);
  }
  assert.deepEqual((doc.on['push'] as { branches?: unknown } | undefined)?.branches, ['main']);
  assert.deepEqual(doc.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(doc.jobs), ['broker-live']);
  const job = doc.jobs['broker-live'];
  assert.equal(job?.environment, LIVE_ENVIRONMENT);
  assert.equal(job?.if, "github.ref == 'refs/heads/main'");
  const secrets = (job?.steps ?? []).flatMap((step) => {
    assert.ok(!(step.run ?? '').includes('secrets.'), 'a secret in a run line');
    assert.ok(!JSON.stringify(step.with ?? {}).includes('secrets.'), 'a secret in an action input');
    return Object.values(step.env ?? {}).filter((value) => value.includes('secrets.'));
  });
  assert.deepEqual(secrets, [LIVE_SECRET]);
}

Given('the committed workflow {string}', function (name: string) {
  const path = `.github/workflows/${name}`;
  this.state['workflow'] = { path, text: readFileSync(join(ROOT, path), 'utf8') } satisfies Loaded;
});

const text = (world: Parameters<typeof stored>[0]): string => stored<Loaded>(world, 'workflow').text;

Then('every action it uses is pinned by a commit SHA', function () {
  assertPinned(text(this));
});

Then('every npm ci in it has --ignore-scripts', function () {
  assertNpmCiSafe(text(this));
});

Then('every checkout in it has persist-credentials false', function () {
  assertCheckoutWithoutCredentials(text(this));
});

Then('it satisfies the gate workflow rules', function () {
  assertGate(text(this));
});

Then('it satisfies the live workflow rules', function () {
  assertLive(text(this));
});

const LIVE_BREAKS: Record<string, (yaml: string) => string> = {
  'triggered by pull_request': (yaml) => yaml.replace(/^on:\n/m, 'on:\n  pull_request:\n'),
  'pushed from another branch': (yaml) => yaml.replace('      - main\n', '      - main\n      - feat/x\n'),
  'without its environment': (yaml) => yaml.replace('    environment: broker-live\n', ''),
  'without its main-only condition': (yaml) => yaml.replace("    if: github.ref == 'refs/heads/main'\n", ''),
  'with broader permissions': (yaml) => yaml.replace('  contents: read\n', '  contents: write\n'),
  'with the secret in a run line': (yaml) =>
    yaml.replace('run: npm run broker:live', () => `run: echo "${LIVE_SECRET}" && npm run broker:live`),
  'with another secret': (yaml) =>
    yaml.replace(`ANTHROPIC_TEST_KEY: ${LIVE_SECRET}\n`, () => {
      return `ANTHROPIC_TEST_KEY: ${LIVE_SECRET}\n          OTHER: ${LIVE_SECRET.replace('ANTHROPIC_TEST_KEY', 'OTHER')}\n`;
    }),
};

Then('a live workflow {} is rejected', function (kind: string) {
  const breakIt = LIVE_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken live workflow named "${kind}"`);
  const broken = breakIt(text(this));
  assert.notEqual(broken, text(this));
  assert.throws(() => assertLive(broken));
});

Then('no other workflow names the environment or the secret of broker-live', function () {
  const dir = join(ROOT, '.github/workflows');
  const others = readdirSync(dir).filter(
    (file) =>
      file !== 'broker-live.yml' &&
      /\b(broker-live|ANTHROPIC_TEST_KEY)\b/.test(readFileSync(join(dir, file), 'utf8')),
  );
  assert.deepEqual(others, []);
});

Then('a workflow with an unpinned action is rejected', function () {
  const broken = text(this).replace(/(actions\/checkout)@[0-9a-f]{40}/, '$1@v6');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertPinned(broken));
});

Then('a workflow with an npm ci without --ignore-scripts is rejected', function () {
  const broken = text(this).replace('npm ci --ignore-scripts', 'npm ci');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertNpmCiSafe(broken));
});

Then('a workflow with a checkout that keeps its credentials is rejected', function () {
  const broken = text(this).replace('persist-credentials: false', 'persist-credentials: true');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertCheckoutWithoutCredentials(broken));
});

Then('a gate workflow triggered by pull_request_target is rejected', function () {
  const broken = text(this).replace(/^ {2}pull_request:$/m, '  pull_request_target:');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});

Then('a gate workflow that uses a secret is rejected', function () {
  const broken = text(this).replace('${{ github.token }}', '${{ secrets.GITHUB_TOKEN }}');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});

Then('a gate workflow with a cache is rejected', function () {
  const broken = text(this).replace(
    'node-version-file: .nvmrc',
    'node-version-file: .nvmrc\n          cache: npm',
  );
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});

Then('a gate workflow with broader permissions is rejected', function () {
  const broken = text(this).replace('  actions: read\n', '  actions: write\n');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});
