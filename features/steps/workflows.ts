import assert from 'node:assert/strict';
import type { DataTable } from '@cucumber/cucumber';
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
  id: z.string().optional(),
  name: z.string().optional(),
  if: z.string().optional(),
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
      needs: z.union([z.string(), z.array(z.string())]).optional(),
      if: z.string().optional(),
      environment: z.string().optional(),
      strategy: z.unknown().optional(),
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
  assert.deepEqual(Object.keys(doc.jobs).sort(), [
    'gate-linux',
    'gate-linux-cucumber',
    'gate-linux-mutation',
    'gate-linux-replay',
    'gate-macos',
  ]);
  assert.deepEqual(doc.jobs['gate-linux']?.needs, [
    'gate-linux-cucumber',
    'gate-linux-mutation',
    'gate-linux-replay',
  ]);
  assert.equal(doc.jobs['gate-linux-replay']?.needs, 'gate-linux-mutation');
  for (const id of ['gate-linux-cucumber', 'gate-linux-mutation', 'gate-linux-replay'])
    assert.deepEqual(doc.jobs[id]?.strategy, { 'fail-fast': false, matrix: { shard: [1, 2] } });
  assert.equal(doc.jobs['gate-linux']?.if, '${{ always() }}');
  const linuxSteps = doc.jobs['gate-linux']?.steps ?? [];
  assert.equal(linuxSteps[0]?.id, 'admission');
  assert.equal(linuxSteps[0]?.name, 'Require all producers');
  assert.equal(
    linuxSteps.find(({ name }) => name === 'Upload reports')?.if,
    '$' + "{{ always() && steps.admission.outcome == 'success' }}",
  );
  for (const [id, job] of Object.entries(doc.jobs))
    assert.equal(
      job.name,
      id === 'gate-linux-cucumber' || id === 'gate-linux-mutation' || id === 'gate-linux-replay'
        ? id + '-${{ matrix.shard }}'
        : id,
    );
  for (const step of Object.values(doc.jobs).flatMap((job) => job.steps)) {
    assert.ok(!('cache' in (step.with ?? {})), 'gate.yml must not use a cache');
    if (step.uses?.startsWith('actions/checkout@') === true) {
      assert.equal(step.with?.['fetch-depth'], 2, 'checkout with fetch-depth: 2');
    }
  }
}

/** The environment that holds the test key of T-04R, and its one secret (docs/infrastructure.md, Secrets broker). */
/** A workflow that may ask GitHub for the identity token of a run. */
const ASKS_IDENTITY = /\bid-token\b/;

/** What exchanges an identity token at Anthropic, or names the owner's federation rule. */
const EXCHANGES =
  /ACTIONS_ID_TOKEN_REQUEST|ANTHROPIC_(FEDERATION_RULE|ORGANIZATION|SERVICE_ACCOUNT|WORKSPACE)_ID|\/v1\/oauth\/token/;

/**
 * The four identifiers of the owner's rule. They give no access by themselves, but the log of a run is public and
 * GitHub prints the environment of a step: the secret store is where a value is masked (platform-v3-srt.md, §2).
 */
const RULE_IDENTIFIERS = [
  'secrets.ANTHROPIC_FEDERATION_RULE_ID',
  'secrets.ANTHROPIC_ORGANIZATION_ID',
  'secrets.ANTHROPIC_SERVICE_ACCOUNT_ID',
  'secrets.ANTHROPIC_WORKSPACE_ID',
];

/** A GitHub expression, and what is between its braces. */
const EXPRESSION = /\$\{\{(.*?)\}\}/g;

/**
 * broker-live.yml: the only workflow that reaches the real upstream. It stores no credential: it exchanges the
 * identity token of its run (`id-token: write`, the only permission beside `contents: read`) for a short-lived access
 * token. It runs on main only (push, schedule, dispatch; never a pull request) and names no environment: the owner's
 * rule accepts the subject of a run on refs/heads/main, and an environment would change that subject. Its expressions
 * are the four identifiers of the rule, once each, in the environment of a step and never in a command: any other
 * expression (a repository variable, which the log prints; another secret; another context) is refused.
 */
