import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { runPlanCommand } from '../../src/draft.js';

Then(
  'the offline Antigravity exchange with {string} records {string}',
  async function (reply: string, outcome: string) {
    const root = mkdtempSync(join(tmpdir(), 'plan-agy-'));
    try {
      const define = join(root, 'define.json');
      const response = join(root, 'response.jsonl');
      const receipt = join(root, 'receipt.jsonl');
      const model = 'gemini-4-neon-high';
      const step = 'audit';
      const handoff = {
        version: 1,
        run_id: 'run_fixture',
        requirements: [{ id: 'FR-1', text: 'Keep records.' }],
        acceptance: [{ id: 'AC-1', text: 'Read records.', requirement_ids: ['FR-1'] }],
      };
      const raw = JSON.stringify({ handoff });
      writeFileSync(define, raw);
      async function run(args: string[]) {
        let stdout = '',
          stderr = '';
        const code = await runPlanCommand(
          {
            argv: ['node', 'plan', ...args],
            env: { GEMINI_API_KEY: 'unused-test-key' },
            stdout: {
              write: (text) => {
                stdout += text;
              },
            },
            stderr: {
              write: (text) => {
                stderr += text;
              },
            },
          },
          () => {
            assert.fail('the exchange must never call a provider');
          },
        );
        return { code, stdout, stderr };
      }
      const request = await run(['agy-request', model, step, define]);
      assert.equal(request.code, 0);
      const user = JSON.parse(request.stdout);
      assert.equal(user.event, 'user');
      const document = JSON.parse(user.message.content.split('\n').at(-1));
      assert.deepEqual(document.handoff, handoff);
      const digest = createHash('sha256').update(raw).digest('hex');
      assert.equal(
        document.request_sha256,
        createHash('sha256')
          .update(
            JSON.stringify({
              version: 1,
              model_requested: model,
              step,
              define_sha256: digest,
            }),
          )
          .digest('hex'),
      );
      if (reply === 'changed Define') writeFileSync(define, raw + '\n');
      const proposal = {
        step: reply === 'wrong step' ? 'other' : step,
        objective: 'Plan audit.',
        verification: 'Read records.',
        acceptance_ids: reply === 'missing ID' ? [] : ['AC-1'],
      };
      const id = 'fixture-conversation';
      const events = [
        {
          event: 'init',
          conversation_id: id,
          init: {
            permission_mode: 'strict',
            model: reply === 'wrong model' ? 'gemini-other' : model,
          },
        },
        {
          event: 'step_update',
          step_update: {
            conversation_id: id,
            state: 'DONE',
            step_type: reply === 'tool call' ? 'tool' : 'agent_response',
            ...(reply === 'subagent' ? { subagent_info: {} } : {}),
          },
        },
        {
          event: 'result',
          result: {
            conversation_id: id,
            num_turns: reply === 'extra turn' ? 2 : 1,
            status: reply === 'failed run' ? 'ERROR' : 'SUCCESS',
            duration_seconds: 3,
            usage: { input_tokens: 10, output_tokens: 4, thinking_tokens: 2 },
            structured_output: { request_sha256: document.request_sha256, proposal },
          },
        },
      ];
      const trace = reply === 'truncated' ? events.slice(0, -1) : events;
      writeFileSync(response, trace.map((event) => JSON.stringify(event)).join('\n') + '\n');
      if (reply === 'missing file') rmSync(response);
      if (reply === 'invalid Define') writeFileSync(define, '{}');
      const args = ['agy-result', model, step, define, response, receipt];
      const imported = await run(args);
      const before = readFileSync(receipt, 'utf8');
      const [start, finish] = before
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(finish.attempt_id, start.attempt_id);
      assert.equal(finish.source, 'external_operator');
      assert.equal(finish.billing_verified, false);
      assert.equal(finish.cost_usd, null);
      assert.equal(finish.model_reported, null);
      assert.equal(finish.outcome, outcome);
      assert.ok(finish.duration_ms >= 0);
      assert.equal(finish.version, 2);
      assert.equal(finish.exit_code, imported.code);
      assert.equal(finish.native_exit_code, null);
      if (outcome === 'proposed') {
        assert.equal(imported.code, 0);
        assert.deepEqual(JSON.parse(imported.stdout), proposal);
        assert.equal(finish.define_sha256, digest);
        assert.equal(finish.proposal_sha256, createHash('sha256').update(imported.stdout).digest('hex'));
        assert.equal(finish.external_duration_seconds, 3);
        assert.equal(finish.usage.thinking_tokens, 2);
      } else {
        assert.equal(imported.code, ['missing file', 'invalid Define'].includes(reply) ? 2 : 1);
        assert.equal(imported.stdout, '');
        assert.ok(imported.stderr.includes(outcome));
        assert.equal(finish.proposal_sha256, null);
      }
      const duplicate = await run(args);
      assert.equal(duplicate.code, 2);
      assert.ok(duplicate.stderr.includes('PLAN_RECEIPT_UNAVAILABLE'));
      assert.equal(readFileSync(receipt, 'utf8'), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
