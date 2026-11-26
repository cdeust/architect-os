import assert from 'node:assert/strict';
import type { DataTable } from '@cucumber/cucumber';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { basename, dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
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
    z
      .object({
        name: z.string().optional(),
        needs: z.union([z.string(), z.array(z.string())]).optional(),
        if: z.string().optional(),
        environment: z.string().optional(),
        permissions: z.unknown().optional(),
        secrets: z.unknown().optional(),
        strategy: z.unknown().optional(),
        outputs: z.record(z.string(), z.string()).optional(),
        uses: z.string().optional(),
        with: z.record(z.string(), z.unknown()).optional(),
        'runs-on': z.unknown().optional(),
        steps: z.array(StepSchema).optional(),
      })
      .refine((job) => (job.uses === undefined) !== (job.steps === undefined))
      .transform((job) => ({ ...job, steps: job.steps ?? [] })),
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
  for (const { uses } of Object.values(workflow(text).jobs)) {
    if (uses !== undefined) assert.equal(uses, './.github/workflows/gate-lane.yml');
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

/**
 * The two entries of the gate, and the triggers of each (docs/infrastructure.md, "The two entries of the gate").
 * gate.yml is the pull-request entry: `pull_request` alone, without a filter, so that every run of it has the number
 * of a pull request. gate-push.yml is the push entry: `main` and the trial branches of the delivery, nothing else.
 */
export const GATE_ENTRIES: Record<string, (on: Record<string, unknown>, file: string) => void> = {
  'gate.yml': (on, file) => {
    assert.ok(
      isDeepStrictEqual(Object.keys(on), ['pull_request']),
      `${file} is triggered by pull_request alone`,
    );
    assert.ok(
      on['pull_request'] === null || isDeepStrictEqual(on['pull_request'], {}),
      `the pull_request trigger of ${file} has no filter`,
    );
  },
  'gate-push.yml': (on, file) => {
    assert.ok(
      isDeepStrictEqual(on, { push: { branches: ['main', 'sentinel/gate-1a-*'] } }),
      `${file} is triggered by a push to main or to a trial branch alone`,
    );
  },
};

function assertGate(text: string, file: string): void {
  const doc = workflow(text);
  assert.ok(typeof doc.on === 'object' && !Array.isArray(doc.on), 'on is a mapping');
  const triggers = GATE_ENTRIES[file];
  assert.ok(triggers !== undefined, `${file} is not an entry of the gate`);
  triggers(doc.on, file);
  assert.deepEqual(doc.permissions, { contents: 'read', actions: 'read' });
  assert.ok(!text.includes('secrets.'), `${file} must not use a secret`);
  assert.deepEqual(Object.keys(doc.jobs).sort(), [
    'gate-linux',
    'gate-linux-cucumber',
    'gate-linux-lane',
    'gate-linux-plan',
    'gate-macos',
  ]);
  const judge = doc.jobs['gate-linux'];
  assert.deepEqual(judge?.needs, ['gate-linux-cucumber', 'gate-linux-plan', 'gate-linux-lane']);
  // The plan job announces the lanes; nothing may skip it, and nothing may let it fail unseen.
  const plan = doc.jobs['gate-linux-plan'];
  const announced = '${{ needs.gate-linux-plan.outputs.lanes }}';
  assert.equal(plan?.if, undefined);
  assert.equal(plan?.needs, undefined);
  assert.equal(plan?.['runs-on'], 'ubuntu-24.04');
  assert.deepEqual(plan?.outputs, { lanes: '${{ steps.plan.outputs.lanes }}' });
  assert.ok(!text.includes('continue-on-error'), `${file} must not let a job or a step fail unseen`);
  const planSteps = plan?.steps ?? [];
  assert.equal(planSteps.at(-1)?.id, 'plan');
  assert.equal(
    planSteps.at(-2)?.run,
    'sh tools/runtime/gate-job.sh -- node --import tsx tools/test-gate/src/hosted.ts lanes',
  );
  assert.equal(
    planSteps.at(-1)?.run,
    'sh tools/runtime/gate-job.sh -- node tools/test-gate/report-files.mjs announce',
  );
  for (const step of planSteps) assert.equal(step.if, undefined);
  assert.equal(planSteps.filter(({ id }) => id === 'plan').length, 1);
  // No expression is written into a command: what a job announces reaches a step through its environment.
  for (const job of Object.values(doc.jobs))
    for (const { run } of job.steps)
      assert.ok(!(run ?? '').includes('${{'), `${file}: expression in a command`);
  assert.deepEqual(doc.jobs['gate-linux-cucumber']?.strategy, {
    'fail-fast': false,
    matrix: { shard: [1, 2] },
  });
  const lane = doc.jobs['gate-linux-lane'];
  // The lanes are the plan, never a list of the workflow: no lane starts that the plan does not hold.
  assert.equal(lane?.needs, 'gate-linux-plan');
  assert.equal(lane?.if, undefined);
  assert.deepEqual(lane?.strategy, {
    'fail-fast': false,
    matrix: { lane: '${{ fromJSON(needs.gate-linux-plan.outputs.lanes) }}' },
  });
  assert.equal(lane?.uses, './.github/workflows/gate-lane.yml');
  assert.deepEqual(lane?.with, { lane: '${{ matrix.lane }}' });
  assert.equal(doc.jobs['gate-linux']?.if, '${{ always() }}');
  const linuxSteps = doc.jobs['gate-linux']?.steps ?? [];
  assert.equal(linuxSteps[0]?.id, 'admission');
  assert.equal(linuxSteps[0]?.name, 'Require all producers');
  assert.deepEqual(linuxSteps[0]?.env, {
    CUCUMBER_RESULT: '${{ needs.gate-linux-cucumber.result }}',
    PLAN_RESULT: '${{ needs.gate-linux-plan.result }}',
    LANES_RESULT: '${{ needs.gate-linux-lane.result }}',
  });
  assert.equal(
    linuxSteps[0]?.run,
    'test "$CUCUMBER_RESULT" = success && test "$PLAN_RESULT" = success && test "$LANES_RESULT" = success',
  );
  assert.equal(linuxSteps[0]?.if, undefined);
  // The judge derives the plan from its own checkout before it downloads, and judges on that plan alone.
  const hosted = 'sh tools/runtime/gate-job.sh -- node --import tsx tools/test-gate/src/hosted.ts ';
  const at = (name: string) => linuxSteps.findIndex((step) => step.name === name);
  const derive = at('Derive the mutation plan again from this checkout');
  const fetch = at('Fetch reports from the effective producer jobs');
  const collect = at('Verify and collect independent replay lots');
  const verdict = at('Gate');
  assert.ok(
    0 < derive && derive < fetch && fetch < collect && collect < verdict,
    `${file}: order of the judge`,
  );
  assert.equal(linuxSteps[derive]?.run, hosted + 'lanes');
  assert.equal(linuxSteps[collect]?.run, hosted + 'collect "$AOS_ANNOUNCED_LANES"');
  assert.equal(linuxSteps[collect]?.env?.['AOS_ANNOUNCED_LANES'], announced);
  for (const index of [derive, fetch, collect, verdict]) assert.equal(linuxSteps[index]?.if, undefined);
  assert.equal(linuxSteps.filter(({ run }) => (run ?? '').startsWith(hosted)).length, 2);
  assert.equal(
    linuxSteps.find(({ name }) => name === 'Upload reports')?.if,
    '$' + "{{ always() && steps.admission.outcome == 'success' && steps.exports.outcome == 'success' }}",
  );
  for (const [id, job] of Object.entries(doc.jobs)) {
    assert.equal(job.permissions, undefined);
    assert.equal(job.secrets, undefined);
    assert.equal(
      job.name,
      id === 'gate-linux-cucumber'
        ? id + '-${{ matrix.shard }}'
        : id === 'gate-linux-lane'
          ? id + '-${{ matrix.lane }}'
          : id,
    );
  }
  for (const step of Object.values(doc.jobs).flatMap((job) => job.steps)) {
    assert.ok(!('cache' in (step.with ?? {})), `${file} must not use a cache`);
    if (step.uses?.startsWith('actions/checkout@') === true) {
      assert.equal(step.with?.['fetch-depth'], 2, 'checkout with fetch-depth: 2');
    }
  }
}

function assertGateLane(text: string): void {
  const doc = workflow(text);
  assert.deepEqual(doc.on, { workflow_call: { inputs: { lane: { type: 'number', required: true } } } });
  assert.deepEqual(doc.permissions, { contents: 'read', actions: 'read' });
  assert.ok(!text.includes('secrets.'));
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['mutation', 'replay']);
  assert.equal(doc.jobs['mutation']?.needs, undefined);
  assert.equal(doc.jobs['replay']?.needs, 'mutation');
  assertPinned(text);
  assertNpmCiSafe(text);
  assertCheckoutWithoutCredentials(text);
  for (const [id, job] of Object.entries(doc.jobs)) {
    assert.equal(job.permissions, undefined);
    assert.equal(job.secrets, undefined);
    assert.equal(job.name, id);
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    for (const step of job.steps) {
      assert.ok(!('cache' in (step.with ?? {})));
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with?.['fetch-depth'], 2);
    }
  }
}

