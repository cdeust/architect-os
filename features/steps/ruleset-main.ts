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
 * The ruleset `value` describes, or an error whose words name what it lets through. Exact, not by presence: each rule
 * once, since a second rule of a type says something else than the first; the two jobs of the gate and no other
 * check; `refs/heads/main` and no other ref, since a pattern beside it would bring branches under a body written for
 * `main`; no excluded ref, since a pattern may match `main`.
 */
export function mainRuleset(value: unknown): MainRuleset {
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
  return ruleset;
}

const FILE = 'docs/design/ruleset-main.json';

/** The committed description, parsed and checked. */
export function committedMainRuleset(): MainRuleset {
  return mainRuleset(JSON.parse(readFileSync(join(ROOT, FILE), 'utf8')));
}

Given('the committed description of the ruleset of main', function () {
  this.state['ruleset-text'] = readFileSync(join(ROOT, FILE), 'utf8');
});

Then(
  'it describes a ruleset that no actor bypasses and that requires a pull request and the gate',
  function () {
    mainRuleset(JSON.parse(stored<string>(this, 'ruleset-text')));
  },
);

type Json = Record<string, any>;
const withoutRule = (type: string) => (r: Json) => {
  r['rules'] = r['rules'].filter((rule: Json) => rule['type'] !== type);
};
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
};

Then(
  'a description of the ruleset of main {} is refused with {string}',
  function (kind: string, words: string) {
    const breakIt = RULESET_BREAKS[kind];
    assert.ok(breakIt !== undefined, `no broken ruleset named "${kind}"`);
    const broken = JSON.parse(stored<string>(this, 'ruleset-text')) as Json;
    const before = JSON.stringify(broken);
    breakIt(broken);
    assert.notEqual(JSON.stringify(broken), before, 'the copy is not broken');
    assert.throws(
      () => mainRuleset(broken),
      (error: Error) => {
        assert.ok(error.message.includes(words), `refused with other words: ${error.message}`);
        return true;
      },
    );
  },
);
