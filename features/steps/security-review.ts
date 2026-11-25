import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

/**
 * The guards of `.github/workflows/claude-security-review.yml` (docs/infrastructure.md, "The Claude security review"),
 * read from the parsed workflow, never from its text. The schema is strict: a key it does not name (a trigger, a
 * permission, `secrets`, `environment`, `continue-on-error`, `shell`) makes the workflow fail. What holds the guards is
 * the shape of the job around the step `engine`, so another engine changes that step alone.
 * Syntax: https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
 */
const REVIEW_DIR = '.github/claude-security-review';
const CONFIG_PATH = 'review-config';
const SETTINGS = `${REVIEW_DIR}/managed-settings.json`;
const INSTRUCTIONS = [`${REVIEW_DIR}/scan-instructions.txt`, `${REVIEW_DIR}/false-positive-filtering.txt`];
const PRESENT = "steps.credential.outputs.present == 'true'";
/** The bound of the diff the reviewer reads (operational: 1 MiB). */
const MAX_DIFF_BYTES = 1048576;
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/;
const EXPRESSION = /\$\{\{(.*?)\}\}/g;
const SECRET = /\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g;

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const StepSchema = z.strictObject({
  id: z.string().optional(),
  name: z.string(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), Scalar).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
type Step = z.infer<typeof StepSchema>;
const ReviewSchema = z.strictObject({
  name: z.literal('Claude security review'),
  on: z.strictObject({
    pull_request: z.strictObject({
      types: z.tuple([z.literal('opened'), z.literal('reopened'), z.literal('ready_for_review')]),
    }),
  }),
  permissions: z.strictObject({}),
  concurrency: z.strictObject({
    group: z.literal('claude-security-review-${{ github.event.pull_request.number }}'),
    'cancel-in-progress': z.literal(false),
  }),
  jobs: z.strictObject({
    'security-review': z.strictObject({
      name: z.literal('Claude security review'),
      if: z.string(),
      'runs-on': z.literal('ubuntu-24.04'),
      'timeout-minutes': z.number().int().positive().max(60),
      permissions: z.strictObject({ contents: z.literal('read'), 'pull-requests': z.literal('write') }),
      steps: z.array(StepSchema),
    }),
  }),
});

/** The trust rule of the Claude review: the condition of the budget job of claude-review.yml. */
function trustRule(): string {
  const review = parse(readFileSync(join(ROOT, '.github/workflows/claude-review.yml'), 'utf8')) as {
    jobs: { budget: { if: string } };
  };
  return review.jobs.budget.if;
}

function stepIndex(steps: Step[], label: string, found: (step: Step) => boolean): number {
  const at = steps.findIndex(found);
  assert.ok(at >= 0, `the workflow has no step that ${label}`);
  assert.equal(steps.filter(found).length, 1, `the workflow has more than one step that ${label}`);
  return at;
}

const secretsIn = (value: string): string[] => [...value.matchAll(SECRET)].map((match) => match[1] ?? '');

/** Every string of a parsed document, keys included. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...strings(inner)]);
  }
  return [];
}

export function assertSecurityReview(text: string): void {
  const doc = ReviewSchema.parse(parse(text));
  const job = doc.jobs['security-review'];
  assert.equal(job.if, trustRule(), 'the job keeps the trust rule of claude-review.yml');
  const steps = job.steps;

  for (const step of steps) {
    if (step.uses !== undefined)
      assert.match(step.uses, PINNED, `action not pinned by a 40-hex SHA: ${step.uses}`);
    assert.ok(!(step.run ?? '').includes('${{'), `an expression in a command: ${step.name}`);
  }

  const isCheckout = (step: Step): boolean => step.uses?.startsWith('actions/checkout@') === true;
  const checkouts = steps.flatMap((step, at) => (isCheckout(step) ? [at] : []));
  assert.deepEqual(checkouts, [0, 1], 'two checkouts, first');
  assert.deepEqual(steps[0]?.with, { ref: 'main', 'fetch-depth': 1, 'persist-credentials': false });
  assert.deepEqual(steps[1]?.with, {
    ref: '${{ github.sha }}',
    path: CONFIG_PATH,
    'fetch-depth': 1,
    'persist-credentials': false,
    'sparse-checkout': REVIEW_DIR,
    'sparse-checkout-cone-mode': false,
  });

  const credential = stepIndex(steps, 'looks for the credential', (step) => step.id === 'credential');
  const skipped = stepIndex(
    steps,
    'says the review was skipped',
    (step) =>
      (step.run ?? '').includes('GITHUB_STEP_SUMMARY') &&
      step.if === "steps.credential.outputs.present != 'true'",
  );
  const restrict = stepIndex(steps, 'installs the managed settings', (step) =>
    (step.run ?? '').includes('/etc/claude-code/managed-settings.json'),
  );
  const diff = stepIndex(steps, 'writes the diff', (step) => step.id === 'diff');
  const engine = stepIndex(steps, 'runs the engine', (step) => step.id === 'engine');
  assert.ok(
    credential < skipped && skipped < restrict && restrict < diff && diff < engine,
    'the order of the guards',
  );

  const guard = steps[credential];
  assert.equal(guard?.if, undefined, 'the credential is always looked for');
  const names = Object.values(guard?.env ?? {}).flatMap(secretsIn);
  assert.equal(names.length, 1, 'the guard looks for one secret');
  const [secret] = names;
  assert.deepEqual(guard?.env, { PRESENT: `\${{ secrets.${secret} != '' }}` });

  assert.equal(
    steps[restrict]?.run,
    `sudo install -D -m 0644 -o root -g root ${CONFIG_PATH}/${SETTINGS} /etc/claude-code/managed-settings.json`,
  );
  for (const at of [restrict, diff, engine])
    assert.equal(steps[at]?.if, PRESENT, `${steps[at]?.name} waits for the credential`);

  const diffStep = steps[diff];
  assert.deepEqual(diffStep?.env, {
    GH_TOKEN: '${{ github.token }}',
    PR: '${{ github.event.pull_request.number }}',
    MAX_DIFF_BYTES: String(MAX_DIFF_BYTES),
  });
  for (const line of ['head -c "$MAX_DIFF_BYTES"', '# TRUNCATED', 'review-input/pr.diff']) {
    assert.ok((diffStep?.run ?? '').includes(line), `the diff step lacks: ${line}`);
  }

  const reviewer = steps[engine];
  const inputs = Object.values(reviewer?.with ?? {}).map(String);
  assert.ok(reviewer?.uses !== undefined, 'the engine is an action');
  assert.ok(
    inputs.some((value) => value === `\${{ secrets.${secret} }}`),
    'the engine takes the secret the guard looked for',
  );
  assert.ok(
    inputs.some((value) => value.includes('review-input/pr.diff')),
    'the engine is told where the diff is',
  );
  for (const path of INSTRUCTIONS) {
    assert.ok(existsSync(join(ROOT, path)), `missing ${path}`);
    assert.ok(
      inputs.some((value) => value.includes(`${CONFIG_PATH}/${path}`)),
      `the engine is given ${path}`,
    );
  }

  // Read from the parsed values, so a comment neither counts nor hides anything.
  const values = strings(doc);
  const everySecret = values.flatMap((value) =>
    [...value.matchAll(EXPRESSION)].flatMap((match) => secretsIn(match[1] ?? '')),
  );
  assert.deepEqual(everySecret, [secret, secret], 'one secret, named by the guard and given to the engine');
  for (const value of values) {
    assert.ok(!/\bsecrets\b/.test(value.replace(EXPRESSION, '')), `a secret outside an expression: ${value}`);
  }

  if (reviewer?.uses?.startsWith('anthropics/claude-code-action@') === true) assertClaudeCodeAction(reviewer);
}

/**
 * The engine `anthropics/claude-code-action`, at the pin of claude-review.yml. Agent mode (a prompt, no
 * `track_progress`): it keeps the checkout of main and fetches nothing of the PR (src/modes/agent/index.ts at
 * 4fa93a88); `track_progress` switches to tag mode, which checks out the PR head (src/modes/tag/index.ts). The job's
 * own token replaces the OIDC exchange (src/github/token.ts, `OVERRIDE_GITHUB_TOKEN`).
 */
function assertClaudeCodeAction(engine: Step): void {
  const inputs = engine.with ?? {};
  const pin = parse(readFileSync(join(ROOT, '.github/workflows/claude-review.yml'), 'utf8')) as {
    jobs: { review: { steps: Step[] } };
  };
  const reviewPin = pin.jobs.review.steps.find((step) => step.id === 'review')?.uses;
  assert.equal(engine.uses, reviewPin, 'the engine is the action pinned by claude-review.yml');
  assert.deepEqual(Object.keys(inputs).sort(), [
    'allowed_bots',
    'claude_args',
    'claude_code_oauth_token',
    'github_token',
    'prompt',
  ]);
  assert.equal(inputs['github_token'], '${{ github.token }}');
  const args = String(inputs['claude_args']).trim().split('\n');
  assert.deepEqual(args, [
    '--strict-mcp-config',
    '--allowedTools "mcp__github_inline_comment__create_inline_comment,Read,Grep,Glob"',
    '--model "claude-opus-5-5"',
  ]);
}

Then('it satisfies the security review workflow rules', function () {
  assertSecurityReview(stored<{ text: string }>(this, 'workflow').text);
});

const at = (yaml: string, find: string, replace: string): string => {
  assert.ok(yaml.includes(find), `the committed workflow no longer has: ${find}`);
  return yaml.replace(find, () => replace);
};
const without = (yaml: string, find: string): string => at(yaml, find, '');
const stepBlock = (yaml: string, name: string): string => {
  const start = yaml.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `no step named ${name}`);
  // Up to the next step: the comment lines in between go with it, which changes nothing a parser reads.
  const next = yaml.indexOf('\n      - name: ', start + 1);
  return yaml.slice(start, next < 0 ? yaml.length : next + 1);
};