Then('it satisfies the native lane workflow rules', function () {
  assertGateLane(text(this));
});

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

/** The file name of the loaded workflow: what tells one entry of the gate from the other. */
const file = (world: Parameters<typeof stored>[0]): string =>
  basename(stored<Loaded>(world, 'workflow').path);

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
  assertGate(text(this), file(this));
});

Then('Gate jobs reject explicit secrets and permissions', function () {
  const original = text(this);
  const entry = file(this);
  const verify = original.includes('workflow_call:')
    ? assertGateLane
    : (source: string) => assertGate(source, entry);
  for (const setting of ['secrets: inherit', 'permissions: write-all']) {
    const edited = original.replace(/^(    name: .+)$/m, '$1\n    ' + setting);
    assert.notEqual(edited, original);
    assert.throws(() => verify(edited));
  }
});

Then('a gate workflow that starts or judges lanes outside the plan it derives is rejected', function () {
  const original = text(this);
  const file = stored<Loaded>(this, 'workflow').path.split('/').at(-1) as string;
  assertGate(original, file);
  const edits: [string, string][] = [
    ['lane: ${{ fromJSON(needs.gate-linux-plan.outputs.lanes) }}', 'lane: [1, 2, 3]'],
    ['lane: ${{ fromJSON(needs.gate-linux-plan.outputs.lanes) }}', "lane: ${{ fromJSON('[1]') }}"],
    ['    needs: gate-linux-plan\n', ''],
    [
      'needs: [gate-linux-cucumber, gate-linux-plan, gate-linux-lane]',
      'needs: [gate-linux-cucumber, gate-linux-lane]',
    ],
    [' && test "$PLAN_RESULT" = success', ''],
    [' && test "$LANES_RESULT" = success', ''],
    ['test "$PLAN_RESULT" = success', 'test "$PLAN_RESULT" != failure'],
    ['PLAN_RESULT: ${{ needs.gate-linux-plan.result }}', 'PLAN_RESULT: success'],
    [
      'LANES_RESULT: ${{ needs.gate-linux-lane.result }}',
      'LANES_RESULT: ${{ needs.gate-linux-plan.result }}',
    ],
    ['hosted.ts collect "$AOS_ANNOUNCED_LANES"', 'hosted.ts collect'],
    [
      'hosted.ts collect "$AOS_ANNOUNCED_LANES"',
      'hosted.ts collect "${{ needs.gate-linux-plan.outputs.lanes }}"',
    ],
    ['AOS_ANNOUNCED_LANES: ${{ needs.gate-linux-plan.outputs.lanes }}', "AOS_ANNOUNCED_LANES: '[1]'"],
    ['      lanes: ${{ steps.plan.outputs.lanes }}', "      lanes: '[1]'"],
    ['node tools/test-gate/report-files.mjs announce', 'echo "lanes=[1]" >> "$GITHUB_OUTPUT"'],
    ['    if: ${{ always() }}', "    if: ${{ needs.gate-linux-plan.result == 'success' }}"],
    ['    name: gate-linux-plan\n', '    name: gate-linux-plan\n    continue-on-error: true\n'],
    ['    name: gate-linux-plan\n', "    name: gate-linux-plan\n    if: github.event_name == 'push'\n"],
    [
      '      - name: Derive the mutation plan again from this checkout\n',
      '      - name: Take the announced plan\n',
    ],
  ];
  for (const [from, to] of edits) {
    const edited = original.replace(from, to);
    assert.notEqual(edited, original, from);
    assert.throws(() => assertGate(edited, file), from + ' -> ' + to);
  }
  // The judge that derives its plan after the download would download what a producer announced.
  const derive = original.slice(
    original.indexOf('      - name: Derive the mutation plan again from this checkout'),
    original.indexOf('      - name: Fetch reports from the effective producer jobs'),
  );
  const moved = original
    .replace(derive, '')
    .replace('      - name: Bind the Gate plan', derive + '      - name: Bind the Gate plan');
  assert.notEqual(moved, original);
  assert.throws(() => assertGate(moved, file));
});

