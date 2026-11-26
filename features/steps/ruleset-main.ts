import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

/**
 * The one reader of docs/design/ruleset-main.json: the body that recreates the ruleset of `main`
 * (`gh api -X PUT repos/<owner>/<repo>/rulesets/<id> --input docs/design/ruleset-main.json`). Keys and values are
 * those of docs.github.com/en/rest/repos/rules ("Create a repository ruleset"), read on 26 November 2026; a key is
 * optional here when it is optional there. The schema is strict, so a key it does not know is refused; the rules
 * below it refuse a copy that weakens what the owner decided on that day (docs/infrastructure.md, "How a pull
 * request reaches main"): no actor bypasses, a pull request is required, both jobs of the gate are required, no
 * deletion, no rewrite.
 * It reads the committed file, never the setting GitHub applies: docs/infrastructure.md says who compares them.
 */
const RuleSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('deletion') }),
  z.strictObject({ type: z.literal('non_fast_forward') }),
  z.strictObject({
    type: z.literal('required_status_checks'),
    parameters: z.strictObject({
      strict_required_status_checks_policy: z.boolean(),
      do_not_enforce_on_create: z.boolean().optional(),
      required_status_checks: z.array(z.strictObject({ context: z.string().min(1) })),
    }),
  }),
  z.strictObject({
    type: z.literal('pull_request'),
    parameters: z.strictObject({
      required_approving_review_count: z.number().int().min(0),
      dismiss_stale_reviews_on_push: z.boolean(),
      required_reviewers: z
        .array(
          z.strictObject({
            file_patterns: z.array(z.string().min(1)),
            minimum_approvals: z.number().int().min(0),
            reviewer: z.strictObject({ id: z.number().int(), type: z.literal('Team') }),
          }),
        )
        .optional(),
      require_code_owner_review: z.boolean(),
      require_last_push_approval: z.boolean(),
      required_review_thread_resolution: z.boolean(),
      require_extra_approval_for_unattributed_changes: z.boolean().optional(),
      allowed_merge_methods: z
        .array(z.enum(['merge', 'squash', 'rebase']))
        .min(1)
        .optional(),
    }),
  }),
]);

const RulesetSchema = z.strictObject({
  name: z.string().min(1),
  target: z.literal('branch'),
  enforcement: z.enum(['active', 'disabled', 'evaluate']),
  conditions: z.strictObject({
    ref_name: z.strictObject({ include: z.array(z.string()), exclude: z.array(z.string()) }),
  }),
  bypass_actors: z.array(z.unknown()),
  rules: z.array(RuleSchema),
});

export type MainRuleset = z.infer<typeof RulesetSchema>;

const MAIN = 'refs/heads/main';
const RULES = ['deletion', 'non_fast_forward', 'required_status_checks', 'pull_request'] as const;
const GATE_JOBS = ['gate-linux', 'gate-macos'];

type Rule = MainRuleset['rules'][number];
const ruleOf = <T extends Rule['type']>(ruleset: MainRuleset, type: T): Extract<Rule, { type: T }>[] =>
  ruleset.rules.filter((rule): rule is Extract<Rule, { type: T }> => rule.type === type);

/** The contexts of the checks the ruleset requires, in the order of the file. */
export function requiredChecks(ruleset: MainRuleset): string[] {
  return ruleOf(ruleset, 'required_status_checks').flatMap((rule) =>
    rule.parameters.required_status_checks.map(({ context }) => context),
  );
}

/**
 * The policy the owner decided on 26 November 2026, value by value: what the live ruleset read that day, and what the
 * committed file must be. The named refusals of `mainRuleset` say what a weakened copy lets through; this says the
 * rest. A policy that is stricter (a required approval, strict checks) or other is refused too: it is a decision,
 * made by changing this value in the same pull request as the file.
 */
const DECIDED: MainRuleset = {
  name: 'main',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: [MAIN], exclude: [] } },
  bypass_actors: [],
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'gate-linux' }, { context: 'gate-macos' }],
      },
    },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        required_reviewers: [],
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        require_extra_approval_for_unattributed_changes: true,
        allowed_merge_methods: ['merge', 'squash', 'rebase'],
      },
    },
  ],
};