const REVIEW_BREAKS: Record<string, (yaml: string) => string> = {
  'triggered by pull_request_target': (yaml) => at(yaml, '  pull_request:\n', '  pull_request_target:\n'),
  'with one more trigger': (yaml) => at(yaml, 'on:\n', 'on:\n  workflow_dispatch:\n'),
  'reviewing every push': (yaml) =>
    at(yaml, '[opened, reopened, ready_for_review]', '[opened, synchronize, reopened, ready_for_review]'),
  'that cancels a review in progress': (yaml) =>
    at(yaml, 'cancel-in-progress: false', 'cancel-in-progress: true'),
  'with a permission for the whole workflow': (yaml) => at(yaml, 'permissions: {}', 'permissions: write-all'),
  'without the fork condition': (yaml) =>
    at(yaml, '      github.event.pull_request.head.repo.full_name == github.repository\n', '      true\n'),
  'that runs on drafts': (yaml) => without(yaml, '      && !github.event.pull_request.draft\n'),
  'that runs for Dependabot': (yaml) => without(yaml, "\n      && github.actor != 'dependabot[bot]'"),
  'with broader contents': (yaml) => at(yaml, '      contents: read #', '      contents: write #'),
  'with the identity token': (yaml) =>
    at(yaml, '      pull-requests: write #', '      id-token: write\n      pull-requests: write #'),
  'with an environment': (yaml) =>
    at(yaml, '    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    environment: review\n'),
  'without a timeout': (yaml) => without(yaml, '    timeout-minutes: 30\n'),
  'with an action on a branch': (yaml) =>
    at(yaml, 'claude-code-action@4fa93a88de49bbef68b10eb15aabedf28ca0e1ed', 'claude-code-action@main'),
  'that checks out the head of the PR': (yaml) =>
    at(yaml, '          ref: main\n', '          ref: ${{ github.event.pull_request.head.sha }}\n'),
  'that keeps the checkout credentials': (yaml) =>
    at(yaml, '          persist-credentials: false\n', '          persist-credentials: true\n'),
  'that checks out the review files in cone mode': (yaml) =>
    at(yaml, 'sparse-checkout-cone-mode: false', 'sparse-checkout-cone-mode: true'),
  'that checks out the whole run commit': (yaml) =>
    without(yaml, '          sparse-checkout: .github/claude-security-review\n'),
  'without the credential guard on the engine': (yaml) =>
    at(
      yaml,
      "        id: engine\n        if: steps.credential.outputs.present == 'true'\n",
      '        id: engine\n',
    ),
  'without its skip notice': (yaml) => without(yaml, stepBlock(yaml, 'Say the review was skipped')),
  'without the restriction': (yaml) =>
    without(yaml, stepBlock(yaml, 'Restrict Claude Code to reading the checkout')),
  'with the restriction from the default branch': (yaml) =>
    at(
      yaml,
      ' review-config/.github/claude-security-review/managed-settings.json',
      ' .github/claude-security-review/managed-settings.json',
    ),
  'with the diff after the engine': (yaml) => {
    const block = stepBlock(yaml, 'Write the diff of the pull request');
    return at(
      without(yaml, block),
      '      - name: Report the review\n',
      block + '      - name: Report the review\n',
    );
  },
  'with an event expression in a command': (yaml) =>
    at(
      yaml,
      '          mkdir -p review-input\n',
      '          mkdir -p review-input\n          echo "${{ github.event.pull_request.title }}"\n',
    ),
  'with a secret in the environment of a step': (yaml) =>
    at(
      yaml,
      '          OUTCOME: ${{ steps.engine.outcome }}\n',
      '          OUTCOME: ${{ steps.engine.outcome }}\n          TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n',
    ),
  'with a second secret for the engine': (yaml) =>
    at(
      yaml,
      '          github_token: ${{ github.token }}\n',
      '          github_token: ${{ secrets.GITHUB_TOKEN }}\n',
    ),
  'with a secret for the diff': (yaml) =>
    at(
      yaml,
      '          GH_TOKEN: ${{ github.token }}\n',
      '          GH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n',
    ),
  'without the bound of the diff': (yaml) =>
    at(yaml, "MAX_DIFF_BYTES: '1048576'", "MAX_DIFF_BYTES: '999999999999'"),
  'without the cut of a long diff': (yaml) =>
    at(
      yaml,
      '              head -c "$MAX_DIFF_BYTES" review-input/whole.diff\n',
      '              cat review-input/whole.diff\n',
    ),
  'with a step that may fail silently': (yaml) =>
    at(yaml, '        id: diff\n', '        id: diff\n        continue-on-error: true\n'),
  'that tracks progress': (yaml) =>
    at(yaml, '          allowed_bots: ', '          track_progress: true\n          allowed_bots: '),
  'that prints the full output': (yaml) =>
    at(yaml, '          allowed_bots: ', '          show_full_output: true\n          allowed_bots: '),
  'that allows Bash': (yaml) =>
    at(
      yaml,
      'create_inline_comment,Read,Grep,Glob',
      'create_inline_comment,Read,Grep,Glob,Bash(gh pr comment:*)',
    ),
  'that loads other MCP servers': (yaml) => without(yaml, '            --strict-mcp-config\n'),
};

