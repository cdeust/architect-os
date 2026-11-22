import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import {
  specActionPage,
  specHostAction,
  specHostAnswer,
  specHostJournal,
  specHostResult,
  specPlanningConfig,
} from '../../src/spec-pipeline.js';

const run_id = 'run_def1_2026';
const digest = '0123456789abcdef'.repeat(4);
const route = { provider: 'openai', model: 'draft-v2.1:latest' };
const answer = { run_id, action_sha256: digest, selected: ['one'], freeform: 'detail' };
const action = { kind: 'write_file', path: 'part.md', content: 'é' };

function invocation(invocation_id: string, effort: string) {
  return {
    invocation_id,
    subagent_type: 'planner',
    description: 'Review inputs',
    prompt: 'Inspect scope.',
    model: route.model,
    model_route: route,
    isolation: 'none',
    effort,
  };
}

Then(
  'a Spec action page preserves two {string} invocations for {string}',
  function (effort: string, purpose: string) {
    const invocations = ['first', 'second'].map((id) => invocation(id, effort));
    const page = {
      run_id,
      action: { kind: 'spawn_subagents', purpose, batch_id: 'drafts', invocations },
      __page: { offset: 0, count: 2, total: 3, next_offset: 2 },
    };
    assert.deepEqual(specActionPage.parse(page), page);
    assert.equal(
      specActionPage.safeParse({ ...page, action: { ...page.action, invocations: [] } }).success,
      false,
    );
  },
);

Then('a Spec clarification defaults to single selection', function () {
  const question = {
    kind: 'ask_user',
    question_id: 'scope',
    header: 'Scope',
    description: 'Why?',
    options: null,
  };
  assert.deepEqual(specHostAction.parse(question), { ...question, multi_select: false });
});

Then('the Spec host action round-trips the wire document', function (document: string) {
  const input: unknown = JSON.parse(document);
  assert.deepEqual(specHostAction.parse(input), input);
});

Then('the Spec host result round-trips the wire document', function (document: string) {
  const input: unknown = JSON.parse(document);
  assert.deepEqual(specHostResult.parse(input), input);
});

Then('a Spec action page rejects {string} set to {word}', function (field: string, value: string) {
  const pagination = { offset: 0, count: 1, total: 1, next_offset: null };
  const page = { run_id, action, __page: { ...pagination, [field]: JSON.parse(value) } };
  assert.equal(specActionPage.safeParse(page).success, false);
});

Then('the Spec host answer round-trips its run, digest, selections and freeform', function () {
  assert.deepEqual(specHostAnswer.parse(answer), answer);
});

Then('the Spec host answer rejects {string}', function (change: string) {
  const invalid: Record<string, object> = {
    'prefixed run': { run_id: '!' + run_id },
    'suffixed run': { run_id: run_id + '!' },
    'prefixed digest': { action_sha256: '!' + digest },
    'suffixed digest': { action_sha256: digest + '!' },
    'unrecognized field': { unauthorized: true },
  };
  assert.ok(Object.hasOwn(invalid, change));
  assert.equal(specHostAnswer.safeParse({ ...answer, ...invalid[change] }).success, false);
});

function journal(phase: string, model = route.model) {
  const first = invocation('first', 'medium');
  const batch = { kind: 'spawn_subagents', purpose: 'draft', batch_id: 'drafts', invocations: [first] };
  const receipt = {
    invocation_id: first.invocation_id,
    raw_text: ' Plan. ',
    model_receipt: { ...route, model },
  };
  const result = { kind: 'subagent_batch_result', batch_id: batch.batch_id, responses: [receipt] };
  return {
    version: 1,
    config_sha256: digest,
    run_id,
    ...(phase === 'acknowledged'
      ? { terminal: { define_sha256: 'a'.repeat(64), reviewed_plan_sha256: 'b'.repeat(64) } }
      : {}),
    history: [
      {
        action: batch,
        phase,
        reservations: phase === 'pending' ? [] : ['["openai","drafter"]'],
        receipts: phase === 'pending' ? [] : [receipt],
        ...(phase === 'submitting' || phase === 'acknowledged' ? { result } : {}),
      },
    ],
  };
}

Then('the saved Spec journal preserves phase {string} and its full record', function (phase: string) {
  const saved = journal(phase);
  assert.deepEqual(specHostJournal.parse(saved), saved);
});

Then('a Spec journal receipt rejects model {string}', function (model: string) {
  assert.equal(specHostJournal.safeParse(journal('dispatching', model)).success, false);
});

const config = {
  bundle_sha256: digest,
  feature_description: '  Plan delivery.  ',
  plan_step: 'draft-2',
  drafter: { route, account: 'drafter', billing: 'subscription', quota: 2 },
  reviewer: {
    route: { provider: 'google', model: 'gemini-2' },
    account: 'reviewer',
    billing: 'subscription',
    quota: 1,
  },
};

Then(
  'a Spec request preserves {string} and {string} and trims its description',
  function (prd_context: string, request_size: string) {
    const request = { ...config, prd_context, request_size };
    assert.deepEqual(specPlanningConfig.parse(request), {
      ...request,
      feature_description: 'Plan delivery.',
    });
  },
);

Then('a Spec request rejects field {string} with value {string}', function (field: string, value: string) {
  assert.equal(specPlanningConfig.safeParse({ ...config, [field]: value }).success, false);
});

Then(
  'the Spec wire result and persisted receipts both reject the {string} native outcome',
  function (change: string) {
    const shapes: Record<string, object> = {
      'missing outcome': {},
      'missing route': { raw_text: 'ok' },
      'missing text': { model_receipt: route },
      'blank text': { raw_text: '  ', model_receipt: route },
      'blank error': { error: ' ' },
      'success and error': { raw_text: 'ok', model_receipt: route, error: 'refused' },
      'error with route': { model_receipt: route, error: 'refused' },
      'error with text': { raw_text: 'ok', error: 'refused' },
      'empty identity': { invocation_id: '', error: 'refused' },
    };
    assert.ok(Object.hasOwn(shapes, change));
    const receipt = { invocation_id: 'first', ...shapes[change] };
    const result = { kind: 'subagent_batch_result', batch_id: 'drafts', responses: [receipt] };
    assert.equal(specHostResult.safeParse(result).success, false);
    const saved = journal('dispatching');
    const entry = saved.history[0]!;
    assert.equal(
      specHostJournal.safeParse({ ...saved, history: [{ ...entry, receipts: [receipt] }] }).success,
      false,
    );
    assert.equal(specHostJournal.safeParse({ ...saved, history: [{ ...entry, result }] }).success, false);
  },
);
