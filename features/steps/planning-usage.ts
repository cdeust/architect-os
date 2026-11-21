import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function fakeDraftEnvironment(root: string, provider: string): NodeJS.ProcessEnv {
  assert.ok(provider === 'gpt' || provider === 'gemini');
  const proposal = JSON.stringify({
    step: 'delivery',
    objective: 'Keep the receipt.',
    verification: 'Read the receipt.',
    acceptance_ids: ['AC-001'],
  });
  const gpt = provider === 'gpt';
  const response = gpt
    ? {
        model: 'fixture-gpt',
        choices: [{ finish_reason: 'stop', message: { content: proposal } }],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      }
    : {
        modelVersion: 'fixture-gemini',
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: proposal }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
      };
  const origin = gpt ? 'https://api.openai.com' : 'https://generativelanguage.googleapis.com';
  const source =
    'globalThis.fetch = async (url) => {' +
    'if (new URL(url).origin !== ' +
    JSON.stringify(origin) +
    ') throw Error("wrong provider");' +
    'return Response.json(' +
    JSON.stringify(response) +
    ');};';
  return {
    ...fixtureEnvironment(root),
    [gpt ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY']: 'synthetic-key',
    NODE_OPTIONS: '--import=data:text/javascript;base64,' + Buffer.from(source).toString('base64'),
  };
}

Then('a measured {string} draft supplies one receipt that binds the prepared Plan', (provider: string) => {
  const root = mkdtempSync(join(tmpdir(), 'measured-draft-'));
  try {
    const { define, policy } = planFixture(root);
    const receipt = join(root, 'draft.jsonl');
    const command = [receipt, 'draft', provider, 'fixture-model', 'delivery', define, '200', '1000'];
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
    assert.equal(finish.provider, provider);
    assert.equal(finish.model_requested, 'fixture-model');
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

Then('a measured draft without a provider key publishes only a refusal receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'measured-draft-refusal-'));
  try {
    const { define } = planFixture(root);
    const receipt = join(root, 'draft.jsonl');
    const result = measured(
      [receipt, 'draft', 'gpt', 'fixture-model', 'delivery', define, '200', '1000'],
      fixtureEnvironment(root),
    );
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /PLAN_KEY_MISSING/);
    const events = readFileSync(receipt, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.event),
      ['started', 'finished'],
    );
    assert.equal(events[0].attempt_id, events[1].attempt_id);
    assert.equal(events[1].outcome, 'PLAN_KEY_MISSING');
    assert.equal(events[1].usage, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