Then('a security review workflow {} is rejected', function (kind: string) {
  const breakIt = REVIEW_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken security review workflow named "${kind}"`);
  const original = stored<{ text: string }>(this, 'workflow').text;
  const broken = breakIt(original);
  assert.notEqual(broken, original);
  assert.throws(() => assertSecurityReview(broken));
});

Then('neither the merge resolver nor the ruleset of main names the security review', function () {
  const resolver = readFileSync(join(ROOT, '.github/workflows/pipeline-after-merge.yml'), 'utf8');
  const on = (parse(resolver) as { on: { workflow_run: { workflows: string[] } } }).on;
  assert.ok(
    !on.workflow_run.workflows.includes('Claude security review'),
    'the resolver wakes on the review',
  );
  assert.ok(!/claude-security-review|Claude security review/.test(resolver), 'the resolver reads the review');
  const ruleset = JSON.parse(readFileSync(join(ROOT, 'docs/design/ruleset-main.json'), 'utf8')) as {
    rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[];
  };
  const required = ruleset.rules.flatMap((rule) => rule.parameters?.required_status_checks ?? []);
  assert.deepEqual(
    required.map(({ context }) => context),
    ['gate-linux', 'gate-macos'],
  );
});

Then('the merge resolver reads a verdict only from a comment of claude[bot]', function () {
  const resolver = readFileSync(join(ROOT, '.github/workflows/pipeline-after-merge.yml'), 'utf8');
  assert.ok(resolver.includes(`if user.get("login") != "claude[bot]" or user.get("type") != "Bot":\n`));
});

/**
 * The managed settings Claude Code reads above every other source on Linux (code.claude.com/docs/en/managed-settings,
 * "/etc/claude-code/managed-settings.json"): the keys and their values are those of code.claude.com/docs/en/settings
 * and /permissions. Strict: an `allow`, an `env`, an `apiKeyHelper` or a hook makes the file fail.
 */
const DENIED = ['Bash', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'NotebookEdit', 'Read(.git/**)'];
const ManagedSettingsSchema = z.strictObject({
  $schema: z.literal('https://json.schemastore.org/claude-code-settings.json').optional(),
  disableAllHooks: z.literal(true),
  permissions: z.strictObject({
    deny: z
      .array(z.string())
      .refine((deny) => DENIED.every((tool) => deny.includes(tool)), 'a tool is not denied'),
    disableBypassPermissionsMode: z.literal('disable'),
    blockReadsOutsideWorkingDirectories: z.literal(true),
  }),
});

Given('the committed managed settings of the security review', function () {
  this.state['managed-settings'] = readFileSync(join(ROOT, SETTINGS), 'utf8');
});

Then('they deny every tool that runs a command, writes or reaches a host', function () {
  ManagedSettingsSchema.parse(JSON.parse(stored<string>(this, 'managed-settings')));
});

const SETTINGS_BREAKS: Record<string, (settings: Record<string, unknown>) => void> = {
  'that allow Bash': (s) => {
    const permissions = s['permissions'] as { deny: string[] };
    permissions.deny = permissions.deny.filter((tool) => tool !== 'Bash');
  },
  'that let Claude read .git': (s) => {
    const permissions = s['permissions'] as { deny: string[] };
    permissions.deny = permissions.deny.filter((tool) => tool !== 'Read(.git/**)');
  },
  'that allow reads outside the checkout': (s) => {
    (s['permissions'] as Record<string, unknown>)['blockReadsOutsideWorkingDirectories'] = false;
  },
  'that keep hooks': (s) => {
    s['disableAllHooks'] = false;
  },
  'that allow a tool': (s) => {
    (s['permissions'] as Record<string, unknown>)['allow'] = ['Bash(npm run *)'];
  },
  'that set an environment': (s) => {
    s['env'] = { ANTHROPIC_BASE_URL: 'https://example.invalid' };
  },
};

Then('managed settings {} are rejected', function (kind: string) {
  const breakIt = SETTINGS_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken managed settings named "${kind}"`);
  const settings = JSON.parse(stored<string>(this, 'managed-settings')) as Record<string, unknown>;
  breakIt(settings);
  assert.throws(() => ManagedSettingsSchema.parse(settings));
});

