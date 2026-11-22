import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { specPlanningConfig, type SpecHostJournal, type SpecHostResult } from '@architect-os/contracts';
import { driveSpec, type SpecHost } from '../../src/application/drive-spec.js';
import { openPlanningJournal } from '../../src/infrastructure/planning-journal.js';

const run_id = 'run_test_fixture';
const author = { provider: 'openai', model: 'fixture-author' };
const review = { provider: 'google', model: 'fixture-reviewer' };
const account = (route: typeof author, quota: number) => ({
  route,
  quota,
  account: route.provider,
  billing: 'subscription',
});
const turn = (id: string, route: typeof author = author) => ({
  invocation_id: id,
  prompt: 'Synthetic input',
  subagent_type: 'fixture',
  description: 'Synthetic turn',
  model: route.model,
  model_route: route,
  isolation: 'none',
});

function harness(change: string) {
  let state: SpecHostJournal | undefined;
  let result: SpecHostResult | undefined;
  let invoked = 0;
  let acknowledged = 0;
  let pause = true;
  const config = specPlanningConfig.parse({
    bundle_sha256: 'a'.repeat(64),
    feature_description: 'A synthetic request',
    plan_step: 'delivery',
    drafter: account(author, change === 'quota' ? 1 : 2),
    reviewer: account(review, 2),
  });
  const host: SpecHost = {
    async call(tool, args) {
      if (tool === 'start_pipeline') return JSON.stringify({ run_id });
      if (tool === 'submit_action_result') {
        acknowledged++;
        if (change === 'revised batch' && acknowledged === 1) return JSON.stringify({ run_id });
        if (change === 'reissued batch') return JSON.stringify({ run_id });
        result = args['result'] as SpecHostResult;
        return JSON.stringify({ run_id });
      }
      const offset = Number(args['invocation_offset']);
      const action = result
        ? {
            kind: 'done',
            summary: '',
            outcome: { status: 'needs_attention', reasons: ['fixture'] },
          }
        : change === 'foreign action'
          ? {
              kind: 'call_pipeline_tool',
            }
          : {
              kind: 'spawn_subagents',
              purpose: 'draft',
              batch_id: offset && change === 'changed page' ? 'swapped' : 'test',
              invocations: [
                offset === 0
                  ? turn('first')
                  : turn(
                      'second',
                      change === 'unknown route' ? { provider: 'anthropic', model: 'unauthorized' } : author,
                    ),
              ],
            };
      if (change === 'revised batch' && acknowledged === 1 && action.invocations) {
        for (const invocation of action.invocations) invocation.prompt = 'Correlate the revised input';
      }
      return JSON.stringify({
        run_id,
        action,
        __page: { offset, count: 1, total: 2, next_offset: !result && offset === 0 ? 1 : null },
      });
    },
    async authorize() {
      return change !== 'denied account';
    },
    async invoke(_inv, identity) {
      invoked++;
      return {
        route: identity.route,
        account: change === 'wrong receipt' ? 'different' : identity.account,
        billing: identity.billing,
        text: 'synthetic result',
      };
    },
    load: () => structuredClone(state),
    save(next) {
      const entry = next.history.at(-1);
      if (
        pause &&
        ((change === 'interrupted turn' && entry?.receipts.length === 1) ||
          (change === 'saved result' && entry?.result))
      ) {
        pause = false;
        throw Error('SIMULATED_HOST_CRASH');
      }
      state = structuredClone(next);
    },
    readArtifact() {
      assert.fail('A refused plan must not read a handoff');
    },
    writeArtifact() {
      assert.fail('A refused plan must not write a handoff');
    },
  };
  return { host, config, calls: () => invoked, submitted: () => result };
}

Then('Spec planning handles {string} without an unapproved model call', async function (change: string) {
  const { host, config, calls, submitted } = harness(change);
  if (change === 'changed page' || change === 'foreign action') {
    await assert.rejects(driveSpec(host, config, false));
    assert.equal(calls(), 0);
    assert.equal(submitted(), undefined);
  } else if (change === 'interrupted turn') {
    await assert.rejects(driveSpec(host, config, false), /SIMULATED_HOST_CRASH/);
    const count = calls();
    await assert.rejects(driveSpec(host, config, true), /SPEC_INVOCATION_OUTCOME_UNKNOWN/);
    assert.equal(calls(), count);
    assert.equal(submitted(), undefined);
  } else {
    const receiptFailure = change === 'wrong receipt';
    assert.equal((await driveSpec(host, config, false)).status, 'needs_attention');
    assert.equal(calls(), receiptFailure ? 2 : 0);
    const result = submitted();
    assert.equal(result?.kind, 'subagent_batch_result');
    for (const reply of result!.responses) {
      assert.ok('error' in reply);
      assert.equal(
        reply.error,
        receiptFailure ? 'SPEC_NATIVE_RECEIPT_REFUSED' : 'SPEC_ACCOUNT_OR_QUOTA_REFUSED',
      );
      assert.equal('model_receipt' in reply, false);
    }
  }
});

