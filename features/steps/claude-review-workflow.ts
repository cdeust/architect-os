import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

/**
 * The guards of the review job of `.github/workflows/claude-review.yml` (docs/infrastructure.md, "The Claude review"),
 * read from the parsed workflow. The job runs the official mode of `anthropics/claude-code-action`
 * (examples/pr-review-comprehensive.yml at 4411a9e9, v1.0.290: `track_progress`, the comment tools of the action), and
 * this repository keeps it stricter: Claude Code restricted by managed settings and a hook that guards each comment,
 * installed by a trusted step from the commit of the run; no shell; a diff written by a trusted step; the action
 * pinned once for the three workflows that use it. The budget job and the step names stay, since the resolver and
 * scripts/ci_review_budget.py read them.
 */
const WORKFLOW = '.github/workflows/claude-review.yml';
const ACTION_PIN = 'anthropics/claude-code-action@4411a9e9b0283becf4b924f7bce360fd7756c78c';

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const Step = z.strictObject({
  id: z.string().optional(),
  name: z.string(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), Scalar).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
type StepT = z.infer<typeof Step>;

/** A workflow as YAML gives it, before any schema: the rules below read keys a schema would not name. */
export type RawStep = Record<string, unknown>;
export interface RawJob {
  [key: string]: unknown;
  steps?: RawStep[];
}
export interface RawWorkflow {
  [key: string]: unknown;
  jobs: Record<string, RawJob>;
}

/**
 * The one way a rule recognises a step that runs Claude Code: the action, its `base-action` directory and the
 * repository of the base action, in any capitals, since GitHub reads the owner and the name of an action without
 * regard to case. The pin, the scrub, the permission mode, the managed settings and bubblewrap all ask this function,
 * and the rule of the pin then accepts one spelling.
 */
const ENGINE = /^anthropics\/claude-code-(base-)?action[/@]/i;
export const runsTheAction = (step: { uses?: unknown }): boolean =>
  typeof step.uses === 'string' && ENGINE.test(step.uses);

/** Every step of a workflow that runs the action, with the steps of its job and its place among them. */
export function actionsOf(doc: RawWorkflow): { id: string; job: RawJob; steps: RawStep[]; at: number }[] {
  return Object.entries(doc.jobs).flatMap(([id, job]) => {
    const steps = job.steps ?? [];
    return steps.flatMap((step, at) => (runsTheAction(step) ? [{ id, job, steps, at }] : []));
  });
}

const workflowTexts = (): { file: string; text: string }[] => {
  const dir = join(ROOT, '.github/workflows');
  return readdirSync(dir)
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
};

const ReviewJob = z.strictObject({
  name: z.literal('Claude review'),
  needs: z.literal('budget'),
  if: z.string(),
  'runs-on': z.string(),
  permissions: z.strictObject({
    contents: z.literal('read'),
    'pull-requests': z.literal('write'),
    'id-token': z.literal('write'),
  }),
  steps: z.array(Step),
});

const REVIEW_FILES = {
  ref: '${{ github.sha }}',
  path: 'review-config',
  'fetch-depth': 1,
  'persist-credentials': false,
  'sparse-checkout': '.github/claude-review',
  'sparse-checkout-cone-mode': false,
};
function index(steps: StepT[], label: string, found: (step: StepT) => boolean): number {
  const at = steps.findIndex(found);
  assert.ok(at >= 0, `the review job has no step that ${label}`);
  assert.equal(steps.filter(found).length, 1, `more than one step that ${label}`);
  return at;
}

export function assertClaudeReview(text: string): void {
  const doc = parse(text) as { jobs: Record<string, unknown> };
  const job = ReviewJob.parse(doc.jobs['review']);
  const steps = job.steps;
  for (const step of steps) {
    if (step.uses !== undefined) assert.match(step.uses, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/);
    assert.ok(!(step.run ?? '').includes('${{'), `an expression in a command: ${step.name}`);
  }
  const main = index(steps, 'checks out main', (step) => step.name === 'Checkout repository');
  assert.deepEqual(steps[main]?.with, { ref: 'main', 'fetch-depth': 1, 'persist-credentials': false });
  const files = index(
    steps,
    'checks out the review files',
    (step) => step.with?.['path'] === 'review-config',
  );
  assert.match(steps[files]?.uses ?? '', /^actions\/checkout@[0-9a-f]{40}$/);
  assert.deepEqual(steps[files]?.with, REVIEW_FILES);
  const restrict = index(steps, 'installs the managed settings', (step) =>
    (step.run ?? '').includes('/etc/claude-code/'),
  );
  assert.equal(steps[restrict]?.run, ACTIONS['claude-review.yml']?.run);
  assert.equal(steps[restrict]?.if, undefined, 'the restriction is conditional');
  const diff = index(steps, 'writes the diff', (step) => step.id === 'diff');
  const review = index(steps, 'runs the action', (step) => step.id === 'review');
  assert.ok(main < files && files < restrict && restrict < diff && diff < review, 'the order of the guards');

  const diffEnv = steps[diff]?.env ?? {};
  assert.deepEqual(Object.keys(diffEnv).sort(), [
    'GH_TOKEN',
    'HEAD_SHA',
    'MAX_DIFF_BYTES',
    'PR',
    'REVIEWED_SHA',
  ]);
  assert.equal(diffEnv['GH_TOKEN'], '${{ github.token }}');
  assert.equal(diffEnv['MAX_DIFF_BYTES'], '1048576');
  for (const value of Object.values(diffEnv)) assert.ok(!value.includes('secrets.'), 'a secret for the diff');
  for (const line of [
    'head -c "$MAX_DIFF_BYTES"',
    '# TRUNCATED',
    'review-input/pr.diff',
    'review-input/since.diff',
  ]) {
    assert.ok((steps[diff]?.run ?? '').includes(line), `the diff step lacks: ${line}`);
  }

  const action = steps[review]!;
  assert.equal(action.name, 'PR Review', 'scripts/ci_review_budget.py and the resolver read this name');
  assert.equal(action.uses, ACTION_PIN);
  const inputs = action.with ?? {};
  assert.deepEqual(Object.keys(inputs).sort(), [
    'allowed_bots',
    'claude_args',
    'claude_code_oauth_token',
    'prompt',
    'track_progress',
  ]);
  assert.equal(inputs['claude_code_oauth_token'], '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
  assert.equal(inputs['track_progress'], true);
  assert.equal(inputs['claude_args'], ACTIONS['claude-review.yml']?.inputs['claude_args']);
  const prompt = String(inputs['prompt']);
  for (const told of [
    'review-input/pr.diff',
    'review-input/since.diff',
    'mcp__github_comment__update_claude_comment',
  ]) {
    assert.ok(prompt.includes(told), `the prompt does not name ${told}`);
  }
  assert.ok(
    !/`gh pr|\bgh pr (comment|diff|view)\b/.test(prompt),
    'the prompt asks for gh, which has no shell',
  );
}

Given('the committed review workflow', function () {
  this.state['claude-review'] = readFileSync(join(ROOT, WORKFLOW), 'utf8');
});

Then('the review job holds the guards of the Claude review', function () {
  assertClaudeReview(stored<string>(this, 'claude-review'));
});

Then('the three workflows that use the action pin it to one commit', function () {
  const pins = workflowTexts().flatMap(({ file, text }) =>
    actionsOf(parse(text) as RawWorkflow).map(({ steps, at }) => ({ file, uses: steps[at]?.['uses'] })),
  );
  assert.equal(new Set(pins.map(({ file }) => file)).size, 3, 'the workflow files that run the action');
  for (const { file, uses } of pins) assert.equal(uses, ACTION_PIN, `${file} pins another commit`);
});

const at = (yaml: string, find: string, replace: string): string => {
  assert.ok(yaml.includes(find), `the committed workflow no longer has: ${find}`);
  return yaml.replace(find, () => replace);
};

const BREAKS: Record<string, (yaml: string) => string> = {
  'that allows Bash': (yaml) =>
    at(
      yaml,
      '--allowedTools "mcp__github_inline_comment__create_inline_comment"',
      '--allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*)"',
    ),
  'in auto mode': (yaml) => at(yaml, '--permission-mode default', '--permission-mode auto'),
  'that loads other MCP servers': (yaml) => at(yaml, '            --strict-mcp-config\n', ''),
  'without the restriction': (yaml) =>
    at(
      yaml,
      '          sudo install -D -m 0644 -o root -g root review-config/.github/claude-review/managed-settings.json /etc/claude-code/managed-settings.json\n',
      '',
    ),
  'without the guard of the comments': (yaml) =>
    at(
      yaml,
      '          sudo install -D -m 0755 -o root -g root review-config/.github/claude-review/comment-guard.py /etc/claude-code/comment-guard.py\n',
      '',
    ),
  'with the restriction from the default branch': (yaml) =>
    at(
      yaml,
      ' review-config/.github/claude-review/managed-settings.json',
      ' .github/claude-review/managed-settings.json',
    ),
  'that keeps the review files in the checkout': (yaml) => at(yaml, '          rm -rf review-config\n', ''),
  'that checks out the review files in cone mode': (yaml) =>
    at(yaml, 'sparse-checkout-cone-mode: false', 'sparse-checkout-cone-mode: true'),
  'that checks out the head of the PR as the working directory': (yaml) => {
    const job = yaml.indexOf('\n  review:\n');
    return (
      yaml.slice(0, job) +
      at(
        yaml.slice(job),
        '          ref: main\n',
        '          ref: ${{ github.event.pull_request.head.sha }}\n',
      )
    );
  },
  'with a secret for the diff': (yaml) =>
    at(
      yaml,
      '          GH_TOKEN: ${{ github.token }}\n          PR:',
      '          GH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n          PR:',
    ),
  'without the bound of the diff': (yaml) =>
    at(yaml, "MAX_DIFF_BYTES: '1048576'", "MAX_DIFF_BYTES: '999999999999'"),
  'with the diff after the action': (yaml) => {
    const start = yaml.indexOf('      - name: Write the diff of the pull request\n');
    const end = yaml.indexOf('      - name: PR Review\n');
    const block = yaml.slice(start, end);
    return at(
      yaml.replace(block, ''),
      '      # The SDK trace can contain',
      block + '      # The SDK trace can contain',
    );
  },
  'with an action on a branch': (yaml) =>
    at(yaml, 'claude-code-action@4411a9e9b0283becf4b924f7bce360fd7756c78c', 'claude-code-action@v1'),
  'with the older pin': (yaml) =>
    at(
      yaml,
      'claude-code-action@4411a9e9b0283becf4b924f7bce360fd7756c78c',
      'claude-code-action@4fa93a88de49bbef68b10eb15aabedf28ca0e1ed',
    ),
  'that prints the full output': (yaml) =>
    at(
      yaml,
      '          track_progress: true\n',
      '          track_progress: true\n          show_full_output: true\n',
    ),
  'that asks for gh pr comment': (yaml) =>
    at(
      yaml,
      'Publish only through your tracking comment',
      'Use `gh pr comment` for top-level feedback. Publish only through your tracking comment',
    ),
  'with an event expression in a command': (yaml) =>
    at(
      yaml,
      '          mkdir -p review-input\n',
      '          mkdir -p review-input\n          echo "${{ github.event.pull_request.title }}"\n',
    ),
  'with broader contents': (yaml) =>
    at(
      yaml,
      '    permissions:\n      contents: read\n      pull-requests: write\n      id-token: write\n',
      '    permissions:\n      contents: write\n      pull-requests: write\n      id-token: write\n',
    ),
};

Then('a review workflow {} is rejected by the guards of the Claude review', function (kind: string) {
  const breakIt = BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken review workflow named "${kind}"`);
  const original = stored<string>(this, 'claude-review');
  const broken = breakIt(original);
  assert.notEqual(broken, original);
  assert.throws(() => assertClaudeReview(broken));
});

/**
 * .github/claude-review/managed-settings.json: what the security review's settings deny, plus the hook that guards
 * the comments, and `allowManagedHooksOnly` so that no hook of the repository or of a plugin runs. No
 * `disableAllHooks`, which would turn the guard off too (code.claude.com/docs/en/hooks, "disableAllHooks").
 */
const DENIED = ['Bash', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'NotebookEdit', 'Read(.git/**)'];
const GUARDED =
  '^(mcp__github_comment__update_claude_comment|mcp__github_inline_comment__create_inline_comment)$';
const ReviewSettings = z.strictObject({
  $schema: z.literal('https://json.schemastore.org/claude-code-settings.json').optional(),
  allowManagedHooksOnly: z.literal(true),
  hooks: z.strictObject({
    PreToolUse: z.tuple([
      z.strictObject({
        matcher: z.literal(GUARDED),
        hooks: z.tuple([
          z.strictObject({
            type: z.literal('command'),
            command: z.literal('python3 -I /etc/claude-code/comment-guard.py'),
          }),
        ]),
      }),
    ]),
  }),
  permissions: z.strictObject({
    deny: z
      .array(z.string())
      .refine((deny) => DENIED.every((tool) => deny.includes(tool)), 'a tool is not denied'),
    disableBypassPermissionsMode: z.literal('disable'),
    disableAutoMode: z.literal('disable'),
    blockReadsOutsideWorkingDirectories: z.literal(true),
  }),
});

Given('the committed managed settings of the Claude review', function () {
  this.state['review-settings'] = readFileSync(
    join(ROOT, '.github/claude-review/managed-settings.json'),
    'utf8',
  );
});

Then('they deny the shell, the web, writes and .git, and guard every comment', function () {
  ReviewSettings.parse(JSON.parse(stored<string>(this, 'review-settings')));
});

type Settings = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SETTINGS_BREAKS: Record<string, (s: Settings) => void> = {
  'that allow Bash': (s) => {
    s['permissions'].deny = s['permissions'].deny.filter((tool: string) => tool !== 'Bash');
  },
  'that let Claude read .git': (s) => {
    s['permissions'].deny = s['permissions'].deny.filter((tool: string) => tool !== 'Read(.git/**)');
  },
  'that allow reads outside the checkout': (s) => {
    s['permissions'].blockReadsOutsideWorkingDirectories = false;
  },
  'that allow auto mode': (s) => {
    delete s['permissions'].disableAutoMode;
  },
  'that let the repository add hooks': (s) => {
    delete s['allowManagedHooksOnly'];
  },
  'that turn every hook off, the guard included': (s) => {
    s['disableAllHooks'] = true;
  },
  'that guard the inline comments only': (s) => {
    s['hooks'].PreToolUse[0].matcher = '^mcp__github_inline_comment__create_inline_comment$';
  },
  'that run the guard from the checkout': (s) => {
    s['hooks'].PreToolUse[0].hooks[0].command = 'python3 -I .github/claude-review/comment-guard.py';
  },
  'that set an environment': (s) => {
    s['env'] = { ANTHROPIC_BASE_URL: 'https://example.invalid' };
  },
};

Then("the review's managed settings {} are rejected", function (kind: string) {
  const breakIt = SETTINGS_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken settings named "${kind}"`);
  const settings = JSON.parse(stored<string>(this, 'review-settings')) as Settings;
  breakIt(settings);
  assert.throws(() => ReviewSettings.parse(settings));
});

/**
 * The rule of the steps that run the action, in every workflow file of the directory. It is a net for an honest edit
 * of a workflow, not a boundary: it accepts one shape and refuses every other without guessing how the other is bad,
 * so a changed shape must change the text expected here in the same pull request, in front of its reviewers. Whoever
 * can change a workflow can change this file with it; the boundary is the review, and a credential that cannot write
 * workflows (docs/infrastructure.md, "Which commit a run takes its files from").
 *
 * The shape. The action is used in the steps of a job and nowhere else in the document. Its workflow, its job and
 * every step of its job have no key but those listed. The job runs on the image the proof is written for and holds
 * one action: the pinned one, scrubbed, with the inputs written for its file below, on the exact condition. The step just before
 * it is the proof of bubblewrap, to the letter; a step `settings` before that is one of the installers below, to the
 * letter, fed by a sparse checkout of the commit of the run. With that condition GitHub starts no action unless both
 * succeeded.
 *
 * Not compared here: the text of the prompt, of which the rules of the two reviews check what they need; the other steps of the
 * job, and so what an earlier step leaves on the runner or does to the installed files; the body of an action of
 * another repository. Three checks are searches, not comparisons, and say so: `runsTheAction` (a pattern, so that
 * another spelling is found, then refused by the pin), and the two refusals of a place where an action would hide.
 *
 * Why a proof: Claude Code refuses to start under `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` on Linux without bubblewrap
 * (run 45771449067), and the action installs it only when `allowed_non_write_users` is set, in a step that may fail
 * (action.yml at 4411a9e9, "Install subprocess isolation dependencies"). The proof removes the cause of that recorded
 * failure, and stops a runner without a working bubblewrap before the model is called. Keeping a credential from a subprocess is Claude
 * Code's. Why a mode: from v1.0.290 the action starts a session in auto mode unless one of several inputs is set
 * (`defaultsToAutoMode`, src/modes/permission-mode.ts).
 */
const SCRUB = 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB';
const SCRUB_IMAGE = 'ubuntu-24.04';
const WORKFLOW_KEYS = ['name', 'on', 'permissions', 'concurrency', 'jobs'];
const JOB_KEYS = ['name', 'needs', 'if', 'runs-on', 'timeout-minutes', 'permissions', 'outputs', 'steps'];
const STEP_KEYS = ['id', 'name', 'if', 'uses', 'with', 'env', 'run'];
const PRESENT = "steps.credential.outputs.present == 'true'";
export const WAITS = "steps.settings.outcome == 'success' && steps.bubblewrap.outcome == 'success'";
/** The two conditions of an action: after its settings and its proof; and, in a job that looks for a credential, after it. */
export const WAITS_AFTER_CREDENTIAL = `${PRESENT} && ${WAITS}`;
const PROOF = {
  id: 'bubblewrap',
  name: 'Prove bubblewrap before the scrub of subprocesses',
  run: [
    'set -euo pipefail',
    'sudo apt-get update',
    'sudo apt-get install -y --no-install-recommends bubblewrap socat',
    'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
    'bwrap --version',
    'bwrap --unshare-user --unshare-pid --ro-bind / / --proc /proc true',
    '',
  ].join('\n'),
};
const install = (from: string, file: string, mode: string): string =>
  `sudo install -D -m ${mode} -o root -g root ${from}/${file} /etc/claude-code/${file}`;
const script = (...lines: string[]): string => ['set -euo pipefail', ...lines, ''].join('\n');
const lines = (...each: string[]): string => [...each, ''].join('\n');
const CHECKOUT_PIN = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const TOKEN = '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}';
const BOTS = 'claude[bot],chatgpt-codex-connector[bot],dependabot[bot]';
/**
 * The three actions, by the name of their workflow file: the directory of their managed settings, where it is checked
 * out, the command that installs it, and every input of the action but its prompt, to the letter. The name selects
 * the entry, never the contents: a file cannot choose what it is compared with. The action keeps the last permission
 * mode it is given, in either spelling (`lastPermissionMode`, base-action/src/parse-sdk-options.ts at 4411a9e9), so
 * the arguments are compared whole, never searched.
 */
export const ACTIONS: Record<
  string,
  { directory: string; path: string; run: string; prompt: boolean; inputs: Record<string, unknown> }
> = {
  'claude.yml': {
    directory: '.github/claude',
    path: 'claude-config',
    run: script(
      install('claude-config/.github/claude', 'managed-settings.json', '0644'),
      'rm -rf claude-config',
    ),
    prompt: false,
    inputs: {
      claude_code_oauth_token: TOKEN,
      claude_args: lines(
        '--permission-mode acceptEdits',
        '--allowedTools "Read,Glob,Grep,Edit,Write"',
        '--model "claude-opus-5-5"',
      ),
    },
  },
  'claude-review.yml': {
    directory: '.github/claude-review',
    path: 'review-config',
    run: script(
      install('review-config/.github/claude-review', 'managed-settings.json', '0644'),
      install('review-config/.github/claude-review', 'comment-guard.py', '0755'),
      'rm -rf review-config',
    ),
    prompt: true,
    inputs: {
      claude_code_oauth_token: TOKEN,
      track_progress: true,
      allowed_bots: BOTS,
      claude_args: lines(
        '--strict-mcp-config',
        '--permission-mode default',
        '--allowedTools "mcp__github_inline_comment__create_inline_comment"',
        '--model "claude-opus-5-5"',
      ),
    },
  },
  'claude-security-review.yml': {
    directory: '.github/claude-security-review',
    path: 'review-config',
    run: install('review-config/.github/claude-security-review', 'managed-settings.json', '0644'),
    prompt: true,
    inputs: {
      claude_code_oauth_token: TOKEN,
      github_token: '${{ github.token }}',
      allowed_bots: BOTS,
      claude_args: lines(
        '--strict-mcp-config',
        '--permission-mode default',
        '--allowedTools "Read,Grep,Glob"',
        '--model "claude-opus-5-5"',
        "--json-schema '${{ steps.schema.outputs.json }}'",
      ),
    },
  },
};

const closed = (what: string, value: unknown, keys: string[]): void => {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), `${what} is not a mapping`);
  for (const key of Object.keys(value)) {
    assert.ok(keys.includes(key), `${what} has a key the rule does not know: ${key}`);
  }
};

/** How many times `found` holds in a parsed document, at any depth: what a rule that reads `steps` could miss. */
function count(value: unknown, found: (key: string, inner: unknown) => boolean): number {
  if (typeof value !== 'object' || value === null) return 0;
  return Object.entries(value).reduce(
    (sum, [key, inner]) => sum + (found(key, inner) ? 1 : 0) + count(inner, found),
    0,
  );
}

/** Refuses a workflow file whose actions are not in the shape written for its name; the number of its actions. */
export function assertActions(file: string, text: string): number {
  const doc = parse(text) as RawWorkflow;
  const actions = actionsOf(doc);
  assert.equal(
    count(doc, (key, inner) => key === 'uses' && runsTheAction({ uses: inner })),
    actions.length,
    'the action is used where no rule reads it',
  );
  assert.equal(
    count(doc, (key) => key === SCRUB),
    actions.length,
    'the scrub is set outside the step of an action',
  );
  for (const [id, job] of Object.entries(doc.jobs)) {
    const called = job['uses'];
    assert.ok(
      called === undefined || (typeof called === 'string' && called.startsWith('./.github/workflows/')),
      `job ${id} calls a workflow of another repository, where an action would hide`,
    );
    for (const step of job.steps ?? []) {
      assert.ok(
        !(typeof step['uses'] === 'string' && step['uses'].startsWith('./')),
        `job ${id} uses a local action, where an action would hide`,
      );
    }
  }
  if (actions.length === 0) return 0;
  const entry = ACTIONS[file];
  assert.ok(
    entry !== undefined,
    `the file ${file} runs the action, and the rule holds no entry under that name`,
  );
  const { directory, path, run, prompt, inputs } = entry;
  closed('the workflow', doc, WORKFLOW_KEYS);
  assert.equal(new Set(actions.map(({ id }) => id)).size, actions.length, 'a job runs more than one action');
  for (const { id, job, steps, at } of actions) {
    closed(`job ${id}`, job, JOB_KEYS);
    steps.forEach((step, index) => closed(`step ${index + 1} of job ${id}`, step, STEP_KEYS));
    assert.equal(job['runs-on'], SCRUB_IMAGE, 'the job does not run on the image the proof is written for');

    const action = steps[at] as StepT;
    assert.equal(action.uses, ACTION_PIN, 'the action has another pin or another spelling');
    assert.deepEqual(action.env, { [SCRUB]: '1' }, 'the environment of the subprocesses is not scrubbed');
    assert.ok(
      action.if === WAITS || action.if === WAITS_AFTER_CREDENTIAL,
      'the condition of the action is not the canonical one',
    );
    // In a job that looks for a credential, the two steps the action waits for run on that credential too.
    const gate = action.if === WAITS ? {} : { if: PRESENT };

    assert.deepEqual(
      steps[at - 1],
      { ...PROOF, ...gate },
      'the step before the action is not the proof of bubblewrap',
    );

    const installers = steps.flatMap((step, index) => (step['id'] === 'settings' ? [index] : []));
    assert.ok(
      installers.length === 1 && (installers[0] as number) < at,
      'no step settings before the action',
    );
    const installer = steps[installers[0] as number] as StepT;
    assert.equal(installer.run, run, 'the step settings is not the installer written for this file');
    closed('the step settings', installer, ['id', 'name', 'if', 'run']);
    const { prompt: asked, ...given } = action.with ?? {};
    assert.deepEqual(given, inputs, 'the inputs of the action are not those written for this file');
    assert.equal(typeof asked === 'string', prompt, 'the action has a prompt where none is written, or none');
    assert.deepEqual(
      { id: installer.id, if: installer.if },
      { id: 'settings', if: gate.if },
      'the step settings does not run on the condition of its job',
    );
    const checkouts = (steps as StepT[])
      .slice(0, installers[0])
      .filter((step) => step.with?.['path'] === path);
    assert.equal(checkouts.length, 1, 'the managed settings come from no checkout of the run');
    closed('the checkout of the managed settings', checkouts[0], ['name', 'uses', 'with']);
    assert.equal(checkouts[0]?.uses, CHECKOUT_PIN, 'the checkout of the managed settings has another pin');
    assert.deepEqual(
      checkouts[0]?.with,
      {
        ref: '${{ github.sha }}',
        path,
        'fetch-depth': 1,
        'persist-credentials': false,
        'sparse-checkout': directory,
        'sparse-checkout-cone-mode': false,
      },
      'the checkout of the managed settings is not the sparse checkout of the commit of the run',
    );
    assertModesForbidden(readFileSync(join(ROOT, directory, 'managed-settings.json'), 'utf8'));
  }
  return actions.length;
}

/** What a credential of a hosted runner sits behind, denied by name in every Claude workflow's managed settings. */
export const SENSITIVE = [
  'Read(.git/**)',
  'Read(//proc/**)',
  'Read(~/.claude/**)',
  'Read(~/.config/gh/**)',
  'Read(~/.git-credentials)',
  'Read(~/.gitconfig)',
  'Read(//home/runner/work/_temp/**)',
];

function assertModesForbidden(settings: string): void {
  const permissions = (JSON.parse(settings) as { permissions?: Record<string, unknown> }).permissions ?? {};
  assert.equal(permissions['disableAutoMode'], 'disable', 'auto mode is not forbidden');
  assert.equal(permissions['disableBypassPermissionsMode'], 'disable', 'bypass mode is not forbidden');
  assert.equal(
    permissions['blockReadsOutsideWorkingDirectories'],
    true,
    'reads outside the checkout are not blocked',
  );
  const deny = Array.isArray(permissions['deny']) ? (permissions['deny'] as unknown[]) : [];
  for (const path of SENSITIVE) assert.ok(deny.includes(path), `not denied: ${path}`);
}

/** The files that run an action, each judged by the rule. */
function workflowsOfTheAction(files: { file: string; text: string }[]): string[] {
  return files
    .filter(({ file, text }) => {
      try {
        return assertActions(file, text) > 0;
      } catch (error) {
        throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    })
    .map(({ file }) => file);
}

Then(
  'every action of every workflow file waits for the proof of bubblewrap and for its managed settings, and the files that run one are exactly:',
  function (table: { raw(): string[][] }) {
    assert.deepEqual(workflowsOfTheAction(workflowTexts()), table.raw().flat().sort());
  },
);

Then(
  'every workflow that runs the action fixes its mode and forbids auto and bypass:',
  function (table: { raw(): string[][] }) {
    for (const [file] of table.raw()) {
      assert.ok(
        assertActions(String(file), readFileSync(join(ROOT, '.github/workflows', String(file)), 'utf8')) > 0,
      );
    }
  },
);

const MODE_BREAKS: Record<string, (yaml: string) => string> = {
  'without the scrub of its subprocesses': (yaml) =>
    yaml.replace(/\n *CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: ["']1["']/, '\n          KEEP: "1"'),
  'in auto mode': (yaml) => yaml.replace(/--permission-mode (default|acceptEdits)/, '--permission-mode auto'),
  'without a mode': (yaml) => yaml.replace(/\n *--permission-mode (default|acceptEdits)/, ''),
  'with two modes': (yaml) =>
    yaml.replace(
      /(--permission-mode (default|acceptEdits))/,
      '$1\n            --permission-mode bypassPermissions',
    ),
  'without its managed settings': (yaml) =>
    yaml.replace(
      /(\n *|run: )sudo install -D -m 0644 -o root -g root \S+\/managed-settings\.json \/etc\/claude-code\/managed-settings\.json/,
      (_match, lead: string) => (lead === 'run: ' ? 'run: true' : ''),
    ),
  'with its settings checked out in cone mode': (yaml) =>
    yaml.replace('sparse-checkout-cone-mode: false', 'sparse-checkout-cone-mode: true'),
  'with managed settings from the default branch': (yaml) =>
    yaml.replace(/ (review-config|claude-config)\/(\.github\/\S+\/managed-settings\.json)/, ' $2'),
};

/** An action as a careless copy would add it: scrubbed, pinned, and waiting for nothing. */
const BARE_ACTION = {
  uses: ACTION_PIN,
  env: { [SCRUB]: '1' },
  with: { claude_args: '--permission-mode default' },
};

/** The action of the committed workflow, its job, and the two steps it waits for. */
function shape(doc: RawWorkflow): {
  job: RawJob;
  steps: RawStep[];
  proof: RawStep;
  settings: RawStep;
  action: RawStep;
} {
  const [first] = actionsOf(doc);
  assert.ok(first !== undefined, 'the committed workflow runs no action');
  const { job, steps, at } = first;
  const settings = steps.find((step) => step['id'] === 'settings');
  assert.ok(settings !== undefined, 'the committed workflow no longer installs its settings');
  return { job, steps, proof: steps[at - 1] as RawStep, settings, action: steps[at] as RawStep };
}
const firstSteps = (doc: RawWorkflow): RawStep[] => (Object.values(doc.jobs)[0] as RawJob).steps as RawStep[];
const condition = (change: (was: string) => string) => (doc: RawWorkflow) => {
  const { action } = shape(doc);
  action['if'] = change(String(action['if']));
};
const proofRun = (change: (was: string) => string) => (doc: RawWorkflow) => {
  const { proof } = shape(doc);
  proof['run'] = change(String(proof['run']));
};
const moved =
  (which: 'proof' | 'settings', to: (steps: RawStep[], step: RawStep) => RawStep[]) => (doc: RawWorkflow) => {
    const found = shape(doc);
    found.job.steps = to(
      found.steps.filter((step) => step !== found[which]),
      found[which],
    );
  };
const second = (step: RawStep) => (doc: RawWorkflow) => {
  doc.jobs['second'] = { 'runs-on': SCRUB_IMAGE, steps: [step] };
};

const NOT_THE_PROOF = /the step before the action is not the proof of bubblewrap/;
const NOT_THE_CONDITION = /the condition of the action is not the canonical one/;
const NOT_THE_INPUTS = /the inputs of the action are not those written for this file/;
const NOT_THE_INSTALLER = /the step settings is not the installer written for this file/;
/** The whole of another workflow file under this name: valid where it was written, not here. */
const contentsOf = (other: string) => (doc: RawWorkflow) => {
  for (const key of Object.keys(doc)) delete doc[key];
  Object.assign(doc, parse(readFileSync(join(ROOT, '.github/workflows', other), 'utf8')));
};
/** The inputs of another file's action on this file's action: its mode and its tools. */
const inputsOf = (other: string) => (doc: RawWorkflow) => {
  shape(doc).action['with'] = { ...ACTIONS[other]?.inputs, prompt: 'x' };
};
const args = (change: (was: string) => string) => (doc: RawWorkflow) => {
  const { action } = shape(doc);
  const inputs = action['with'] as Record<string, unknown>;
  inputs['claude_args'] = change(String(inputs['claude_args']));
};
const UNKNOWN_KEY = (key: string): RegExp => new RegExp(`has a key the rule does not know: ${key}$`, 'm');

/** A broken copy, and the words of the refusal it must get: a copy refused for another reason proves nothing. */
const SHAPE_BREAKS: Record<string, [(doc: RawWorkflow) => void, RegExp]> = {
  'without the proof of bubblewrap': [moved('proof', (steps) => steps), NOT_THE_PROOF],
  'with the proof of bubblewrap after the action': [
    moved('proof', (steps, proof) => [...steps, proof]),
    NOT_THE_PROOF,
  ],
  'with a step between the proof of bubblewrap and the action': [
    (doc) => {
      const { steps, action } = shape(doc);
      steps.splice(steps.indexOf(action), 0, {
        name: 'Restrict again',
        run: 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1',
      });
    },
    NOT_THE_PROOF,
  ],
  'with a proof of bubblewrap on another condition': [
    (doc) => void (shape(doc).proof['if'] = `env.${SCRUB} == '1'`),
    NOT_THE_PROOF,
  ],
  'that installs bubblewrap without proving it': [
    proofRun((run) => run.split('\nbwrap ')[0] + '\n'),
    NOT_THE_PROOF,
  ],
  'that reads the version of bubblewrap and creates no namespace': [
    proofRun((run) => run.replace(/bwrap --unshare-user[^\n]*\n/, '')),
    NOT_THE_PROOF,
  ],
  'that leaves user namespaces restricted': [
    proofRun((run) => run.replace(/sudo sysctl[^\n]*\n/, '')),
    NOT_THE_PROOF,
  ],
  'whose proof of bubblewrap goes on after a failure': [
    proofRun((run) => run.replace('set -euo pipefail\n', '')),
    NOT_THE_PROOF,
  ],
  'whose proof of bubblewrap ends before its first line': [
    proofRun((run) => `exit 0\n${run}`),
    NOT_THE_PROOF,
  ],
  'with a proof of bubblewrap that may fail': [
    (doc) => void (shape(doc).proof['continue-on-error'] = true),
    UNKNOWN_KEY('continue-on-error'),
  ],
  'with a shell on the proof of bubblewrap that only checks its syntax': [
    (doc) => void (shape(doc).proof['shell'] = 'bash -n {0}'),
    UNKNOWN_KEY('shell'),
  ],

  'with an action that does not wait for the proof of bubblewrap': [
    condition((was) => was.replace(" && steps.bubblewrap.outcome == 'success'", '')),
    NOT_THE_CONDITION,
  ],
  'with an action that does not wait for its managed settings': [
    condition((was) => was.replace("steps.settings.outcome == 'success' && ", '')),
    NOT_THE_CONDITION,
  ],
  'with an action that has no condition': [(doc) => void delete shape(doc).action['if'], NOT_THE_CONDITION],
  'with an action that waits for the proof of bubblewrap or for anything else': [
    condition((was) => `${was} || always()`),
    NOT_THE_CONDITION,
  ],
  'with the condition of the action between expression markers': [
    condition((was) => `\${{ ${was} }}`),
    NOT_THE_CONDITION,
  ],
  'with a space before the expression markers of the condition, which makes it a text that is always true': [
    condition((was) => ` \${{ ${was} }}`),
    NOT_THE_CONDITION,
  ],
  'with the condition of the action written without spaces': [
    condition((was) => was.replaceAll(' == ', '==')),
    NOT_THE_CONDITION,
  ],
  'with the condition of the action in other capitals': [
    condition((was) => was.replaceAll('outcome', 'Outcome')),
    NOT_THE_CONDITION,
  ],
  'with the proof of bubblewrap named between square brackets in the condition': [
    condition((was) => was.replace('steps.bubblewrap.outcome', "steps['bubblewrap'].outcome")),
    NOT_THE_CONDITION,
  ],

  'with a second permission mode, in the equals spelling, after the canonical one': [
    args((was) => `${was}--permission-mode=plan\n`),
    NOT_THE_INPUTS,
  ],
  'with its permission mode in the equals spelling alone': [
    args((was) => was.replace(/--permission-mode (\S+)/, '--permission-mode=$1')),
    NOT_THE_INPUTS,
  ],
  'with a tool added to its arguments': [
    args((was) => was.replace('--allowedTools "', '--allowedTools "Bash,')),
    NOT_THE_INPUTS,
  ],
  'with an input the rule does not know': [
    (doc) =>
      void ((shape(doc).action['with'] as Record<string, unknown>)['settings'] =
        '{"permissions":{"defaultMode":"plan"}}'),
    NOT_THE_INPUTS,
  ],
  'with another secret as the credential of the action': [
    (doc) =>
      void ((shape(doc).action['with'] as Record<string, unknown>)['claude_code_oauth_token'] =
        '${{ secrets.OTHER }}'),
    NOT_THE_INPUTS,
  ],
  'with an environment on the installer of the managed settings': [
    (doc) => void (shape(doc).settings['env'] = { PATH: '/home/runner/work/bin' }),
    UNKNOWN_KEY('env'),
  ],
  'with the contents of claude-review.yml': [contentsOf('claude-review.yml'), NOT_THE_INSTALLER],
  'with the contents of claude.yml': [contentsOf('claude.yml'), NOT_THE_INSTALLER],
  'with the inputs written for the action of claude-review.yml': [
    inputsOf('claude-review.yml'),
    NOT_THE_INPUTS,
  ],
  'with the inputs written for the action of claude.yml': [inputsOf('claude.yml'), NOT_THE_INPUTS],
  'with another list of allowed bots': [
    (doc) => void ((shape(doc).action['with'] as Record<string, unknown>)['allowed_bots'] = '*'),
    NOT_THE_INPUTS,
  ],
  'with a second action in the job of the first': [
    (doc) => {
      const { steps, proof, action } = shape(doc);
      steps.push({ ...proof, id: 'again' }, { ...action, id: 'second' });
    },
    /a job runs more than one action/,
  ],
  'with a second action inside a group of parallel steps': [
    (doc) => void shape(doc).steps.push({ parallel: [{ ...BARE_ACTION }] }),
    /the action is used where no rule reads it/,
  ],
  'with an action inside a group of parallel steps of its first job': [
    (doc) => void firstSteps(doc).push({ parallel: [{ ...BARE_ACTION }] }),
    /the action is used where no rule reads it/,
  ],
  'with a group of parallel steps in the job of the action': [
    (doc) => void shape(doc).steps.unshift({ parallel: [{ run: 'true' }] }),
    UNKNOWN_KEY('parallel'),
  ],
  'with a default shell of the job that only checks the syntax': [
    (doc) => void (shape(doc).job['defaults'] = { run: { shell: 'bash -n {0}' } }),
    UNKNOWN_KEY('defaults'),
  ],
  'with a default shell of the workflow that only checks the syntax': [
    (doc) => void (doc['defaults'] = { run: { shell: 'bash -n {0}' } }),
    UNKNOWN_KEY('defaults'),
  ],
  'with a PATH of the job that the proof of bubblewrap would search': [
    (doc) => void (shape(doc).job['env'] = { PATH: '/home/runner/work/bin:/usr/bin:/bin' }),
    UNKNOWN_KEY('env'),
  ],
  'with a BASH_ENV of the workflow that the proof of bubblewrap would read': [
    (doc) => void (doc['env'] = { BASH_ENV: 'review-config/profile' }),
    UNKNOWN_KEY('env'),
  ],
  'in a container': [(doc) => void (shape(doc).job['container'] = 'ubuntu:24.04'), UNKNOWN_KEY('container')],
  'with the scrub in the environment of the job': [
    (doc) => void (shape(doc).job['env'] = { [SCRUB]: '1' }),
    /the scrub is set outside the step of an action/,
  ],
  'with a command that sets the scrub without the action': [
    (doc) => void firstSteps(doc).push({ run: 'claude -p review', env: { [SCRUB]: '1' } }),
    /the scrub is set outside the step of an action/,
  ],

  'with the action in a second job that proves nothing': [
    second({ ...BARE_ACTION, if: WAITS }),
    NOT_THE_PROOF,
  ],
  'with the base action in a second job': [
    second({ ...BARE_ACTION, uses: `anthropics/claude-code-base-action@${'0'.repeat(40)}` }),
    /another pin or another spelling/,
  ],
  'with a second job that runs the action in other capitals': [
    second({
      ...BARE_ACTION,
      uses: ACTION_PIN.replace('anthropics/claude-code-action', 'Anthropics/Claude-Code-Action'),
    }),
    /another pin or another spelling/,
  ],
  'with a scrubbed action added to its first job': [
    (doc) => void firstSteps(doc).push({ ...BARE_ACTION }),
    /runs the action, and the rule holds no entry under that name/,
  ],
  'that calls a workflow of another repository': [
    (doc) =>
      void (doc.jobs['called'] = { uses: `octo/reviews/.github/workflows/review.yml@${'0'.repeat(40)}` }),
    /calls a workflow of another repository/,
  ],
  'with a local action before its first step': [
    (doc) => void firstSteps(doc).unshift({ uses: './.github/actions/review' }),
    /uses a local action/,
  ],
  'on a floating runner label': [
    (doc) => void (shape(doc).job['runs-on'] = 'ubuntu-latest'),
    /image the proof is written for/,
  ],
  'on an image the proof of bubblewrap is not written for': [
    (doc) => void (shape(doc).job['runs-on'] = 'ubuntu-26.04'),
    /image the proof is written for/,
  ],

  'with managed settings whose installation may fail': [
    (doc) => void (shape(doc).settings['continue-on-error'] = true),
    UNKNOWN_KEY('continue-on-error'),
  ],
  'with managed settings installed after the action': [
    moved('settings', (steps, settings) => [...steps, settings]),
    /no step settings before the action/,
  ],
  'with an installer of the managed settings that ends before it installs': [
    (doc) => void (shape(doc).settings['run'] = `exit 0\n${String(shape(doc).settings['run'])}`),
    NOT_THE_INSTALLER,
  ],
  'with an installer of the managed settings on a condition of its own': [
    (doc) => void (shape(doc).settings['if'] = 'false'),
    /the step settings does not run on the condition of its job/,
  ],
};

/** The committed file as the rule reads it, parsed and written back, then broken: it passes before, not after. */
function brokenCopy(file: string, kind: string): { text: string; refusal: RegExp } {
  const broken = SHAPE_BREAKS[kind];
  assert.ok(broken !== undefined, `no broken workflow named "${kind}"`);
  const [breakIt, refusal] = broken;
  const doc = parse(readFileSync(join(ROOT, '.github/workflows', file), 'utf8')) as RawWorkflow;
  assertActions(file, stringify(doc));
  breakIt(doc);
  return { text: stringify(doc), refusal };
}

Then('{string} {} is rejected by the rule of bubblewrap', function (file: string, kind: string) {
  const { text, refusal } = brokenCopy(file, kind);
  assert.throws(() => assertActions(file, text), refusal);
});

Then('{string} {} is rejected by the rule of the permission mode', function (file: string, kind: string) {
  const breakIt = MODE_BREAKS[kind];
  if (breakIt === undefined) {
    const { text, refusal } = brokenCopy(file, kind);
    assert.throws(() => assertActions(file, text), refusal);
    return;
  }
  const original = readFileSync(join(ROOT, '.github/workflows', file), 'utf8');
  const broken = breakIt(original);
  assert.notEqual(broken, original);
  assert.throws(() => assertActions(file, broken));
});

Then(
  'managed settings that do not forbid {} are rejected by the rule of the permission mode',
  function (what: string) {
    for (const path of [
      '.github/claude/managed-settings.json',
      '.github/claude-review/managed-settings.json',
      '.github/claude-security-review/managed-settings.json',
    ]) {
      const settings = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as {
        permissions: Record<string, unknown> & { deny: string[] };
      };
      if (what === 'auto mode') delete settings.permissions['disableAutoMode'];
      else if (what === 'bypass mode') delete settings.permissions['disableBypassPermissionsMode'];
      else if (what === 'reads outside the checkout')
        delete settings.permissions['blockReadsOutsideWorkingDirectories'];
      else {
        const denied = SENSITIVE.find((rule) => rule.includes(what));
        assert.ok(denied !== undefined, `no denied path named "${what}"`);
        settings.permissions.deny = settings.permissions.deny.filter((rule) => rule !== denied);
      }
      assert.throws(() => assertModesForbidden(JSON.stringify(settings)), path);
    }
  },
);

Then(
  'a copy of {string} {} is refused among the workflow files, by its name',
  function (file: string, kind: string) {
    const { text, refusal } = brokenCopy(file, kind);
    const files = workflowTexts().map((entry) => (entry.file === file ? { file, text } : entry));
    assert.throws(
      () => workflowsOfTheAction(files),
      (error: Error) => error.message.startsWith(`${file}: `) && refusal.test(error.message),
    );
  },
);

Then(
  'the job of the @claude bot reads with its own token and writes with the token of the Claude app',
  function () {
    const doc = parse(readFileSync(join(ROOT, '.github/workflows/claude.yml'), 'utf8')) as {
      jobs: Record<string, { permissions?: unknown }>;
    };
    assert.deepEqual(
      Object.values(doc.jobs).map((job) => job.permissions),
      [{ contents: 'read', actions: 'read', 'id-token': 'write' }],
    );
  },
);
