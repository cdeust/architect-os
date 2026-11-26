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
const USERS_OF_THE_ACTION = ['claude.yml', 'claude-review.yml', 'claude-security-review.yml'];

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
const INSTALL = [
  'set -euo pipefail',
  'sudo install -D -m 0644 -o root -g root review-config/.github/claude-review/managed-settings.json /etc/claude-code/managed-settings.json',
  'sudo install -D -m 0755 -o root -g root review-config/.github/claude-review/comment-guard.py /etc/claude-code/comment-guard.py',
  'rm -rf review-config',
].join('\n');
const CLAUDE_ARGS = [
  '--strict-mcp-config',
  '--permission-mode default',
  '--allowedTools "mcp__github_inline_comment__create_inline_comment"',
  '--model "claude-opus-5-5"',
];

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
  assert.equal(steps[restrict]?.run?.trim(), INSTALL);
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
  assert.deepEqual(String(inputs['claude_args']).trim().split('\n'), CLAUDE_ARGS);
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
  for (const file of USERS_OF_THE_ACTION) {
    const text = readFileSync(join(ROOT, '.github/workflows', file), 'utf8');
    const pins = [...text.matchAll(/anthropics\/claude-code-action@[0-9a-f]{40}/g)].map((match) => match[0]);
    assert.ok(pins.length > 0, `${file} does not use the action`);
    for (const pin of pins) assert.equal(pin, ACTION_PIN, `${file} pins another commit`);
  }
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
 * Every workflow that runs the action fixes its permission mode and installs managed settings that forbid the auto
 * and bypass modes, before the action starts: a new pin cannot change the mode in silence (from v1.0.290 the action
 * starts a session in auto mode unless `allowed_bots` is set, src/modes/permission-mode.ts).
 */
const MODES = ['default', 'acceptEdits'];
const MANAGED = '/etc/claude-code/managed-settings.json';

