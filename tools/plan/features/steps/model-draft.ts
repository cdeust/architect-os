import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { runDraft } from '../../src/draft.js';

Then(
  'the Plan drafter using {string} with {string} records {string}',
  async function (provider: string, reply: string, outcome: string) {
    const root = mkdtempSync(join(tmpdir(), 'plan-draft-'));
    try {
      const path = join(root, 'define'),
        receipt = join(root, 'receipt');
      const handoff = {
        version: 1,
        run_id: 'run_fixture',
        requirements: [{ id: 'FR-1', text: 'Keep records.' }],
        acceptance: [{ id: 'AC-1', text: 'Read records.', requirement_ids: ['FR-1'] }],
      };
      writeFileSync(path, JSON.stringify(reply === 'invalid run' ? {} : { handoff }));
      const model = 'test-model',
        proposal = {
          step: reply === 'wrong step' ? 'other' : 'audit',
          objective: 'Plan audit.',
          verification: 'Read records.',
          acceptance_ids: reply === 'missing ID' ? [] : ['AC-1'],
        };
      const text = JSON.stringify(proposal);
      let calls = 0,
        stdout = '',
        stderr = '';
      const proc = {
        argv: ['node', 'plan', 'draft', provider, model, 'audit', path, receipt, '200', '1000'],
        env:
          reply === 'missing key'
            ? {}
            : { ANTHROPIC_API_KEY: 'claude-test', OPENAI_API_KEY: 'gpt-test', GEMINI_API_KEY: 'gemini-test' },
        stdout: { write: (v: string) => (stdout += v) },
        stderr: { write: (v: string) => (stderr += v) },
      };
      const send: typeof fetch = async (url, opts) => {
        calls++;
        assert.equal(opts?.method, 'POST');
        assert.equal(opts?.redirect, 'error');
        assert.ok(opts?.signal);
        const body = JSON.parse(String(opts?.body)),
          headers = new Headers(opts?.headers);
        assert.equal(body.tools, undefined);
        assert.ok(JSON.stringify(body).includes('run_fixture'));
        if (reply === 'timed out') throw new Error('sensitive wire error');
        if (reply === 'rate limit') return new Response('sensitive wire error', { status: 429 });
        let result;
        switch (provider) {
          case 'claude':
            assert.equal(url, 'https://api.anthropic.com/v1/messages');
            assert.equal(headers.get('x-api-key'), 'claude-test');
            assert.equal(body.model, model);
            assert.equal(body.max_tokens, 200);
            result = {
              model: 'reported',
              stop_reason: reply === 'truncated' ? 'max_tokens' : 'end_turn',
              content: [{ type: 'text', text }],
              usage: { input_tokens: 12, output_tokens: 0 },
            };
            break;
          case 'gpt':
            assert.equal(url, 'https://api.openai.com/v1/chat/completions');
            assert.equal(headers.get('authorization'), 'Bearer gpt-test');
            assert.equal(body.store, false);
            assert.equal(body.model, model);
            assert.equal(body.max_completion_tokens, 200);
            result = {
              model: 'reported',
              choices: [
                {
                  finish_reason: 'stop',
                  message: { content: text, refusal: reply === 'refused' ? 'no' : null },
                },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 0 },
            };
            break;
          case 'gemini':
            assert.equal(
              url,
              'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
            );
            assert.equal(headers.get('x-goog-api-key'), 'gemini-test');
            assert.equal(body.generationConfig.maxOutputTokens, 200);
            result = {
              modelVersion: 'reported',
              candidates: [
                { finishReason: reply === 'blocked' ? 'SAFETY' : 'STOP', content: { parts: [{ text }] } },
              ],
              usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0 },
            };
            break;
          default:
            throw Error('unexpected provider');
        }
        return Response.json(result);
      };
      assert.equal(await runDraft(proc, send), outcome === 'proposed' ? 0 : 2);
      assert.equal(calls, ['missing key', 'invalid run'].includes(reply) ? 0 : 1);
      assert.equal(stdout, outcome === 'proposed' ? text + '\n' : '');
      assert.equal(stderr, outcome === 'proposed' ? '' : 'architect-os plan draft: ' + outcome + '\n');
      const raw = readFileSync(receipt, 'utf8');
      const [start, finish] = raw
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s));
      assert.equal(start.attempt_id, finish.attempt_id);
      assert.equal(start.provider, provider);
      assert.equal(start.model_requested, model);
      assert.equal(finish.outcome, outcome);
      assert.equal(finish.run_id, reply === 'invalid run' ? null : 'run_fixture');
      if (finish.http_status === 200) {
        assert.equal(finish.usage.input_tokens, 12);
        assert.equal(finish.usage.output_tokens, 0);
        assert.equal(finish.usage.cache_read_tokens, null);
        assert.equal(finish.usage.cost_usd, null);
        assert.equal(finish.usage.model_reported, 'reported');
      } else assert.equal(finish.usage, null);
      assert.doesNotMatch(raw, /sensitive wire error|Plan audit|claude-test|gpt-test|gemini-test/);
      assert.equal(existsSync(join(root, 'audit')), false);
      assert.equal(await runDraft(proc, send), 2);
      assert.equal(readFileSync(receipt, 'utf8'), raw);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