function assertLive(text: string): void {
  const doc = workflow(text);
  assert.ok(typeof doc.on === 'object' && !Array.isArray(doc.on), 'on is a mapping');
  for (const trigger of Object.keys(doc.on)) {
    assert.ok(['push', 'schedule', 'workflow_dispatch'].includes(trigger), `trigger refused: ${trigger}`);
  }
  assert.deepEqual((doc.on['push'] as { branches?: unknown } | undefined)?.branches, ['main']);
  assert.deepEqual(doc.permissions, { contents: 'read', 'id-token': 'write' });
  assert.deepEqual(Object.keys(doc.jobs), ['broker-live']);
  const job = doc.jobs['broker-live'];
  assert.equal(job?.environment, undefined, 'an environment changes the subject of the identity token');
  assert.equal(job?.if, "github.ref == 'refs/heads/main'");
  const expressions = [...text.matchAll(EXPRESSION)].map((match) => (match[1] ?? '').trim());
  assert.deepEqual(
    expressions.sort(),
    RULE_IDENTIFIERS,
    'the expressions are the four identifiers of the rule',
  );
  assert.ok(
    !/\b(secrets|vars)\b/.test(text.replace(EXPRESSION, '')),
    'a secret or a variable outside an expression',
  );
  for (const step of job?.steps ?? []) {
    assert.ok(!/\bset -[a-z]*x|\bxtrace\b/.test(step.run ?? ''), 'a traced run line would print a token');
    assert.ok(!(step.run ?? '').includes('${{'), 'an expression in a command is printed with the command');
  }
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
  'with an environment': (yaml) =>
    yaml.replace('    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    environment: broker-live\n'),
  'without its main-only condition': (yaml) => yaml.replace("    if: github.ref == 'refs/heads/main'\n", ''),
  'with broader permissions': (yaml) => yaml.replace('  contents: read\n', '  contents: write\n'),
  'with one more permission': (yaml) =>
    yaml.replace('  id-token: write\n', '  id-token: write\n  actions: read\n'),
  'with a stored secret': (yaml) =>
    yaml.replace(
      'run: npm run broker:live',
      () => 'run: echo "${{ secrets.ANTHROPIC_TEST_KEY }}" && npm run broker:live',
    ),
  'with a traced run line': (yaml) =>
    yaml.replace('          set -euo pipefail\n', '          set -euxo pipefail\n'),
  'with an identifier read from a repository variable': (yaml) =>
    yaml.replace('${{ secrets.ANTHROPIC_WORKSPACE_ID }}', () => '${{ vars.ANTHROPIC_WORKSPACE_ID }}'),
  'with an identifier written into a command': (yaml) =>
    yaml
      .replace('          WORKSPACE_ID: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}\n', '')
      .replace(
        '--arg workspace "$WORKSPACE_ID"',
        () => '--arg workspace "${{ secrets.ANTHROPIC_WORKSPACE_ID }}"',
      ),
  'with another context in an expression': (yaml) =>
    yaml.replace(
      '          WORKSPACE_ID: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}\n',
      () =>
        '          WORKSPACE_ID: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}\n          ACTOR: ${{ github.actor }}\n',
    ),
  'with an identifier named twice': (yaml) =>
    yaml.replace(
      '          WORKSPACE_ID: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}\n',
      () =>
        '          WORKSPACE_ID: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}\n          COPY: ${{ secrets.ANTHROPIC_WORKSPACE_ID }}\n',
    ),
};

Then('a live workflow {} is rejected', function (kind: string) {
  const breakIt = LIVE_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken live workflow named "${kind}"`);
  const broken = breakIt(text(this));
  assert.notEqual(broken, text(this));
  assert.throws(() => assertLive(broken));
});

const workflowFiles = (): { file: string; text: string }[] => {
  const dir = join(ROOT, '.github/workflows');
  return readdirSync(dir).map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
};

Then('the workflows that ask for the identity token of a run are exactly:', function (table: DataTable) {
  const asking = workflowFiles()
    .filter(({ text }) => ASKS_IDENTITY.test(text))
    .map(({ file }) => file);
  assert.deepEqual(asking.sort(), table.raw().flat().sort());
});

Then('no other workflow exchanges an identity token at Anthropic or names the federation rule', function () {
  const others = workflowFiles()
    .filter(({ file, text }) => file !== 'broker-live.yml' && EXCHANGES.test(text))
    .map(({ file }) => file);
  assert.deepEqual(others, []);
});

Then('a line that exchanges an identity token or names the rule is seen: {}', function (line: string) {
  assert.equal(EXCHANGES.test(line), true);
});

Then('a line that does neither is not seen: {}', function (line: string) {
  assert.equal(EXCHANGES.test(line), false);
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