/** The first place where `actual` is not `expected`, as a path, or undefined when they are the same value. */
function firstDifference(actual: unknown, expected: unknown, path: string): string | undefined {
  if (typeof expected !== 'object' || expected === null || typeof actual !== 'object' || actual === null)
    return actual === expected ? undefined : path;
  if (Array.isArray(expected) !== Array.isArray(actual)) return path;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const at = firstDifference(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
      path === '' ? key : `${path}.${key}`,
    );
    if (at !== undefined) return at;
  }
  return undefined;
}

/**
 * The ruleset the text describes, or an error whose words name what it lets through. The text must be the canonical
 * form of what it parses to (two spaces, a final newline): `JSON.parse` keeps the last of two keys of the same name,
 * so a text that says `disabled` then `active` would otherwise be read as active. Then the shape, strict; then what a
 * weakened copy lets through, by name; then every value against the decided policy.
 */
export function mainRuleset(text: string): MainRuleset {
  const value = JSON.parse(text) as unknown;
  assert.equal(
    text,
    `${JSON.stringify(value, null, 2)}\n`,
    'the text is not the canonical form of what it parses to: a key written twice, or another layout',
  );
  const parsed = RulesetSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  const ruleset = parsed.data;
  assert.equal(ruleset.enforcement, 'active', `the ruleset is not enforced: ${ruleset.enforcement}`);
  assert.equal(ruleset.bypass_actors.length, 0, 'an actor may bypass the ruleset');
  const { include, exclude } = ruleset.conditions.ref_name;
  assert.ok(include.includes(MAIN), `${MAIN} is not among the included refs`);
  assert.equal(include.length, 1, `a ref other than ${MAIN} is included`);
  assert.equal(exclude.length, 0, 'a ref is excluded from the ruleset');
  for (const type of RULES) {
    const count = ruleOf(ruleset, type).length;
    assert.notEqual(count, 0, `no rule ${type}`);
    assert.equal(count, 1, `the rule ${type} is written ${count} times`);
  }
  const checks = requiredChecks(ruleset);
  for (const job of GATE_JOBS) assert.ok(checks.includes(job), `${job} is not a required check`);
  assert.equal(checks.length, GATE_JOBS.length, 'a check other than the two jobs of the gate is required');
  assert.notEqual(
    ruleOf(ruleset, 'required_status_checks')[0]!.parameters.do_not_enforce_on_create,
    true,
    'the checks are not required when the ref is created',
  );
  // source: .github/workflows/pipeline-after-merge.yml, `"merge_method": "squash"`.
  assert.ok(
    ruleOf(ruleset, 'pull_request')[0]!.parameters.allowed_merge_methods?.includes('squash') !== false,
    'the resolver merges by squash, which the ruleset does not allow',
  );
  const at = firstDifference(ruleset, DECIDED, '');
  assert.equal(
    at,
    undefined,
    `${at} is not the value decided on 26 November 2026: another policy, even a stricter one, changes the reader too`,
  );
  return ruleset;
}

const FILE = 'docs/design/ruleset-main.json';

/** The committed description, read and checked. */
export function committedMainRuleset(): MainRuleset {
  return mainRuleset(readFileSync(join(ROOT, FILE), 'utf8'));
}

Given('the committed description of the ruleset of main', function () {
  this.state['ruleset-text'] = readFileSync(join(ROOT, FILE), 'utf8');
});

Then(
  'it describes a ruleset that no actor bypasses and that requires a pull request and the gate',
  function () {
    mainRuleset(stored<string>(this, 'ruleset-text'));
  },
);

type Json = Record<string, any>;
const withoutRule = (type: string) => (r: Json) => {
  r['rules'] = r['rules'].filter((rule: Json) => rule['type'] !== type);
};
const pullRequestOf = (r: Json): Json =>
  r['rules'].find((rule: Json) => rule['type'] === 'pull_request')['parameters'];
const checksOf = (r: Json): Json =>
  r['rules'].find((rule: Json) => rule['type'] === 'required_status_checks')['parameters'];