Then(
  'its Linux admission step, given the results {string}, {string} and {string}, exits {string}',
  function (cucumber: string, plan: string, lanes: string, outcome: string) {
    const step = workflow(text(this)).jobs['gate-linux']?.steps[0];
    assert.equal(step?.id, 'admission');
    const result = spawnSync('/bin/sh', ['-e', '-c', step?.run as string], {
      env: { PATH: '/usr/bin:/bin', CUCUMBER_RESULT: cucumber, PLAN_RESULT: plan, LANES_RESULT: lanes },
      encoding: 'utf8',
    });
    assert.equal(result.status === 0 ? 'green' : 'red', outcome, result.stderr);
  },
);

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
      'run: ./aos -- npm run broker:live',
      () => 'run: echo "${{ secrets.ANTHROPIC_TEST_KEY }}" && ./aos -- npm run broker:live',
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
  assert.throws(() => assertGate(broken, file(this)));
});

const PUSH_ENTRY_BREAKS: Record<string, (yaml: string) => string> = {
  'triggered by pull_request too': (yaml) => yaml.replace(/^on:\n/m, 'on:\n  pull_request:\n'),
  'triggered by pull_request_target': (yaml) => yaml.replace(/^on:\n/m, 'on:\n  pull_request_target:\n'),
  'triggered by workflow_dispatch too': (yaml) => yaml.replace(/^on:\n/m, 'on:\n  workflow_dispatch:\n'),
  'pushed from every branch': (yaml) => yaml.replace(/^ {2}push:\n(?: {4,}.*\n)+/m, '  push:\n'),
  'pushed from another branch': (yaml) => yaml.replace('      - main\n', '      - main\n      - feat/x\n'),
  'without the trial branches of the delivery': (yaml) => yaml.replace('      - sentinel/gate-1a-*\n', ''),
  'without main': (yaml) => yaml.replace('      - main\n', ''),
};

