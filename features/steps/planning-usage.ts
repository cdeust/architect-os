import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Then } from '@cucumber/cucumber';

async function observe(refusal: boolean) {
  const { measure } = await import(new URL('../../baseline/planning.mjs', import.meta.url).href);
  const root = mkdtempSync(join(tmpdir(), 'planning-usage-'));
  try {
    const path = join(root, 'attempt');
    const launch = () =>
      measure([path, 'prepare'], {
        execPath: refusal ? process.execPath : join(root, 'missing-node'),
        stdout: process.stdout,
      });
    if (refusal) assert.equal(await launch(), 2);
    else await assert.rejects(launch);
    const bytes = readFileSync(path, 'utf8');
    const events = bytes
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((e) => e.event),
      ['started', refusal ? 'finished' : 'measurement_failed'],
    );
    assert.equal(events[0].attempt_id, events[1].attempt_id);
    assert.equal(events[1].producer_usage, null);
    assert.ok(events[1].duration_ms >= 0);
    if (refusal) assert.equal(events[1].exit_code, 2);
    await assert.rejects(launch, { code: 'EEXIST' });
    assert.equal(readFileSync(path, 'utf8'), bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
Then('a measured Plan refusal records its exit and preserves its journal on retry', () => observe(true));
Then('a planning measurement records its launch failure without a cost', () => observe(false));

const measurement = fileURLToPath(new URL('../../baseline/planning.mjs', import.meta.url));

function measured(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [measurement, ...args], { env, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

function planFixture(root: string) {
  const define = join(root, 'define.json');
  const policy = join(root, 'policy.json');
  writeFileSync(
    define,
    JSON.stringify({
      handoff: {
        version: 1,
        run_id: 'run_measurement',
        requirements: [{ id: 'FR-001', text: 'Retain a receipt.' }],
        acceptance: [{ id: 'AC-001', text: 'Read the receipt.', requirement_ids: ['FR-001'] }],
      },
    }) + '\n',
  );
  writeFileSync(
    policy,
    JSON.stringify({
      step: { build: { model: 'operator-build', effort: 'medium', limitSeconds: 60 } },
      scout_questions: {},
    }),
  );
  return { define, policy };
}

function fixtureEnvironment(root: string): NodeJS.ProcessEnv {
  return { HOME: root, PATH: process.env.PATH, TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH };
}

function fakeDraftEnvironment(root: string, provider: string, refused = false): NodeJS.ProcessEnv {
  assert.ok(provider === 'gpt' || provider === 'gemini');
  const proposal = JSON.stringify({
    step: 'delivery',
    objective: 'Keep the receipt.',
    verification: 'Read the receipt.',
    acceptance_ids: ['AC-001'],
  });
  const gpt = provider === 'gpt',
    name = gpt ? 'codex' : 'agy';
  const usage = { input_tokens: 12, output_tokens: 7 };
  const reports = gpt
    ? [
        { type: 'item.completed', item: { type: 'agent_message', text: proposal } },
        { type: 'turn.completed', usage },
      ]
    : [
        {
          event: 'init',
          conversation_id: 'one',
          init: { model: 'gemini-fixture-model', permission_mode: 'strict' },
        },
        {
          event: 'result',
          result: {
            conversation_id: 'one',
            status: refused ? 'ERROR' : 'SUCCESS',
            num_turns: 1,
            response: proposal,
            usage,
          },
        },
      ];
  const dir = join(root, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, name);
  writeFileSync(
    exe,
    '#!' +
      process.execPath +
      '\nrequire("node:fs").readFileSync(0);console.log(' +
      JSON.stringify(reports.map((r) => JSON.stringify(r)).join('\n')) +
      ');',
    { mode: 0o700 },
  );
  return { ...fixtureEnvironment(root), ['AOS_PLAN_' + provider.toUpperCase() + '_BIN']: exe };
}

Then('a measured {string} draft supplies one receipt that binds the prepared Plan', (provider: string) => {
  const root = mkdtempSync(join(tmpdir(), 'measured-draft-'));
  try {
    const { define, policy } = planFixture(root);
    const receipt = join(root, 'draft.jsonl');
    const command = [receipt, 'draft', provider, 'gemini-fixture-model', 'delivery', define, '3000'];
    const env = fakeDraftEnvironment(root, provider);
    const result = measured(command, env);
    assert.equal(result.status, 0, result.stderr);
    const journal = readFileSync(receipt, 'utf8');
    const events = journal
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.event),
      ['started', 'finished'],
    );
    const [start, finish] = events;
    assert.equal(start.attempt_id, finish.attempt_id);
    assert.equal(finish.exit_code, 0);
    assert.equal(finish.native_exit_code, 0);
    assert.equal(finish.provider, provider);
    assert.equal(finish.model_requested, 'gemini-fixture-model');
    assert.equal(finish.usage.input_tokens, 12);
    assert.equal(finish.usage.output_tokens, 7);
    assert.equal(finish.outcome, 'proposed');
    assert.equal(finish.proposal_sha256, createHash('sha256').update(result.stdout).digest('hex'));

    const proposal = join(root, 'proposal.json');
    writeFileSync(proposal, result.stdout);
    const preview = measured(
      [join(root, 'prepare.jsonl'), 'prepare', define, proposal, policy],
      fixtureEnvironment(root),
    );
    assert.equal(preview.status, 0, preview.stderr);
    const { status, manifest } = JSON.parse(preview.stdout);
    assert.equal(status, 'pending');
    assert.equal(manifest.run_id, finish.run_id);
    assert.equal(manifest.source_sha256.define, finish.define_sha256);
    assert.equal(manifest.source_sha256.proposal, finish.proposal_sha256);

    const duplicate = measured(command, env);
    assert.equal(duplicate.status, 2, duplicate.stderr);
    assert.equal(duplicate.stdout, '');
    assert.match(duplicate.stderr, /PLAN_RECEIPT_UNAVAILABLE/);
    assert.equal(readFileSync(receipt, 'utf8'), journal);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Then('a measured draft without a provider installation publishes only a refusal receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'measured-draft-refusal-'));
  try {
    const { define } = planFixture(root);
    const receipt = join(root, 'draft.jsonl');
    const result = measured([receipt, 'draft', 'gpt', 'gemini-fixture-model', 'delivery', define, '3000'], {
      ...fixtureEnvironment(root),
      AOS_PLAN_GPT_BIN: join(root, '.local', 'bin', 'codex'),
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /PLAN_PROVIDER_FAILED/);
    const events = readFileSync(receipt, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.event),
      ['started', 'finished'],
    );
    assert.equal(events[0].attempt_id, events[1].attempt_id);
    assert.equal(events[1].outcome, 'PLAN_PROVIDER_FAILED');
    assert.equal(events[1].usage, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Then('a measured Antigravity import supplies one receipt that binds the prepared Plan', () => {
  const root = mkdtempSync(join(tmpdir(), 'measured-agy-'));
  try {
    const { define, policy } = planFixture(root);
    const model = 'gemini-4-neon-high';
    const step = 'delivery';
    const response = join(root, 'response.jsonl');
    const receipt = join(root, 'agy.jsonl');
    const env = fixtureEnvironment(root);
    const request = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tools/plan/src/cli.ts', 'agy-request', model, step, define],
      { env, encoding: 'utf8' },
    );
    assert.equal(request.status, 0, request.stderr);
    const digest = JSON.parse(JSON.parse(request.stdout).message.content.split('\n').at(-1)).request_sha256;
    const id = 'fixture-conversation';
    const events = [
      { event: 'init', conversation_id: id, init: { model, permission_mode: 'strict' } },
      {
        event: 'result',
        result: {
          conversation_id: id,
          status: 'SUCCESS',
          num_turns: 1,
          structured_output: {
            request_sha256: digest,
            proposal: {
              step,
              objective: 'Keep the receipt.',
              verification: 'Read the receipt.',
              acceptance_ids: ['AC-001'],
            },
          },
        },
      },
    ];
    writeFileSync(response, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    const args = [receipt, 'agy-result', model, step, define, response];
    const result = measured(args, env);
    assert.equal(result.status, 0, result.stderr);
    const journal = readFileSync(receipt, 'utf8');
    const [started, finished, ...extra] = journal
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(extra, []);
    assert.equal(started.event, 'started');
    assert.equal(finished.event, 'finished');
    assert.equal(finished.attempt_id, started.attempt_id);
    assert.equal(finished.stage, 'agy-result');
    assert.equal(finished.outcome, 'proposed');
    assert.equal(finished.request_sha256, digest);
    assert.equal(finished.billing_verified, false);

    const proposal = join(root, 'proposal.json');
    writeFileSync(proposal, result.stdout);
    const preview = measured([join(root, 'prepare.jsonl'), 'prepare', define, proposal, policy], env);
    assert.equal(preview.status, 0, preview.stderr);
    const { status, manifest } = JSON.parse(preview.stdout);
    assert.equal(status, 'pending');
    assert.equal(manifest.run_id, finished.run_id);
    assert.equal(manifest.source_sha256.define, finished.define_sha256);
    assert.equal(manifest.source_sha256.proposal, finished.proposal_sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Then(
  'both Plan entrypoints return one when a successful native Gemini process supplies a refused response',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'gemini-exit-'));
    try {
      const { define } = planFixture(root);
      const env = fakeDraftEnvironment(root, 'gemini', true);
      for (const stage of ['draft', 'measured']) {
        const path = join(root, stage + '.jsonl');
        const args = ['gemini', 'gemini-fixture-model', 'delivery', define];
        const response =
          stage === 'draft'
            ? spawnSync(
                process.execPath,
                ['--import', 'tsx', 'tools/plan/src/cli.ts', 'draft', ...args, path, '3000'],
                { env, encoding: 'utf8' },
              )
            : measured([path, 'draft', ...args, '3000'], env);
        assert.equal(response.status, 1, response.stderr);
        assert.equal(response.stdout, '');
        const [, terminal] = readFileSync(path, 'utf8')
          .trimEnd()
          .split('\n')
          .map((s) => JSON.parse(s));
        assert.equal(terminal.exit_code, 1);
        assert.equal(terminal.native_exit_code, 0);
        assert.equal(terminal.outcome, 'PLAN_PROVIDER_FAILED');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