const withoutCheck = (context: string) => (r: Json) => {
  const checks = checksOf(r);
  checks['required_status_checks'] = checks['required_status_checks'].filter(
    (check: Json) => check['context'] !== context,
  );
};
const RULESET_BREAKS: Record<string, (ruleset: Json) => void> = {
  'that the administrator role always bypasses': (r) => {
    r['bypass_actors'] = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
  },
  'that an app bypasses for pull requests': (r) => {
    r['bypass_actors'] = [{ actor_id: 1, actor_type: 'Integration', bypass_mode: 'pull_request' }];
  },
  'without the pull request rule': withoutRule('pull_request'),
  'without the required checks': withoutRule('required_status_checks'),
  'that does not require gate-linux': withoutCheck('gate-linux'),
  'that does not require gate-macos': withoutCheck('gate-macos'),
  'that is disabled': (r) => {
    r['enforcement'] = 'disabled';
  },
  'that only evaluates': (r) => {
    r['enforcement'] = 'evaluate';
  },
  'that includes another branch only': (r) => {
    r['conditions']['ref_name']['include'] = ['refs/heads/feat/gate-1a'];
  },
  'that includes a pattern beside main': (r) => {
    r['conditions']['ref_name']['include'] = [MAIN, 'refs/heads/*'];
  },
  'that excludes main': (r) => {
    r['conditions']['ref_name']['exclude'] = [MAIN];
  },
  'that excludes a pattern': (r) => {
    r['conditions']['ref_name']['exclude'] = ['refs/heads/ma*'];
  },
  'with a second rule of required checks that names none': (r) => {
    r['rules'].push({
      type: 'required_status_checks',
      parameters: { strict_required_status_checks_policy: false, required_status_checks: [] },
    });
  },
  'with the deletion rule twice': (r) => {
    r['rules'].push({ type: 'deletion' });
  },
  'that requires a third check': (r) => {
    checksOf(r)['required_status_checks'].push({ context: 'gate-windows' });
  },
  'that takes a check from one app only': (r) => {
    checksOf(r)['required_status_checks'][0]['integration_id'] = 15368;
  },
  'that does not require the checks when the ref is created': (r) => {
    checksOf(r)['do_not_enforce_on_create'] = true;
  },
  'that lets main be deleted': withoutRule('deletion'),
  'that lets main be rewritten': withoutRule('non_fast_forward'),
  'with an unknown key': (r) => {
    r['current_user_can_bypass'] = 'always';
  },
  'with an unknown key in the pull request rule': (r) => {
    r['rules'].find((rule: Json) => rule['type'] === 'pull_request')['parameters']['automatic'] = true;
  },
  'with a rule of an unknown type': (r) => {
    r['rules'].push({ type: 'merge_queue' });
  },
  'without its bypass list': (r) => {
    delete r['bypass_actors'];
  },
  'that allows the merge commit alone': (r) => {
    pullRequestOf(r)['allowed_merge_methods'] = ['merge'];
  },
  'that requires one approval': (r) => {
    pullRequestOf(r)['required_approving_review_count'] = 1;
  },
  'that requires a branch up to date': (r) => {
    checksOf(r)['strict_required_status_checks_policy'] = true;
  },
  'under another name': (r) => {
    r['name'] = 'default';
  },
  'with its rules in another order': (r) => {
    r['rules'].reverse();
  },
};
/** Copies that are broken in their text, which no parsed value can carry. */
const TEXT_BREAKS: Record<string, (text: string) => string> = {
  'that says disabled, then active': (text) =>
    text.replace(
      '  "enforcement": "active",\n',
      '  "enforcement": "disabled",\n  "enforcement": "active",\n',
    ),
  'on one line': (text) => `${JSON.stringify(JSON.parse(text))}\n`,
};

Then(
  'a description of the ruleset of main {} is refused with {string}',
  function (kind: string, words: string) {
    const original = stored<string>(this, 'ruleset-text');
    const breakText = TEXT_BREAKS[kind];
    const breakIt = RULESET_BREAKS[kind];
    assert.ok(breakText !== undefined || breakIt !== undefined, `no broken ruleset named "${kind}"`);
    let broken: string;
    if (breakText !== undefined) broken = breakText(original);
    else {
      const value = JSON.parse(original) as Json;
      breakIt!(value);
      broken = `${JSON.stringify(value, null, 2)}\n`;
    }
    assert.notEqual(broken, original, 'the copy is not broken');
    assert.throws(
      () => mainRuleset(broken),
      (error: Error) => {
        assert.ok(error.message.includes(words), `refused with other words: ${error.message}`);
        return true;
      },
    );
  },
);