Then('Spec planning reuses the saved model result before submission', async function () {
  const { host, config, calls, submitted } = harness('saved result');
  await assert.rejects(driveSpec(host, config, false), /SIMULATED_HOST_CRASH/);
  assert.equal(calls(), 2);
  assert.equal(submitted(), undefined);
  assert.equal((await driveSpec(host, config, true)).status, 'needs_attention');
  assert.equal(calls(), 2);
  const result = submitted();
  assert.equal(result?.kind, 'subagent_batch_result');
  assert.deepEqual(
    result!.responses.map(({ invocation_id }) => invocation_id),
    ['first', 'second'],
  );
});

Then('the Spec run directory admits a single writer', function () {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-spec-journal-')));
  try {
    const path = join(root, 'run');
    const writer = openPlanningJournal(path);
    try {
      assert.throws(() => openPlanningJournal(path), /SPEC_JOURNAL_IN_USE/);
      writer.writeArtifact('define.json', 'exact bytes');
      assert.throws(() => writer.writeArtifact('define.json', 'changed'), /SPEC_ARTIFACT_CONFLICT/);
      assert.throws(() => writer.writeArtifact('../escape', ''), /SPEC_ARTIFACT_PATH_REFUSED/);
    } finally {
      writer.release();
    }
    const resumed = openPlanningJournal(path);
    try {
      resumed.writeArtifact('define.json', 'exact bytes');
      resumed.writeArtifact('corrupted.json', '�');
      writeFileSync(join(path, 'corrupted.json'), Buffer.from([0xff]));
      assert.throws(() => resumed.writeArtifact('corrupted.json', '�'), /SPEC_ARTIFACT_CONFLICT/);
    } finally {
      resumed.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Then('Spec planning refuses a batch reissued after acknowledgment', async function () {
  const { host, config, calls } = harness('reissued batch');
  await assert.rejects(driveSpec(host, config, false), /SPEC_ACKNOWLEDGED_BATCH_REISSUED/);
  assert.equal(calls(), 2);
  await assert.rejects(driveSpec(host, config, true), /SPEC_ACKNOWLEDGED_BATCH_REISSUED/);
  assert.equal(calls(), 2);
});

Then('Spec planning surfaces a clarification with label-only choices', async function () {
  const { host, config, calls } = harness('clarification');
  const read = host.call;
  host.call = (tool, args) =>
    tool === 'get_pipeline_state'
      ? Promise.resolve(
          JSON.stringify({
            run_id,
            action: {
              kind: 'ask_user',
              question_id: 'clarification_answer',
              header: 'Select a source',
              description: 'Which source applies?',
              options: [{ label: 'First' }, { label: 'Second' }],
            },
            __page: { offset: 0, count: 0, total: 0, next_offset: null },
          }),
        )
      : read(tool, args);
  const outcome = await driveSpec(host, config, false);
  assert.equal(outcome.status, 'question');
  assert.deepEqual(outcome.action.options, [{ label: 'First' }, { label: 'Second' }]);
  assert.equal(calls(), 0);
});

Then('Spec planning allows a new prompt on the same batch identifier', async function () {
  const { host, config, calls } = harness('revised batch');
  config.drafter.quota = 4;
  assert.equal((await driveSpec(host, config, false)).status, 'needs_attention');
  assert.equal(calls(), 4);
});

Then('Spec planning distinguishes an independent panel from a conflicting route', function () {
  const { config } = harness('panel');
  const panel = { provider: 'anthropic', model: 'panel-reviewer' };
  const accepts = (route: typeof panel) =>
    specPlanningConfig.safeParse({
      ...config,
      panel_reviewer: account(route, 2),
    }).success;
  for (const route of [
    { ...review, provider: author.provider },
    { ...review, model: author.model },
  ]) {
    assert.equal(specPlanningConfig.safeParse({ ...config, reviewer: account(route, 2) }).success, false);
  }
  assert.equal(accepts(panel), true);
  assert.equal(accepts({ ...panel, provider: author.provider }), false);
  assert.equal(accepts({ ...panel, model: author.model }), false);
  assert.equal(accepts({ ...panel, model: review.model }), false);
  assert.equal(accepts({ ...panel, provider: review.provider }), true);
});

Then(
  'Spec planning processes artifact path {string} as {string}',
  async function (path: string, outcome: string) {
    const { host, config } = harness('artifact');
    const content = 'Plan révisé';
    const writes: Array<[string, string]> = [];
    let submitted: unknown;
    host.writeArtifact = (name, text) => {
      writes.push([name, text]);
    };
    host.call = async (tool, args) => {
      if (tool === 'start_pipeline') return JSON.stringify({ run_id });
      if (tool === 'submit_action_result') {
        submitted = args['result'];
        return JSON.stringify({ run_id });
      }
      const action = submitted
        ? { kind: 'failed', step: 'delivery', reason: 'stop after write' }
        : { kind: 'write_file', path, content };
      return JSON.stringify({
        run_id,
        action,
        __page: { offset: 0, count: 1, total: 1, next_offset: null },
      });
    };
    if (outcome === 'written') {
      const result = await driveSpec(host, config, false);
      assert.equal(result.status, 'failed');
      assert.deepEqual(writes, [['Part-2.v1_md', content]]);
      assert.deepEqual(submitted, {
        kind: 'file_written',
        path,
        bytes: Buffer.byteLength(content),
      });
    } else {
      await assert.rejects(driveSpec(host, config, false), /SPEC_ARTIFACT_PATH_REFUSED/);
      assert.deepEqual(writes, []);
      assert.equal(submitted, undefined);
    }
  },
);