Then('a push entry of the gate {} is rejected', function (kind: string) {
  const breakIt = PUSH_ENTRY_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken push entry named "${kind}"`);
  const broken = breakIt(text(this));
  assert.notEqual(broken, text(this));
  // The broken copy still loads as a workflow: it is refused by the rule of the entry, not by its syntax.
  workflow(broken);
  assert.throws(
    () => assertGate(broken, file(this)),
    /is triggered by a push to main or to a trial branch alone/,
  );
});

Then('a gate workflow that uses a secret is rejected', function () {
  const broken = text(this).replace('${{ github.token }}', '${{ secrets.GITHUB_TOKEN }}');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken, file(this)));
});

Then('a gate workflow with a cache is rejected', function () {
  const broken = text(this).replace(
    'node-version-file: .nvmrc',
    'node-version-file: .nvmrc\n          cache: npm',
  );
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken, file(this)));
});

Then('a gate workflow with broader permissions is rejected', function () {
  const broken = text(this).replace('  actions: read\n', '  actions: write\n');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken, file(this)));
});

const provision = 'sh "$GITHUB_WORKSPACE/tools/runtime/provision-hosted.sh"';

function assertHostedAdmission(source: string, file: string): void {
  for (const [id, job] of Object.entries(workflow(source).jobs)) {
    if (job.uses) continue; // The called workflow has its own runner and provisioning check.
    const list = job.steps;
    const checkout = list.findIndex((step) => step.uses?.startsWith('actions/checkout@'));
    const setup = list.findIndex((step) => step.uses?.startsWith('actions/setup-node@'));
    assert.ok(checkout >= 0 && setup > checkout + 1, id);
    assert.deepEqual(list[checkout + 1], { name: 'Provision the job runtime root', run: provision });
    assert.equal(list.filter((step) => step.run === provision).length, 1, id);
    assert.ok(
      list.every((step) => !step.uses?.startsWith('actions/cache@') && !('cache' in (step.with ?? {}))),
    );
    if (file !== 'bench-sandbox.yml') assert.equal(list[setup]?.with?.['package-manager-cache'], false, id);
    const isGate = ['gate.yml', 'gate-push.yml', 'gate-lane.yml', 'mutation-full.yml'].includes(file);
    const capture = './aos -- node tools/runtime/gate-job.mjs capture';
    const entry = isGate
      ? 'sh tools/runtime/gate-job.sh -- '
      : file === 'bench-sandbox.yml'
        ? '../aos -- '
        : './aos -- ';
    if (isGate) {
      assert.equal(list.filter((step) => step.id === 'runtime' && step.run === capture).length, 1, id);
      for (const step of list.filter((step) => step.uses?.startsWith('actions/upload-artifact@'))) {
        const paths = String(step.with?.path).trimEnd().split('\n');
        assert.ok(
          paths.every((path) => path.startsWith('${{ steps.exports.outputs.reports }}/')),
          id,
        );
      }
    }
    const commands = list.flatMap(({ run }) => (run ? [run.trimEnd()] : []));
    const packages = commands.filter((cmd) => /(?:^|[\s;&|])(?:npm|npx|node)(?=\s)/m.test(cmd));
    assert.ok(packages.length > 0, id);
    for (const cmd of packages) {
      assert.ok(list.findIndex((step) => step.run?.trimEnd() === cmd) > setup, cmd);
      if (isGate && cmd === capture) continue;
      if (isGate)
        assert.equal(
          list.find((step) => step.run?.trimEnd() === cmd)?.env?.AOS_GATE_CONTEXT_SHA,
          '${{ steps.runtime.outputs.context_sha }}',
        );
      assert.ok(cmd.startsWith(entry), cmd);
      if (isGate)
        assert.ok(
          list.findIndex((step) => step.run?.trimEnd() === cmd) >
            list.findIndex((step) => step.id === 'runtime'),
        );
      const lock = '/usr/bin/python3 -I tools/test-gate/with-tree-lock.py exec ';
      const invocation = cmd.slice(entry.length);
      const candidate =
        isGate && (invocation.includes('bash -e -o pipefail') || invocation.endsWith('npx stryker run'));
      if (candidate) assert.ok(invocation.startsWith(lock), cmd);
      const guard = '/usr/bin/python3 -I tools/test-gate/with-tree-lock.py candidate ';
      let payload = candidate ? invocation.slice(lock.length) : invocation;
      if (candidate) {
        for (const line of payload
          .split('\n')
          .filter((line) => /\b(tsc -b|cucumber-js --shard|stryker run)\b/.test(line)))
          assert.ok(line.includes(guard), line);
        if (payload.startsWith(guard)) payload = payload.slice(guard.length);
      }
      if (payload.startsWith("bash -e -o pipefail <<'ADMITTED'\n")) {
        assert.equal(payload.split('\n').indexOf('ADMITTED'), payload.split('\n').length - 1, cmd);
      } else {
        assert.match(payload, /^(?:npm|npx|node) [^\n;&|\x60<>]+$/, cmd);
      }
    }
    if (id === 'advisories') assert.deepEqual(packages, [entry + 'npm audit --audit-level=moderate']);
  }
}

Then('each hosted package job provisions its root before setup and admits its project commands', function () {
  const loaded = stored<Loaded>(this, 'workflow');
  assertHostedAdmission(loaded.text, loaded.path.split('/').at(-1) ?? '');
});

Then('a copy with {string} is refused by hosted admission policy', function (fault: string) {
  const { text: source, path } = stored<Loaded>(this, 'workflow');
  const doc = parse(source);
  const job = Object.values(doc.jobs).find((item) => {
    const steps = (item as { steps?: { run?: string }[] }).steps;
    return steps?.some((step) => step.run?.includes('npm audit'));
  }) as { steps: { run?: string; uses?: string; with?: Record<string, unknown> }[] };
  const steps = job.steps;
  const marked = steps.findIndex((step) => step.run === provision);
  const audit = steps.find((step) => step.run?.includes('npm audit'));
  const setup = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(marked >= 0 && audit?.run && setup?.with);
  switch (fault) {
    case 'a late marker':
      [steps[marked], steps[marked + 1]] = [steps[marked + 1]!, steps[marked]!];
      break;
    case 'a bare audit':
      audit.run = 'npm audit --audit-level=moderate';
      break;
    case 'a raised severity':
      audit.run = audit.run.replace('moderate', 'high');
      break;
    case 'a cached setup':
      setup.with['package-manager-cache'] = true;
      break;
    case 'a bare operational Node':
      steps.push({ run: 'node tools/watch/bin/run.ts' });
      break;
    case 'an unguarded npx':
      steps.push({ run: 'npx tsc' });
      break;
    default:
      assert.fail(fault);
  }
  assert.notDeepEqual(doc, parse(source));
  assert.throws(() => assertHostedAdmission(stringify(doc), path.split('/').at(-1) ?? ''));
});

// Stryker loads helpers from the build (stryker.config.mjs): a job that runs it builds first.
function assertBuildBeforeStryker(source: string): void {
  let runs = 0;
  for (const [id, job] of Object.entries(workflow(source).jobs)) {
    const lines = (job.steps ?? []).flatMap((step) => (step.run ? step.run.split('\n') : []));
    const stryker = lines.findIndex((line) => /\bstryker run\b/.test(line));
    if (stryker === -1) continue;
    runs += 1;
    assert.ok(
      lines.slice(0, stryker).some((line) => /\btsc -b\b/.test(line)),
      id + ': stryker run without a build before it',
    );
  }
  assert.ok(runs > 0, 'no stryker run');
}

Then('each Stryker run of the workflow follows a build in its job', function () {
  assertBuildBeforeStryker(text(this));
});

Then('a copy of the workflow without the build before Stryker is refused', function () {
  const broken = text(this)
    .split('\n')
    .filter((line) => !/\btsc -b\b/.test(line))
    .join('\n');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertBuildBeforeStryker(broken), /stryker run without a build before it/);
});

const runnerEnv = (dir: string): Record<string, string> => ({
  PATH: '/usr/bin:/bin',
  RUNNER_TEMP: dir,
  GITHUB_ENV: join(dir, 'job.env'),
});

Then('separate hosted jobs publish only their own private marked root and refuse reuse', function () {
  const session = mkdtempSync(join(tmpdir(), 'aos-hosted-'));
  try {
    for (const name of ['first', 'second']) {
      const dir = realpathSync(mkdtempSync(join(session, name)));
      const env = runnerEnv(dir);
      const script = join(ROOT, 'tools/runtime/provision-hosted.sh');
      const root = join(dir, 'a');
      const marker = join(root, '.architect-os-runtime-root');
      const run = () => spawnSync('/bin/sh', [script], { env, encoding: 'utf8' });
      const first = run();
      assert.equal(first.status, 0, first.stderr);
      assert.equal(readFileSync(env['GITHUB_ENV']!, 'utf8'), 'ARCHITECT_OS_RUNTIME_ROOT=' + root + '\n');
      assert.equal(readFileSync(marker, 'utf8'), 'architect-os-runtime-root/v2\nenvironment=hosted-runner\n');
      assert.equal(statSync(root).mode & 0o777, 0o700);
      assert.equal(statSync(marker).mode & 0o777, 0o600);
      writeFileSync(marker, 'protected');
      assert.notEqual(run().status, 0);
      assert.equal(readFileSync(marker, 'utf8'), 'protected');
      assert.equal(readFileSync(env['GITHUB_ENV']!, 'utf8'), 'ARCHITECT_OS_RUNTIME_ROOT=' + root + '\n');
    }
  } finally {
    rmSync(session, { recursive: true, force: true });
  }
});

Then('two payloads in a hosted job receive distinct matching admission receipts', function () {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-job-')));
  try {
    const env = runnerEnv(dir);
    const provisioned = spawnSync('/bin/sh', [join(ROOT, 'tools/runtime/provision-hosted.sh')], { env });
    assert.equal(provisioned.status, 0, provisioned.stderr.toString());
    const root = readFileSync(join(dir, 'job.env'), 'utf8')
      .trimEnd()
      .slice('ARCHITECT_OS_RUNTIME_ROOT='.length);
    const launch = () => {
      const child = spawnSync(
        join(ROOT, 'aos'),
        ['--', '/bin/sh', '-c', 'printf "%s" "$ARCHITECT_OS_RUN_DIR"'],
        {
          env: { ...env, ARCHITECT_OS_RUNTIME_ROOT: root },
          encoding: 'utf8',
        },
      );
      assert.equal(child.status, 0, child.stderr);
      const location = child.stdout;
      assert.equal(dirname(location), join(root, 'run'));
      const receipt = JSON.parse(readFileSync(join(location, 'admission.json'), 'utf8'));
      assert.equal(receipt.run, basename(location));
      assert.equal(receipt.environment, 'hosted-runner');
      return location;
    };
    const first = launch();
    assert.notEqual(launch(), first);
    assert.equal(JSON.parse(readFileSync(join(first, 'admission.json'), 'utf8')).run, basename(first));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

Then(
  'the broker workflow removes its synthetic credential after {word} exchange',
  function (outcome: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-exchange-')));
    try {
      const list = workflow(text(this)).jobs['broker-live']?.steps ?? [];
      const exchange = list.find((step) => step.name?.startsWith('Access token file'));
      const cleanup = list.find((step) => step.name === 'Remove the access token file');
      assert.equal(cleanup?.if, 'always()');
      assert.ok(exchange?.run && cleanup?.run);
      const env = {
        ...runnerEnv(dir),
        FEDERATION_RULE_ID: 'rule',
        ORGANIZATION_ID: 'org',
        SERVICE_ACCOUNT_ID: 'acct',
        WORKSPACE_ID: 'space',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://offline.invalid/?test',
        OUTCOME: outcome,
      };
      const stub = [
        'curl() {',
        '  if [[ "$*" == *"--data @-"* ]]; then',
        '    cat >/dev/null',
        '    printf \'{"access_token":"fixture-access"}\' > "$RUNNER_TEMP/anthropic-exchange.json"',
        '    [[ "$OUTCOME" == successful ]]',
        '  else',
        '    printf \'{"value":"fixture-identity"}\'',
        '  fi',
        '}',
      ].join('\n');
      const attempt = spawnSync('/bin/bash', ['-c', stub + '\n' + exchange.run], { env, encoding: 'utf8' });
      assert.equal(attempt.status, outcome === 'successful' ? 0 : 1, attempt.stderr);
      const key = join(dir, 'anthropic-test-key');
      const exchangeFile = join(dir, 'anthropic-exchange.json');
      if (outcome === 'successful') {
        assert.equal(readFileSync(key, 'utf8'), 'fixture-access');
        assert.equal(statSync(key).mode & 0o777, 0o600);
        assert.ok(attempt.stdout.includes('::add-mask::fixture-access'));
      } else {
        assert.ok(!existsSync(key));
      }
      assert.ok(!existsSync(exchangeFile));
      const removed = spawnSync('/bin/sh', ['-c', cleanup.run], { env });
      assert.equal(removed.status, 0, removed.stderr.toString());
      assert.ok(!existsSync(key));
      assert.ok(!existsSync(exchangeFile));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

Then('the hosted install leaves the lifecycle witness untouched', function () {
  const job = workflow(text(this)).jobs['watch'];
  const cmd = job?.steps.find((step) => step.run?.includes('npm ci'))?.run;
  assert.equal(cmd, './aos -- npm ci --ignore-scripts');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-install-')));
  try {
    const common = runnerEnv(dir);
    const created = spawnSync('/bin/sh', [join(ROOT, 'tools/runtime/provision-hosted.sh')], { env: common });
    assert.equal(created.status, 0, created.stderr.toString());
    const env = {
      ...common,
      PATH: dirname(process.execPath) + ':' + common['PATH'],
      ARCHITECT_OS_RUNTIME_ROOT: join(dir, 'a'),
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    };
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'install-witness',
        version: '1.0.0',
        scripts: { postinstall: "node -e \"require('node:fs').writeFileSync('installed','yes')\"" },
      }),
    );
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'install-witness',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name: 'install-witness', version: '1.0.0', hasInstallScript: true } },
      }),
    );
    const run = (args: string[]) => spawnSync(join(ROOT, 'aos'), args, { cwd: dir, env, encoding: 'utf8' });
    const install = run(cmd.split(' ').slice(1));
    assert.equal(install.status, 0, install.stderr);
    assert.ok(!existsSync(join(dir, 'installed')));
    const control = run(['--', 'npm', 'ci', '--ignore-scripts=false']);
    assert.equal(control.status, 0, control.stderr);
    assert.equal(readFileSync(join(dir, 'installed'), 'utf8'), 'yes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The destination the gate judges against (tools/test-gate/src/domain/destination.ts): every job that runs the gate
// points it first at the first parent of the commit it judges, the one reference gate.json names, from env.
const RUNS_GATE = /tools\/test-gate\/src\/(main|hosted)\.ts|npm run gate\b/;
const FETCH = /^git update-ref "\$AOS_GATE_DESTINATION" HEAD\^1$/;

export function assertDestinationPointed(source: string): void {
  const gate = JSON.parse(readFileSync(join(ROOT, 'tools/test-gate/gate.json'), 'utf8')) as {
    destination: string;
  };
  let jobs = 0;
  for (const [id, job] of Object.entries(workflow(source).jobs)) {
    const at = job.steps.findIndex((step) => RUNS_GATE.test(step.run ?? ''));
    if (at === -1) continue;
    jobs += 1;
    const fetch = job.steps.findIndex((step) => FETCH.test(step.run ?? ''));
    assert.ok(fetch !== -1 && fetch < at, id + ': the gate runs without its destination pointed before it');
    const reference = job.steps[fetch]!.env?.['AOS_GATE_DESTINATION'];
    assert.equal(reference, gate.destination, id + ': not the reference of gate.json');
  }
  assert.ok(jobs > 0, 'no job runs the gate');
}

Then('every job that runs the gate points the destination of gate.json before it', function () {
  assertDestinationPointed(text(this));
});

Then('a copy of the workflow {word} is refused', function (fault: string) {
  const doc = parse(text(this)) as {
    jobs: Record<string, { steps?: { name?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  const job = Object.values(doc.jobs).find((candidate) =>
    (candidate.steps ?? []).some((step) => RUNS_GATE.test(step.run ?? '')),
  );
  assert.ok(job?.steps);
  const at = job.steps.findIndex((step) => FETCH.test(step.run ?? ''));
  assert.ok(at !== -1);
  const fetch = job.steps[at]!;
  switch (fault) {
    case 'without-the-fetch':
      job.steps.splice(at, 1);
      break;
    case 'with-the-fetch-after-the-gate':
      job.steps.splice(at, 1);
      job.steps.push(fetch);
      break;
    case 'with-the-branch-written-into-the-command':
      fetch.run = 'git update-ref "${{ env.AOS_GATE_DESTINATION }}" HEAD^1';
      break;
    case 'with-the-live-branch-fetched':
      fetch.run = 'git fetch --quiet --no-tags --depth=2 origin "+refs/heads/main:$AOS_GATE_DESTINATION"';
      break;
    case 'with-another-branch':
      fetch.env = { AOS_GATE_DESTINATION: 'refs/remotes/origin/feat/gate-1a' };
      break;
    default:
      assert.fail(fault);
  }
  assert.throws(() => assertDestinationPointed(stringify(doc)));
});