export function assertModeFixed(text: string): void {
  const doc = parse(text) as { jobs: Record<string, { steps?: StepT[] }> };
  const jobs = Object.values(doc.jobs).filter((job) =>
    (job.steps ?? []).some((step) => step.uses?.startsWith('anthropics/claude-code-action@')),
  );
  assert.ok(jobs.length > 0, 'no job runs the action');
  for (const job of jobs) {
    const steps = job.steps ?? [];
    const action = steps.findIndex((step) => step.uses?.startsWith('anthropics/claude-code-action@'));
    // Every action of the job, not the first alone: a second one would start under the defaults of the action.
    for (const step of steps.filter((each) => each.uses?.startsWith('anthropics/claude-code-action@'))) {
      const args = String(step.with?.['claude_args'] ?? '');
      assert.deepEqual(
        step.env,
        { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' },
        'the environment of the subprocesses is not scrubbed of the credentials',
      );
      const modes = [...args.matchAll(/--permission-mode\s+(\S+)/g)].map((match) => match[1]);
      assert.equal(modes.length, 1, 'the permission mode is not set once');
      assert.ok(MODES.includes(modes[0] ?? ''), `permission mode ${modes[0]}`);
    }
    const install = steps.findIndex((step) => (step.run ?? '').includes(` ${MANAGED}`));
    assert.ok(install >= 0 && install < action, 'no managed settings installed before the action');
    const source = (steps[install]?.run ?? '').match(
      / (\S+\/managed-settings\.json) \/etc\/claude-code\/managed-settings\.json/,
    )?.[1];
    assert.ok(source !== undefined, 'the source of the managed settings is not named');
    const checkout = steps
      .slice(0, install)
      .find((step) => source.startsWith(`${String(step.with?.['path'])}/`));
    assert.ok(checkout !== undefined, 'the managed settings come from no checkout of the run');
    assert.equal(checkout.with?.['ref'], '${{ github.sha }}');
    assert.equal(
      checkout.with?.['sparse-checkout-cone-mode'],
      false,
      'the settings checkout brings more than its directory',
    );
    assert.equal(checkout.with?.['persist-credentials'], false);
    const committed = source.slice(String(checkout.with?.['path']).length + 1);
    assert.equal(checkout.with?.['sparse-checkout'], committed.slice(0, committed.lastIndexOf('/')));
    assertModesForbidden(readFileSync(join(ROOT, committed), 'utf8'));
  }
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

Then(
  'every workflow that runs the action fixes its mode and forbids auto and bypass:',
  function (table: { raw(): string[][] }) {
    for (const [file] of table.raw()) {
      assertModeFixed(readFileSync(join(ROOT, '.github/workflows', String(file)), 'utf8'));
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

Then('{string} {} is rejected by the rule of the permission mode', function (file: string, kind: string) {
  const breakIt = MODE_BREAKS[kind];
  assert.ok(breakIt !== undefined, `no broken workflow named "${kind}"`);
  const original = readFileSync(join(ROOT, '.github/workflows', file), 'utf8');
  const broken = breakIt(original);
  assert.notEqual(broken, original);
  assert.throws(() => assertModeFixed(broken));
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

/**
 * The rule of bubblewrap. With `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, Claude Code refuses to start on Linux without
 * bubblewrap, in which it runs its Bash subprocesses in a PID namespace (code.claude.com/docs/en/env-vars, "What the
 * subprocess environment scrub removes"; run 45771449067 of claude-security-review.yml). The action installs it only
 * when `allowed_non_write_users` is set, in a step that may fail (action.yml at 4411a9e9, "Install subprocess isolation
 * dependencies"), so a job that runs the action does what that step does and fails when it cannot: the packages, the
 * sysctl without which Ubuntu 24.04 refuses a user namespace to an unprivileged program, then a namespace really
 * created.
 *
 * The rule is closed, so that no action starts without a proof that succeeded. In every workflow file of the
 * directory, found and not listed: the scrub is set on the step of an action and nowhere else; a job runs one action
 * at most; the step just before it is the proof, with these lines and no key but its name and the condition of the
 * action, which names no status function (`always()`, `failure()`, `cancelled()`, `success()`); nothing of the job or
 * of the workflow reaches the shell of the proof (`defaults`, `env`, `container`); the image is the one the proof is
 * written for; no job calls a workflow of another repository and no step a local action, where an action would hide.
 * What it cannot see: an action of another repository that wraps this one, and what a step before the proof leaves in
 * `GITHUB_PATH` or `GITHUB_ENV`.
 */
const SCRUB = 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB';
const SCRUB_IMAGE = 'ubuntu-24.04';
/**
 * The action, its `base-action` directory, and the repository of the base action, in any case: GitHub reads the
 * owner and the name of an action without regard to case.
 */
const ENGINE = /^anthropics\/claude-code-(base-)?action[/@]/i;
const STATUS_FUNCTION = /\b(always|failure|cancelled|success)\s*\(/;
const BUBBLEWRAP_PROOF = [
  'set -euo pipefail',
  'sudo apt-get update',
  'sudo apt-get install -y --no-install-recommends bubblewrap socat',
  'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
  'bwrap --version',
  'bwrap --unshare-user --unshare-pid --ro-bind / / --proc /proc true',
].join('\n');

type RawStep = Record<string, unknown>;
interface RawJob {
  [key: string]: unknown;
  steps?: RawStep[];
}
interface RawWorkflow {
  [key: string]: unknown;
  jobs: Record<string, RawJob>;
}
const runsTheAction = (step: RawStep): boolean =>
  typeof step['uses'] === 'string' && ENGINE.test(step['uses']);
const provesBubblewrap = (step: RawStep): boolean =>
  typeof step['run'] === 'string' && /\b(bwrap|bubblewrap)\b/.test(step['run']);
const setsTheScrub = (env: unknown): boolean => typeof env === 'object' && env !== null && SCRUB in env;

/** Refuses a workflow where an action could start without a proof that succeeded; the number of its actions. */
export function assertBubblewrapProven(text: string): number {
  const doc = parse(text) as RawWorkflow;
  assert.ok(!setsTheScrub(doc['env']), 'the scrub is set outside the step of an action');
  let actions = 0;
  for (const [id, job] of Object.entries(doc.jobs)) {
    assert.ok(!setsTheScrub(job['env']), 'the scrub is set outside the step of an action');
    if (typeof job['uses'] === 'string') {
      assert.ok(
        job['uses'].startsWith('./.github/workflows/'),
        `job ${id} calls a workflow of another repository, where an action would hide`,
      );
      continue;
    }
    const steps = job.steps ?? [];
    for (const step of steps) {
      assert.ok(
        runsTheAction(step) || !setsTheScrub(step['env']),
        'the scrub is set outside the step of an action',
      );
      assert.ok(
        !(typeof step['uses'] === 'string' && step['uses'].startsWith('./')),
        `job ${id} uses a local action, where an action would hide`,
      );
    }
    const found = steps.flatMap((step, at) => (runsTheAction(step) ? [at] : []));
    if (found.length === 0) continue;
    actions += found.length;
    assert.equal(found.length, 1, `job ${id} runs more than one action for one proof`);
    const at = found[0] as number;
    const action = steps[at] as RawStep;
    assert.equal(job['runs-on'], SCRUB_IMAGE, 'the job does not run on the image the proof is written for');
    assert.equal(job['container'], undefined, 'the job runs in a container, not on the image');
    assert.equal(doc['env'], undefined, 'an environment of the workflow reaches the proof of bubblewrap');
    assert.equal(job['env'], undefined, 'an environment of the job reaches the proof of bubblewrap');
    for (const holder of [doc, job]) {
      assert.equal(
        holder['defaults'],
        undefined,
        'a default of the workflow or of the job reaches the proof',
      );
    }
    const proofs = steps.flatMap((step, index) => (provesBubblewrap(step) ? [index] : []));
    assert.equal(proofs.length, 1, 'bubblewrap is not proven once');
    assert.equal(proofs[0], at - 1, 'the proof of bubblewrap is not the step just before the action');
    const proof = steps[at - 1] as RawStep;
    assert.equal(String(proof['run']).trim(), BUBBLEWRAP_PROOF, 'the step is not the proof of bubblewrap');
    // No `continue-on-error`, `shell`, `env` nor `working-directory`; and the condition of the action, or none.
    assert.deepEqual(
      Object.keys(proof)
        .filter((key) => key !== 'if')
        .sort(),
      ['name', 'run'],
      'the proof of bubblewrap has a key that may hide its failure',
    );
    assert.equal(proof['if'], action['if'], 'the proof and the action do not run on the same condition');
    assert.ok(
      !STATUS_FUNCTION.test(String(action['if'] ?? '')),
      'the action can run after a proof that failed',
    );
  }
  return actions;
}

const workflowTexts = (): { file: string; text: string }[] => {
  const dir = join(ROOT, '.github/workflows');
  return readdirSync(dir)
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
};

/** The files that run an action, each judged by the rule of bubblewrap and by the rule of the permission mode. */
function workflowsOfTheAction(files: { file: string; text: string }[]): string[] {
  return files
    .filter(({ file, text }) => {
      try {
        if (assertBubblewrapProven(text) === 0) return false;
        assertModeFixed(text);
        return true;
      } catch (error) {
        throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    })
    .map(({ file }) => file);
}

Then(
  'every action of every workflow file starts just after the proof of bubblewrap, and the files that run one are exactly:',
  function (table: { raw(): string[][] }) {
    assert.deepEqual(workflowsOfTheAction(workflowTexts()), table.raw().flat().sort());
  },
);

const PINNED_ACTION = {
  uses: ACTION_PIN,
  env: { [SCRUB]: '1' },
  with: { claude_args: '--permission-mode default' },
};

/** The one job of the committed workflow that runs the action, its proof and its action. */
function proven(doc: RawWorkflow): { job: RawJob; steps: RawStep[]; proof: RawStep; action: RawStep } {
  const job = Object.values(doc.jobs).find((candidate) => (candidate.steps ?? []).some(runsTheAction));
  assert.ok(job !== undefined, 'the committed workflow runs no action');
  const steps = job.steps ?? [];
  const proof = steps.find(provesBubblewrap);
  const action = steps.find(runsTheAction);
  assert.ok(
    proof !== undefined && action !== undefined,
    'the committed workflow no longer proves bubblewrap',
  );
  return { job, steps, proof, action };
}
const firstJob = (doc: RawWorkflow): RawJob => Object.values(doc.jobs)[0] as RawJob;
const withoutLine = (doc: RawWorkflow, line: string): void => {
  const { proof } = proven(doc);
  const run = String(proof['run']);
  assert.ok(run.includes(`${line}\n`), `the committed proof no longer has: ${line}`);
  proof['run'] = run.replace(`${line}\n`, '');
};
const underStatus = (doc: RawWorkflow, status: string): void => {
  const { proof, action } = proven(doc);
  const condition = action['if'] === undefined ? status : `${status} && ${String(action['if'])}`;
  proof['if'] = condition;
  action['if'] = condition;
};

/** A broken copy, and the words of the refusal it must get: a copy refused for another reason proves nothing. */
const BUBBLEWRAP_BREAKS: Record<string, [(doc: RawWorkflow) => void, RegExp]> = {
  'without the proof of bubblewrap': [
    (doc) => {
      const { job, steps } = proven(doc);
      job.steps = steps.filter((step) => !provesBubblewrap(step));
    },
    /not proven once/,
  ],
  'with the proof of bubblewrap after the action': [
    (doc) => {
      const { job, steps, proof } = proven(doc);
      job.steps = [...steps.filter((step) => step !== proof), proof];
    },
    /not the step just before the action/,
  ],
  'with a step between the proof of bubblewrap and the action': [
    (doc) => {
      const { steps, action } = proven(doc);
      steps.splice(steps.indexOf(action), 0, {
        name: 'Restrict again',
        run: 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1',
      });
    },
    /not the step just before the action/,
  ],
  'with a proof of bubblewrap that may fail': [
    (doc) => {
      proven(doc).proof['continue-on-error'] = true;
    },
    /may hide its failure/,
  ],
  'with a shell on the proof of bubblewrap that only checks its syntax': [
    (doc) => {
      proven(doc).proof['shell'] = 'bash -n {0}';
    },
    /may hide its failure/,
  ],
  'with a default shell of the job that only checks the syntax': [
    (doc) => {
      proven(doc).job['defaults'] = { run: { shell: 'bash -n {0}' } };
    },
    /a default of the workflow or of the job/,
  ],
  'with a default shell of the workflow that only checks the syntax': [
    (doc) => {
      doc['defaults'] = { run: { shell: 'bash -n {0}' } };
    },
    /a default of the workflow or of the job/,
  ],
  'with a proof of bubblewrap on another condition than the action': [
    (doc) => {
      proven(doc).proof['if'] = "runner.os == 'macOS'";
    },
    /same condition/,
  ],
  'with the proof of bubblewrap and the action under always()': [
    (doc) => underStatus(doc, 'always()'),
    /after a proof that failed/,
  ],
  'with the proof of bubblewrap and the action under !cancelled()': [
    (doc) => underStatus(doc, '!cancelled()'),
    /after a proof that failed/,
  ],
  'with the proof of bubblewrap and the action under failure()': [
    (doc) => underStatus(doc, 'failure()'),
    /after a proof that failed/,
  ],
  'with a second action for an event the proof of bubblewrap does not cover': [
    (doc) => {
      const { steps, proof, action } = proven(doc);
      proof['if'] = "github.event_name == 'issues'";
      action['if'] = "github.event_name == 'issues'";
      steps.push({ ...action, id: 'second', if: "github.event_name == 'issue_comment'" });
    },
    /more than one action for one proof/,
  ],
  'with the action in a second job that proves nothing': [
    (doc) => {
      doc.jobs['second'] = { 'runs-on': SCRUB_IMAGE, steps: [{ ...proven(doc).action }] };
    },
    /not proven once/,
  ],
  'with the base action in a second job that proves nothing': [
    (doc) => {
      doc.jobs['second'] = {
        'runs-on': SCRUB_IMAGE,
        steps: [{ ...PINNED_ACTION, uses: `anthropics/claude-code-base-action@${'0'.repeat(40)}` }],
      };
    },
    /not proven once/,
  ],
  'with the action written in capitals in a second job that proves nothing': [
    (doc) => {
      doc.jobs['second'] = {
        'runs-on': SCRUB_IMAGE,
        steps: [
          {
            ...PINNED_ACTION,
            uses: ACTION_PIN.replace('anthropics/claude-code-action', 'Anthropics/Claude-Code-Action'),
          },
        ],
      };
    },
    /not proven once/,
  ],
  'with a scrubbed action added to its first job': [
    (doc) => {
      (firstJob(doc).steps as RawStep[]).push({ ...PINNED_ACTION });
    },
    /not proven once/,
  ],
  'with a command that sets the scrub without the action': [
    (doc) => {
      (firstJob(doc).steps as RawStep[]).push({ run: 'claude -p review', env: { [SCRUB]: '1' } });
    },
    /scrub is set outside the step of an action/,
  ],
  'with the scrub in the environment of the job': [
    (doc) => {
      proven(doc).job['env'] = { [SCRUB]: '1' };
    },
    /scrub is set outside the step of an action/,
  ],
  'with the scrub in the environment of the workflow': [
    (doc) => {
      doc['env'] = { [SCRUB]: '1' };
    },
    /scrub is set outside the step of an action/,
  ],
  'with a PATH of the job that the proof of bubblewrap would search': [
    (doc) => {
      proven(doc).job['env'] = { PATH: '/home/runner/work/bin:/usr/bin:/bin' };
    },
    /an environment of the job reaches the proof/,
  ],
  'with a BASH_ENV of the workflow that the proof of bubblewrap would read': [
    (doc) => {
      doc['env'] = { BASH_ENV: 'review-config/profile' };
    },
    /an environment of the workflow reaches the proof/,
  ],
  'in a container': [
    (doc) => {
      proven(doc).job['container'] = 'ubuntu:24.04';
    },
    /in a container, not on the image/,
  ],
  'that calls a workflow of another repository': [
    (doc) => {
      doc.jobs['called'] = { uses: `octo/reviews/.github/workflows/review.yml@${'0'.repeat(40)}` };
    },
    /calls a workflow of another repository/,
  ],
  'with a local action before its first step': [
    (doc) => {
      (firstJob(doc).steps as RawStep[]).unshift({ uses: './.github/actions/review' });
    },
    /uses a local action/,
  ],
  'that installs bubblewrap without proving it': [
    (doc) => {
      const { proof } = proven(doc);
      proof['run'] = String(proof['run']).split('\nbwrap ')[0] + '\n';
    },
    /not the proof of bubblewrap/,
  ],
  'that reads the version of bubblewrap and creates no namespace': [
    (doc) => {
      const { proof } = proven(doc);
      proof['run'] = String(proof['run']).replace(/\nbwrap --unshare-user[^\n]*\n?$/, '\n');
    },
    /not the proof of bubblewrap/,
  ],
  'that leaves user namespaces restricted': [
    (doc) => withoutLine(doc, 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'),
    /not the proof of bubblewrap/,
  ],
  'whose proof of bubblewrap goes on after a failure': [
    (doc) => withoutLine(doc, 'set -euo pipefail'),
    /not the proof of bubblewrap/,
  ],
  'on a floating runner label': [
    (doc) => {
      proven(doc).job['runs-on'] = 'ubuntu-latest';
    },
    /image the proof is written for/,
  ],
  'on an image the proof of bubblewrap is not written for': [
    (doc) => {
      proven(doc).job['runs-on'] = 'ubuntu-26.04';
    },
    /image the proof is written for/,
  ],
};

/** The committed file as the rule reads it, parsed and written back, then broken: it passes before, not after. */
function brokenCopy(file: string, kind: string): { text: string; refusal: RegExp } {
  const broken = BUBBLEWRAP_BREAKS[kind];
  assert.ok(broken !== undefined, `no broken workflow named "${kind}"`);
  const [breakIt, refusal] = broken;
  const doc = parse(readFileSync(join(ROOT, '.github/workflows', file), 'utf8')) as RawWorkflow;
  assertBubblewrapProven(stringify(doc));
  breakIt(doc);
  return { text: stringify(doc), refusal };
}

Then('{string} {} is rejected by the rule of bubblewrap', function (file: string, kind: string) {
  const { text, refusal } = brokenCopy(file, kind);
  assert.throws(() => assertBubblewrapProven(text), refusal);
});

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
