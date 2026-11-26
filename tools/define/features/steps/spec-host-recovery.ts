import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPlanningJournal } from '../../src/infrastructure/planning-journal.js';
import { Then } from '@cucumber/cucumber';
import { specHostJournal, specPlanningConfig, type SpecHostJournal } from '@architect-os/contracts';
import { actionDigest, driveSpec, type SpecHost } from '../../src/application/drive-spec.js';

const run = 'run_host_bound';
const author = { provider: 'openai', model: 'author' };
const reviewer = { provider: 'google', model: 'reviewer' };
const account = (route: typeof author) => ({
  route,
  quota: 2,
  account: route.provider,
  billing: 'subscription',
});

const failed = { kind: 'failed', step: 'audit', reason: 'end' };
const question = {
  kind: 'ask_user',
  question_id: 'q',
  header: 'Choose',
  description: 'Select',
  options: null,
  multi_select: false,
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const json = (value: unknown) => JSON.stringify(value) + '\n';
function page(action: unknown, offset = 0, count = 1, total = 1, next_offset: number | null = null) {
  return { run_id: run, action, __page: { offset, count, total, next_offset } };
}
function fixture() {
  const config = specPlanningConfig.parse({
    producer_sha256: 'a'.repeat(64),
    feature_description: 'Bind evidence',
    plan_step: 'audit',
    drafter: account(author),
    reviewer: account(reviewer),
  });
  let state: SpecHostJournal | undefined;
  const files = new Map<string, string>();
  const host: SpecHost = {
    load: () => structuredClone(state),
    save(value) {
      state = structuredClone(value);
    },
    call: async () => assert.fail('unexpected producer call'),
    authorize: async () => assert.fail('unexpected authorization'),
    invoke: async () => assert.fail('unexpected model turn'),
    readArtifact(path) {
      assert.ok(files.has(path));
      return Buffer.from(files.get(path)!);
    },
    writeArtifact(path, content) {
      assert.ok(!files.has(path));
      files.set(path, content);
    },
  };
  return { host, files, config };
}
Then('the Spec host verifies the {string} terminal projection', async function (change: string) {
  const { host, files, config } = fixture();
  const handoff = {
    version: 1,
    run_id: run,
    requirements: [{ id: 'FR-1', text: 'Bind.' }],
    acceptance: [{ id: 'AC-1', text: 'Verify.', requirement_ids: ['FR-1'] }],
  };
  const define = json({ handoff });
  const proposal = { step: 'audit', objective: 'Bind.', verification: 'Verify.', acceptance_ids: ['AC-1'] };
  const binding = {
    version: 1,
    run_id: run,
    define_sha256: hash(define),
    proposal_sha256: hash(json(proposal)),
  };
  const digest = hash(json(binding));
  const axis = { status: 'clear', citations: [] };
  const actor = (route: typeof author, slot: string) =>
    change === slot ? { ...route, model: 'different' } : route;
  const receipt = {
    reviewed_plan: {
      ...binding,
      plan_sha256: digest,
      proposal,
      drafter: actor(author, 'Plan author'),
      reviewer: actor(reviewer, 'Plan review'),
      verdict: { plan_sha256: digest, status: 'clear', findings: [] },
    },
    define_review: {
      version: 1,
      define_sha256: binding.define_sha256,
      input_sha256: hash(define),
      drafter: actor(author, 'Define author'),
      reviewer: actor(reviewer, 'Define review'),
      axes: { scope_creep: axis, missing_edge_case: axis },
    },
  };
  host.call = async (tool, args) => {
    if (tool === 'start_pipeline') {
      assert.deepEqual(args, {
        feature_description: config.feature_description,
        plan_step: 'audit',
        prd_context: undefined,
        request_size: undefined,
      });
      return json({ run_id: run });
    }
    assert.equal(tool, 'get_pipeline_state');
    if (args['format'] === 'action') {
      assert.deepEqual(args, { run_id: run, format: 'action', invocation_offset: 0 });
      return json(page({ kind: 'done', summary: 'complete', outcome: { status: 'passed', reasons: [] } }));
    }
    if (args['format'] === 'define_handoff_v1') {
      assert.deepEqual(args, { run_id: run, format: 'define_handoff_v1' });
      return define.trimEnd();
    }
    assert.deepEqual(args, { run_id: run, format: 'reviewed_plan_v1', plan_step: 'audit' });
    return JSON.stringify(receipt);
  };
  if (['Define author', 'Define review', 'Plan author', 'Plan review'].includes(change)) {
    await assert.rejects(driveSpec(host, config, false), /SPEC_PROJECTION_ROUTE_MISMATCH/);
    assert.equal(files.size, 0);
    return;
  }
  const outcome = { status: 'reviewed', run_id: run, step: 'audit' };
  assert.deepEqual(await driveSpec(host, config, false), outcome);
  assert.equal(files.get('define.json'), define);
  const written = files.get('reviewed-plan.json')!;
  assert.deepEqual(JSON.parse(written), receipt);
  assert.equal(written, json(JSON.parse(written)));
  assert.deepEqual(host.load()?.terminal, {
    define_sha256: hash(define),
    reviewed_plan_sha256: hash(written),
  });
  host.call = async () => assert.fail('terminal replay contacted producer');
  if (change === 'reviewed') assert.deepEqual(await driveSpec(host, config, true), outcome);
  else {
    files.set(change === 'changed Define' ? 'define.json' : 'reviewed-plan.json', 'changed');
    await assert.rejects(driveSpec(host, config, true), /SPEC_TERMINAL_ARTIFACT_CHANGED/);
  }
});

Then('the Spec host handles the {string} transaction', async function (change: string) {
  const { host, config } = fixture();
  const expected = { kind: 'user_answer', question_id: 'q', selected: ['choice'], freeform: 'notes' };
  const state: SpecHostJournal = {
    version: 1,
    run_id: run,
    config_sha256: actionDigest(config),
    history: [],
  };
  if (change === 'interrupted start') delete state.run_id;
  if (change === 'changed config') state.config_sha256 = 'b'.repeat(64);
  if (change === 'changed action' || change === 'uncertain submission' || change === 'acknowledged submit') {
    state.history.push({
      action: {
        kind: 'ask_user',
        question_id: 'q',
        header: 'Choose',
        description: 'Select',
        options: null,
        multi_select: false,
      },
      phase: change === 'changed action' ? 'pending' : 'submitting',
      reservations: [],
      receipts: [],
    });
  }
  if (change !== 'resume without state') host.save(state);
  let submitted = 0;
  host.call = async (tool, args) => {
    if (tool === 'submit_action_result') {
      assert.deepEqual(args, { run_id: run, result: expected });
      ++submitted;
      return json({ run_id: change === 'foreign submit run' ? 'run_other_id' : run });
    }
    assert.equal(tool, 'get_pipeline_state');
    assert.equal(args['format'], 'action');
    return json(
      page(submitted || change === 'changed action' || change === 'acknowledged submit' ? failed : question),
    );
  };
  const answer = {
    run_id: change === 'foreign answer run' ? 'run_wrong_id' : run,
    action_sha256: change === 'stale answer' ? 'e'.repeat(64) : actionDigest(question),
    selected: ['choice'],
    freeform: 'notes',
  };
  const drive = driveSpec(host, config, change !== 'new with state', answer);
  const errors: Record<string, string> = {
    'resume without state': 'SPEC_RUN_JOURNAL_MISMATCH',
    'new with state': 'SPEC_RUN_JOURNAL_MISMATCH',
    'changed config': 'SPEC_RUN_JOURNAL_MISMATCH',
    'interrupted start': 'SPEC_START_OUTCOME_UNKNOWN',
    'changed action': 'SPEC_PENDING_ACTION_CHANGED',
    'uncertain submission': 'SPEC_SUBMISSION_OUTCOME_UNKNOWN',
    'foreign answer run': 'SPEC_ANSWER_MISMATCH',
    'stale answer': 'SPEC_ANSWER_MISMATCH',
    'foreign submit run': 'SPEC_ACTION_RUN_MISMATCH',
  };
  if (errors[change]) await assert.rejects(drive, new RegExp(errors[change]));
  else {
    assert.deepEqual(await drive, { status: 'failed', run_id: run, action: failed });
    assert.equal(host.load()?.history[0]?.phase, 'acknowledged');
  }
  assert.equal(submitted, ['bound answer', 'foreign submit run'].includes(change) ? 1 : 0);
});

function batch(id: string) {
  return {
    kind: 'spawn_subagents',
    purpose: 'draft',
    batch_id: 'batch',
    invocations: [
      {
        invocation_id: id,
        subagent_type: 'writer',
        description: 'Draft',
        prompt: 'Write',
        model: author.model,
        model_route: author,
        isolation: 'none',
      },
    ],
  };
}
Then('the Spec host refuses the {string} page', async function (change: string) {
  const { host, config } = fixture();
  let reads = 0;
  host.call = async (tool, args) => {
    if (tool === 'start_pipeline') return json({ run_id: run });
    assert.equal(tool, 'get_pipeline_state');
    assert.ok(++reads <= 2);
    const later = reads === 2;
    const offset = later ? 1 : 0;
    assert.equal(args['invocation_offset'], offset);
    const action = batch(later && change !== 'duplicate turn' ? 'second' : 'first');
    if (later && change === 'next batch') action.batch_id = 'swapped';
    if (later && change === 'next purpose') action.purpose = 'review';
    const value = page(
      (later && change === 'next kind') || change === 'paginated question' ? question : action,
      offset,
      1,
      2,
      later ? null : 1,
    );
    if (change === 'other run' || (later && change === 'next run')) value.run_id = 'run_other_id';
    if (change === 'initial offset' || (later && change === 'next offset')) value.__page.offset = 9;
    if (change === 'surplus duplicate') {
      action.invocations.push(action.invocations[0]!);
      value.__page = { offset: 0, count: 2, total: 1, next_offset: null };
    }
    if (change === 'count') value.__page.count = 0;
    if (change === 'total changed' && later) value.__page.total = 3;
    if (change === 'excess turns') value.__page.total = 0;
    if (change === 'offset gap') value.__page.next_offset = 0;
    if (change === 'past total') value.__page.total = 1;
    if (change === 'missing last page') value.__page.next_offset = null;
    return json(value);
  };
  const runMismatch = ['other run', 'initial offset'].includes(change);
  const changed = change.startsWith('next ');
  await assert.rejects(
    driveSpec(host, config, false),
    new RegExp(
      runMismatch
        ? 'SPEC_ACTION_RUN_MISMATCH'
        : changed
          ? 'SPEC_ACTION_PAGE_CHANGED'
          : 'SPEC_ACTION_PAGE_INVALID',
    ),
  );
  if (
    [
      'excess turns',
      'past total',
      'offset gap',
      'missing last page',
      'other run',
      'initial offset',
      'paginated question',
      'count',
    ].includes(change)
  )
    assert.equal(reads, 1);
});
Then('the Spec host checks {string} before accepting a native result', async function (change: string) {
  const { host, config } = fixture();
  const policy = structuredClone(config);
  if (change === 'conflicting quota')
    policy.panel_reviewer = {
      ...policy.reviewer,
      route: { ...policy.reviewer.route, model: 'panel' },
      quota: 1,
    };
  const action = batch('turn');
  if (change === 'changed model') action.invocations[0]!.model = 'wrong';
  const normal = { invocation_id: 'turn', raw_text: 'a result', model_receipt: author };
  const resumed = ['recover complete turn', 'missing receipt'].includes(change);
  if (resumed)
    host.save({
      version: 1,
      config_sha256: actionDigest(policy),
      run_id: run,
      history: [
        {
          action: {
            kind: 'spawn_subagents',
            purpose: 'draft',
            batch_id: 'batch',
            invocations: [
              { ...action.invocations[0]!, isolation: 'none', model_route: policy.drafter.route },
            ],
          },
          phase: 'dispatching',
          receipts: [
            {
              ...normal,
              model_receipt: policy.drafter.route,
              invocation_id: change === 'missing receipt' ? 'other' : 'turn',
            },
          ],
          reservations: [],
        },
      ],
    });
  let calls = 0;
  let result: unknown;
  host.call = async (tool, args) => {
    if (tool === 'start_pipeline') return json({ run_id: run });
    if (tool === 'submit_action_result') {
      assert.equal(result, undefined);
      result = args['result'];
      return json({ run_id: run });
    }
    return json(page(result ? failed : action));
  };
  host.authorize = async () => {
    if (change === 'authorize error') throw Error('account unavailable');
    return true;
  };
  host.invoke = async () => {
    ++calls;
    if (change === 'native exception') throw Error('unavailable');
    return {
      text: change === 'empty text' ? '  ' : 'a result',
      account: author.provider,
      billing: (change === 'native billing' ? 'metered' : 'subscription') as 'subscription',
      route: {
        provider: change === 'native provider' ? 'google' : 'openai',
        model: change === 'native model' ? 'other' : author.model,
      },
    };
  };
  const drive = driveSpec(host, policy, resumed);
  if (change === 'conflicting quota' || change === 'missing receipt') {
    await assert.rejects(
      drive,
      new RegExp(
        change === 'conflicting quota' ? 'SPEC_ACCOUNT_QUOTA_CONFLICT' : 'SPEC_INVOCATION_OUTCOME_UNKNOWN',
      ),
    );
    assert.equal(result, undefined);
    assert.equal(calls, 0);
    return;
  }
  assert.equal((await drive).status, 'failed');
  const denied = ['authorize error', 'changed model'].includes(change);
  assert.deepEqual(result, {
    kind: 'subagent_batch_result',
    batch_id: 'batch',
    responses: [
      resumed
        ? normal
        : {
            invocation_id: 'turn',
            error: denied ? 'SPEC_ACCOUNT_OR_QUOTA_REFUSED' : 'SPEC_NATIVE_RECEIPT_REFUSED',
          },
    ],
  });
  assert.equal(calls, denied || resumed ? 0 : 1);
});

Then('the Spec host checkpoints each side effect and safely resubmits recorded writes', async function () {
  const { host, config } = fixture();
  const item = { kind: 'write_file' as const, path: 'prd-output/run_host/file', content: 'hello' };
  const result = { kind: 'file_written' as const, path: item.path, bytes: 5 };
  const saved: SpecHostJournal[] = [];
  const store = host.save;
  host.save = (state) => {
    saved.push(structuredClone(state));
    store(state);
  };
  let count = 0;
  host.call = async (tool) => {
    if (tool === 'start_pipeline') {
      assert.deepEqual(saved, [{ version: 1, config_sha256: actionDigest(config), history: [] }]);
      return json({ run_id: run });
    }
    if (tool === 'submit_action_result') {
      count++;
      assert.equal(host.load()?.history.at(-1)?.phase, 'submitting');
      return json({ run_id: run });
    }
    if (count === 0) assert.equal(host.load()?.run_id, run);
    return json(page(count ? failed : item));
  };
  await driveSpec(host, config, false);
  const phases = saved.map((s) => {
    const e = s.history.at(-1);
    return [e?.phase, Boolean(e?.result)];
  });
  assert.deepEqual(phases, [
    [undefined, false],
    [undefined, false],
    ['pending', false],
    ['pending', true],
    ['submitting', true],
    ['acknowledged', true],
    ['pending', false],
  ]);
  assert.equal(count, 1);
  assert.deepEqual(saved[3]!.history.at(-1)?.result, result);
  host.save(saved[3]!);
  count = 0;
  host.writeArtifact = () => assert.fail('replayed a completed write');
  assert.equal((await driveSpec(host, config, true)).status, 'failed');
  assert.equal(count, 1);
});

Then('the Spec host audits the {string} mixed batch', async function (change: string) {
  const { host, config } = fixture();
  const policy = structuredClone(config);
  const panel = { ...policy.reviewer, route: { ...policy.reviewer.route, model: 'panel' } };
  policy.panel_reviewer = panel;
  const source = batch('first');
  const second = {
    ...source.invocations[0]!,
    invocation_id: 'second',
    model: panel.route.model,
    model_route: panel.route,
  };
  source.invocations.push(second);
  const action = {
    kind: 'spawn_subagents' as const,
    purpose: 'draft' as const,
    batch_id: source.batch_id,
    invocations: source.invocations.map((i) => ({
      ...i,
      isolation: 'none' as const,
      model_route: i === second ? panel.route : policy.drafter.route,
    })),
  };
  const replay = change.includes('receipt');
  const state: SpecHostJournal = {
    version: 1,
    config_sha256: actionDigest(policy),
    run_id: run,
    history: [],
  };
  const first = { invocation_id: 'first', raw_text: 'first', model_receipt: policy.drafter.route };
  const other = { invocation_id: 'second', raw_text: 'second', model_receipt: panel.route };
  if (replay)
    state.history.push({
      phase: 'dispatching',
      action,
      receipts: change === 'surplus receipts' ? [first, other, other] : [first, first],
      reservations: [],
    });
  if (change === 'exhausted reviewer')
    state.history.push({
      phase: 'acknowledged',
      action: { kind: 'failed', step: 'prior', reason: 'prior' },
      receipts: [],
      reservations: [
        JSON.stringify([panel.route.provider, panel.account]),
        JSON.stringify([panel.route.provider, panel.account]),
      ],
    });
  if (change === 'ambiguous earlier batch') {
    state.history.push(
      { phase: 'dispatching', action, receipts: [first], reservations: [] },
      {
        phase: 'acknowledged',
        action: { kind: 'failed', step: 'prior', reason: 'prior' },
        receipts: [],
        reservations: [],
      },
    );
  }
  host.save(state);
  let submissions = 0;
  let turns = 0;
  host.call = async (tool, args) => {
    if (tool === 'submit_action_result') {
      assert.equal(++submissions, 1);
      const responses =
        change === 'successful panel'
          ? [first, other]
          : ['first', 'second'].map((invocation_id) => ({
              invocation_id,
              error: 'SPEC_ACCOUNT_OR_QUOTA_REFUSED',
            }));
      assert.deepEqual(args['result'], {
        kind: 'subagent_batch_result',
        batch_id: action.batch_id,
        responses,
      });
      return json({ run_id: run });
    }
    assert.equal(tool, 'get_pipeline_state');
    return json(page(submissions ? failed : action, 0, 2, 2));
  };
  host.authorize = async (a) => change !== 'unauthenticated author' || a.account !== author.provider;
  host.invoke = async (i, a) => {
    ++turns;
    return { route: a.route, account: a.account, billing: a.billing, text: i.invocation_id };
  };
  const drive = driveSpec(host, policy, true);
  if (change === 'ambiguous earlier batch') {
    await assert.rejects(drive, /SPEC_INVOCATION_OUTCOME_UNKNOWN/);
    assert.equal(turns, 0);
    assert.equal(submissions, 0);
    return;
  }
  if (replay) await assert.rejects(drive, /SPEC_INVOCATION_OUTCOME_UNKNOWN/);
  else assert.equal((await drive).status, 'failed');
  assert.equal(turns, change === 'successful panel' ? 2 : 0);
  assert.equal(submissions, replay ? 0 : 1);
});
Then('the Spec host rejects a malformed producer run identifier', async function () {
  for (const raw of [json({ run_id: 'bad' }), 'null']) {
    const { host, config } = fixture();
    host.call = async (tool) => {
      assert.equal(tool, 'start_pipeline');
      return raw;
    };
    await assert.rejects(driveSpec(host, config, false), { name: 'ZodError' });
    assert.equal(host.load()?.run_id, undefined);
  }
});

Then('the Spec host acknowledges the same producer file twice', async function () {
  const { host, config } = fixture();
  let submissions = 0;
  let writes = 0;
  host.call = async (tool, args) => {
    if (tool === 'start_pipeline') return json({ run_id: run });
    if (tool === 'submit_action_result') {
      assert.deepEqual(args['result'], { kind: 'file_written', path: 'prd-output/run_host/note', bytes: 4 });
      assert.ok(++submissions <= 2);
      return json({ run_id: run });
    }
    return json(
      page(
        submissions === 2
          ? failed
          : { kind: 'write_file', path: 'prd-output/run_host/note', content: 'note' },
      ),
    );
  };
  host.writeArtifact = (path, text) => {
    assert.equal(path, 'note');
    assert.equal(text, 'note');
    writes++;
  };
  assert.equal((await driveSpec(host, config, false)).status, 'failed');
  assert.equal(writes, 2);
});

Then(
  'the Spec host resumes {string} batch evidence as {string}',
  async function (change: string, outcome: string) {
    const { host, config } = fixture();
    const action = batch('one');
    const firstInvocation = action.invocations[0]!;
    action.invocations.push({
      ...firstInvocation,
      invocation_id: 'two',
      model: reviewer.model,
      model_route: reviewer,
    });
    const accepted = { invocation_id: 'one', raw_text: '  useful result  ', model_receipt: { ...author } };
    const refused = { invocation_id: 'two', error: 'SPEC_NATIVE_RECEIPT_REFUSED' };
    const recorded = [refused, accepted];
    const denied = action.invocations.map(({ invocation_id }) => ({
      invocation_id,
      error: 'SPEC_ACCOUNT_OR_QUOTA_REFUSED',
    }));
    const saved = change.startsWith('saved');
    const expected = change === 'saved quota refusal' ? denied : [accepted, refused];
    const result = { kind: 'subagent_batch_result', batch_id: 'batch', responses: structuredClone(expected) };
    const entry: Record<string, unknown> = {
      action,
      phase: 'dispatching',
      receipts: recorded,
      reservations: ['["openai","openai"]', '["google","google"]'],
    };
    if (saved) entry['result'] = result;
    if (change === 'wrong provider' || change === 'saved wrong provider')
      accepted.model_receipt.provider = 'anthropic';
    if (change === 'wrong route model') firstInvocation.model_route = { ...author, model: 'alternate' };
    if (change === 'wrong requested model') firstInvocation.model = 'alternate';
    if (change === 'saved changed response route')
      Object.assign(result.responses[0]!, { model_receipt: reviewer });
    if (change === 'saved changed native text')
      Object.assign(result.responses[0]!, { raw_text: 'rewritten' });
    if (change === 'saved reordered responses') result.responses.reverse();
    if (change === 'saved missing response') result.responses.pop();
    if (change === 'duplicate stored invocation') action.invocations[1]!.invocation_id = 'one';
    if (change === 'saved wrong batch') result.batch_id = 'another';
    if (change === 'saved wrong result kind') entry['result'] = { kind: 'file_written', path: 'x', bytes: 1 };
    if (change === 'saved quota refusal' || change === 'saved response without calls') {
      entry['receipts'] = [];
      entry['reservations'] = [];
      entry['phase'] = 'pending';
    }
    if (change === 'saved refusal after reserving') {
      entry['receipts'] = [];
      result.responses = denied;
    }
    if (change === 'pending with receipts') {
      entry['phase'] = 'pending';
      entry['reservations'] = [];
    }
    if (change === 'pending with reservations') {
      entry['phase'] = 'pending';
      entry['receipts'] = [];
    }
    if (change === 'submitting without result') {
      entry['phase'] = 'submitting';
      entry['receipts'] = [];
      entry['reservations'] = [];
    }
    if (change === 'pending saved native') {
      entry['phase'] = 'pending';
      entry['result'] = result;
    }
    if (change === 'dispatching saved quota') {
      entry['result'] = { ...result, responses: denied };
      entry['receipts'] = [];
      entry['reservations'] = [];
    }
    if (change === 'pristine pending') {
      entry['phase'] = 'pending';
      entry['receipts'] = [];
      entry['reservations'] = [];
      host.authorize = async () => true;
      host.invoke = async (inv, account) => {
        if (inv.invocation_id === 'two') throw Error('offline');
        return {
          account: account.account,
          billing: account.billing,
          route: account.route,
          text: accepted.raw_text,
        };
      };
    }
    if (change.startsWith('nonbatch')) {
      entry['action'] = question;
      if (change === 'nonbatch with batch result') {
        entry['receipts'] = [];
        entry['result'] = result;
      }
    }
    host.save(
      specHostJournal.parse({
        version: 1,
        run_id: run,
        config_sha256: actionDigest(config),
        history: [entry],
      }),
    );
    let producerCalls = 0;
    let submissions = 0;
    host.call = async (tool, args) => {
      producerCalls++;
      if (tool === 'submit_action_result') {
        assert.equal(++submissions, 1);
        assert.deepEqual(args['result'], {
          kind: 'subagent_batch_result',
          batch_id: 'batch',
          responses: expected,
        });
        return json({ run_id: run });
      }
      assert.equal(tool, 'get_pipeline_state');
      return json(page(submissions ? failed : action, 0, 2, 2));
    };
    const drive = driveSpec(host, config, true);
    if (outcome === 'accepted') {
      assert.equal((await drive).status, 'failed');
      assert.equal(submissions, 1);
    } else {
      const reasons: Record<string, string> = {
        'native refusal': 'SPEC_NATIVE_RECEIPT_REFUSED',
        unknown: 'SPEC_INVOCATION_OUTCOME_UNKNOWN',
        mismatch: 'SPEC_SAVED_RESULT_MISMATCH',
      };
      await assert.rejects(drive, new RegExp(reasons[outcome]!));
      assert.equal(producerCalls, 0);
    }
  },
);

Then('a stored invocation identifier alone cannot be submitted on recovery', async function () {
  const { host, config } = fixture();
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'spec-receipt-')));
  try {
    const journal = openPlanningJournal(join(root, 'run'));
    try {
      const entry = {
        action: batch('one'),
        phase: 'dispatching',
        receipts: [{ invocation_id: 'one' }],
        reservations: ['["openai","openai"]'],
      };
      writeFileSync(
        join(journal.home, '.host.json'),
        json({ version: 1, config_sha256: actionDigest(config), run_id: run, history: [entry] }),
        { mode: 0o600 },
      );
      await assert.rejects(driveSpec({ ...host, ...journal }, config, true), { name: 'ZodError' });
    } finally {
      journal.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