/**
 * An instruction file is text the reviewer reads with Read: UTF-8, ending with a newline, at most 32 KiB, with its
 * provenance line first (they are adapted from an MIT-licensed source, whose notice they keep) and no GitHub
 * expression, which would only be read as text.
 */
const MAX_INSTRUCTIONS = 32 * 1024;
function assertInstructions(text: string): void {
  assert.ok(text.length > 0 && Buffer.byteLength(text, 'utf8') <= MAX_INSTRUCTIONS, 'size');
  assert.ok(text.endsWith('\n'), 'a final newline');
  assert.ok(!text.includes('\u0000') && !text.includes('�'), 'text');
  assert.ok(!text.includes('${{'), 'a GitHub expression');
  assert.match(text, /^PROVENANCE: .+anthropics\/claude-code-security-review at commit [0-9a-f]{40}\b/);
  assert.match(text, /\nCopyright \(c\) 2025 Anthropic\. MIT License: /);
}

Then('each instruction file of the security review is text the reviewer can read', function () {
  for (const path of INSTRUCTIONS) assertInstructions(readFileSync(join(ROOT, path), 'utf8'));
});

const INSTRUCTION_BREAKS: Record<string, (text: string) => string> = {
  empty: () => '',
  'without a final newline': (text) => text.trimEnd(),
  'too large': (text) => text + 'x'.repeat(MAX_INSTRUCTIONS) + '\n',
  'with a GitHub expression': (text) => text + 'Read ${{ github.event.pull_request.body }}\n',
  'without its provenance': (text) => text.slice(text.indexOf('\n') + 1),
  'without the license notice': (text) =>
    text.replace('Copyright (c) 2025 Anthropic.', 'Copyright Anthropic.'),
};

Then('an instruction file {} is rejected', function (kind: string) {
  const breakIt = INSTRUCTION_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken instruction file named "${kind}"`);
  for (const path of INSTRUCTIONS) {
    const original = readFileSync(join(ROOT, path), 'utf8');
    const broken = breakIt(original);
    assert.notEqual(broken, original);
    assert.throws(() => assertInstructions(broken));
  }
});
