import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    const args = String(steps[action]?.with?.['claude_args'] ?? '');
    assert.deepEqual(
      steps[action]?.env,
      { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' },
      'the environment of the subprocesses is not scrubbed of the credentials',
    );
    const modes = [...args.matchAll(/--permission-mode\s+(\S+)/g)].map((match) => match[1]);
    assert.equal(modes.length, 1, 'the permission mode is not set once');
    assert.ok(MODES.includes(modes[0] ?? ''), `permission mode ${modes[0]}`);
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
 * bubblewrap, in which it runs its subprocesses in a PID namespace (code.claude.com/docs/en/env-vars, "What the
 * subprocess environment scrub removes"; run 45771449067 of claude-security-review.yml). The action installs it only
 * when `allowed_non_write_users` is set, in a step that may fail (action.yml at 4411a9e9, "Install subprocess isolation
 * dependencies"), so every job that runs the action does what that step does, before the action, and fails when it
 * cannot: the packages, the sysctl without which Ubuntu 24.04 refuses a user namespace to an unprivileged program,
 * then a namespace really created. The image is named, since the proof is written for one.
 */
const SCRUB_IMAGE = 'ubuntu-24.04';
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
  'runs-on'?: unknown;
  steps?: RawStep[];
}
const runsTheAction = (step: RawStep): boolean =>
  typeof step['uses'] === 'string' && step['uses'].startsWith('anthropics/claude-code-action@');
const provesBubblewrap = (step: RawStep): boolean =>
  typeof step['run'] === 'string' && /\b(bwrap|bubblewrap)\b/.test(step['run']);

/** The jobs of a parsed workflow that run the action. */
function jobsOfTheAction(doc: { jobs: Record<string, RawJob> }): RawJob[] {
  return Object.values(doc.jobs).filter((job) => (job.steps ?? []).some(runsTheAction));
}

export function assertBubblewrapProven(text: string): void {
  const jobs = jobsOfTheAction(parse(text) as { jobs: Record<string, RawJob> });
  assert.ok(jobs.length > 0, 'no job runs the action');
  for (const job of jobs) {
    assert.equal(job['runs-on'], SCRUB_IMAGE, 'the job does not run on the image the proof is written for');
    const steps = job.steps ?? [];
    const action = steps.findIndex(runsTheAction);
    const proofs = steps.flatMap((step, at) => (provesBubblewrap(step) ? [at] : []));
    assert.equal(proofs.length, 1, 'bubblewrap is not proven once');
    const proof = steps[proofs[0] as number] as RawStep;
    assert.ok((proofs[0] as number) < action, 'bubblewrap is proven after the action started');
    assert.equal(String(proof['run']).trim(), BUBBLEWRAP_PROOF, 'the step is not the proof of bubblewrap');
    // No `continue-on-error`, `shell`, `env` nor `working-directory`; and the condition of the action, or none.
    assert.deepEqual(
      Object.keys(proof)
        .filter((key) => key !== 'if')
        .sort(),
      ['name', 'run'],
      'the proof of bubblewrap has a key that may hide its failure',
    );
    assert.equal(
      proof['if'],
      steps[action]?.['if'],
      'the proof and the action do not run on the same condition',
    );
  }
}

Then(
  'every workflow that runs the action proves bubblewrap before it, on a named image:',
  function (table: { raw(): string[][] }) {
    for (const [file] of table.raw()) {
      assertBubblewrapProven(readFileSync(join(ROOT, '.github/workflows', String(file)), 'utf8'));
    }
  },
);

const proofOf = (job: RawJob): RawStep => {
  const proof = (job.steps ?? []).find(provesBubblewrap);
  assert.ok(proof !== undefined, 'the committed workflow no longer proves bubblewrap');
  return proof;
};
const withoutLine = (job: RawJob, line: string): void => {
  const proof = proofOf(job);
  const run = String(proof['run']);
  assert.ok(run.includes(`${line}\n`), `the committed proof no longer has: ${line}`);
  proof['run'] = run.replace(`${line}\n`, '');
};

/** A broken copy, and the words of the refusal it must get: a copy refused for another reason proves nothing. */
const BUBBLEWRAP_BREAKS: Record<string, [(job: RawJob) => void, RegExp]> = {
  'without the proof of bubblewrap': [
    (job) => {
      job.steps = (job.steps ?? []).filter((step) => !provesBubblewrap(step));
    },
    /not proven once/,
  ],
  'with the proof of bubblewrap after the action': [
    (job) => {
      const proof = proofOf(job);
      job.steps = [...(job.steps ?? []).filter((step) => step !== proof), proof];
    },
    /after the action started/,
  ],
  'with a proof of bubblewrap that may fail': [
    (job) => {
      proofOf(job)['continue-on-error'] = true;
    },
    /may hide its failure/,
  ],
  'with a proof of bubblewrap on another condition than the action': [
    (job) => {
      proofOf(job)['if'] = "runner.os == 'macOS'";
    },
    /same condition/,
  ],
  'that installs bubblewrap without proving it': [
    (job) => {
      const proof = proofOf(job);
      proof['run'] = String(proof['run']).split('\nbwrap ')[0] + '\n';
    },
    /not the proof of bubblewrap/,
  ],
  'that reads the version of bubblewrap and creates no namespace': [
    (job) => {
      proofOf(job)['run'] = String(proofOf(job)['run']).replace(/\nbwrap --unshare-user[^\n]*\n?$/, '\n');
    },
    /not the proof of bubblewrap/,
  ],
  'that leaves user namespaces restricted': [
    (job) => withoutLine(job, 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'),
    /not the proof of bubblewrap/,
  ],
  'whose proof of bubblewrap goes on after a failure': [
    (job) => withoutLine(job, 'set -euo pipefail'),
    /not the proof of bubblewrap/,
  ],
  'on a floating runner label': [
    (job) => {
      job['runs-on'] = 'ubuntu-latest';
    },
    /image the proof is written for/,
  ],
  'on an image the proof of bubblewrap is not written for': [
    (job) => {
      job['runs-on'] = 'ubuntu-26.04';
    },
    /image the proof is written for/,
  ],
};

Then('{string} {} is rejected by the rule of bubblewrap', function (file: string, kind: string) {
  const broken = BUBBLEWRAP_BREAKS[kind];
  assert.ok(broken !== undefined, `no broken workflow named "${kind}"`);
  const [breakIt, refusal] = broken;
  const original = readFileSync(join(ROOT, '.github/workflows', file), 'utf8');
  const doc = parse(original) as { jobs: Record<string, RawJob> };
  // The copy as the rule reads it: parsed and written back, it still passes before it is broken.
  assertBubblewrapProven(stringify(doc));
  for (const job of jobsOfTheAction(doc)) breakIt(job);
  assert.throws(() => assertBubblewrapProven(stringify(doc)), refusal);
});

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
