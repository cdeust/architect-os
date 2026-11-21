import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { runPlanCommand } from '../../src/draft.js';

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
      const json = JSON.stringify(reply === 'invalid run' ? {} : { handoff });
      const define =
        reply === 'BOM'
          ? Buffer.from('\ufeff' + json)
          : reply === 'invalid UTF8'
            ? Buffer.concat([
                Buffer.from(json.split('records')[0]!),
                Buffer.from([255]),
                Buffer.from(json.slice(json.indexOf('records') + 7)),
              ])
            : Buffer.from(json);
      writeFileSync(path, define);
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
        assert.equal(headers.get('content-type'), 'application/json');
        const input = JSON.stringify({ step: 'audit', handoff });
        assert.ok(JSON.stringify(body).includes('run_fixture'));
        if (reply === 'timed out') throw new Error('sensitive wire error');

        let result;
        switch (provider) {
          case 'claude':
            assert.equal(url, 'https://api.anthropic.com/v1/messages');
            assert.equal(headers.get('x-api-key'), 'claude-test');
            assert.equal(body.model, model);
            assert.equal(body.max_tokens, 200);
            assert.equal(headers.get('anthropic-version'), '2023-06-01');
            assert.match(body.system, /acceptance_ids/);
            assert.deepEqual(body.messages, [{ role: 'user', content: input }]);
            result = {
              model: 'reported',
              stop_reason: reply === 'truncated' ? 'max_tokens' : 'end_turn',
              content: [
                { type: 'thinking', text: 'private' },
                { type: 'text', text: text.slice(0, 4) },
                { type: 'text', text: text.slice(4) },
              ],
              usage: { input_tokens: 12, output_tokens: 0 },
            };
            break;
          case 'gpt':
            assert.equal(url, 'https://api.openai.com/v1/chat/completions');
            assert.equal(headers.get('authorization'), 'Bearer gpt-test');
            assert.equal(body.store, false);
            assert.equal(body.model, model);
            assert.equal(body.max_completion_tokens, 200);
            assert.deepEqual(body.response_format, { type: 'json_object' });
            assert.match(body.messages[0].content, /acceptance_ids/);
            assert.equal(body.messages[0].role, 'developer');
            assert.deepEqual(body.messages[1], { role: 'user', content: input });
            result = {
              model: reply === 'malformed usage' ? {} : 'reported',
              choices: [
                {
                  finish_reason: reply === 'length' ? 'length' : 'stop',
                  message: {
                    content: reply === 'nontext' ? { bad: true } : text,
                    refusal: reply === 'refused' ? 'no' : null,
                  },
                },
              ],
              usage: {
                prompt_tokens: reply === 'malformed usage' ? 2.5 : 12,
                completion_tokens: reply === 'malformed usage' ? -1 : 0,
              },
            };
            break;
          case 'gemini':
            assert.equal(
              url,
              'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
            );
            assert.equal(headers.get('x-goog-api-key'), 'gemini-test');
            assert.equal(body.generationConfig.maxOutputTokens, 200);
            assert.equal(body.generationConfig.responseMimeType, 'application/json');
            assert.match(body.systemInstruction.parts[0].text, /acceptance_ids/);
            assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: input }] }]);
            result = {
              modelVersion: 'reported',
              candidates: [
                {
                  finishReason: reply === 'blocked' ? 'SAFETY' : 'STOP',
                  content: {
                    parts: [
                      { thought: true, text: 'private' },
                      { text: text.slice(0, 4) },
                      { text: text.slice(4) },
                    ],
                  },
                },
              ],
              usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0 },
            };
            break;
          default:
            throw Error('unexpected provider');
        }
        if (reply === 'missing content' && 'stop_reason' in result)
          delete (result as { content?: unknown }).content;
        if (reply === 'missing content' && 'candidates' in result)
          delete (result.candidates[0]!.content as { parts?: unknown }).parts;
        return Response.json(result, { status: reply === 'rate limit' ? 429 : 200 });
      };
      const begin = performance.now();
      assert.equal(await runPlanCommand(proc, send), outcome === 'proposed' ? 0 : 2);
      assert.equal(calls, ['missing key', 'invalid run', 'invalid UTF8', 'BOM'].includes(reply) ? 0 : 1);
      assert.equal(stdout, outcome === 'proposed' ? text + '\n' : '');
      assert.equal(stderr, outcome === 'proposed' ? '' : 'architect-os plan draft: ' + outcome + '\n');
      const raw = readFileSync(receipt, 'utf8');
      const [start, finish] = raw
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s));
      assert.equal(start.attempt_id, finish.attempt_id);
      assert.deepEqual(
        [start.version, start.stage, start.event, start.max_output_tokens, start.timeout_ms, finish.event],
        [1, 'draft', 'started', 200, 1000, 'finished'],
      );
      assert.ok(Date.parse(start.at) > 0);
      assert.ok(finish.duration_ms >= 0 && finish.duration_ms <= performance.now() - begin);
      const invalid = ['invalid run', 'invalid UTF8', 'BOM'].includes(reply);
      const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
      assert.equal(finish.define_sha256, invalid ? null : sha(define));
      if (outcome === 'proposed') assert.equal(finish.proposal_sha256, sha(stdout));
      assert.equal(start.provider, provider);
      assert.equal(start.model_requested, model);
      assert.equal(finish.outcome, outcome);
      assert.equal(finish.run_id, invalid ? null : 'run_fixture');
      assert.equal(
        finish.http_status,
        reply === 'rate limit' ? 429 : calls === 0 || reply === 'timed out' ? null : 200,
      );
      if (finish.http_status === 200) {
        assert.equal(finish.usage.input_tokens, reply === 'malformed usage' ? null : 12);
        assert.equal(finish.usage.output_tokens, reply === 'malformed usage' ? null : 0);
        assert.equal(finish.usage.cache_read_tokens, null);
        assert.equal(finish.usage.cost_usd, null);
        assert.equal(finish.usage.model_reported, reply === 'malformed usage' ? null : 'reported');
      } else assert.equal(finish.usage, null);
      assert.doesNotMatch(raw, /sensitive wire error|Plan audit|claude-test|gpt-test|gemini-test/);
      assert.equal(existsSync(join(root, 'audit')), false);
      assert.equal(await runPlanCommand(proc, send), 2);
      assert.ok(stderr.endsWith('architect-os plan draft: PLAN_RECEIPT_UNAVAILABLE\n'));
      assert.equal(readFileSync(receipt, 'utf8'), raw);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

Then(
  'invalid draft operands refuse without a provider request and prepare keeps its own CLI',
  async function () {
    const root = mkdtempSync(join(tmpdir(), 'plan-draft-args-'));
    try {
      const args = ['gpt', 'model', 'delivery', join(root, 'define'), join(root, 'new'), '1', '2147483647'];
      const usage =
        'architect-os plan draft: usage: plan draft <claude|gpt|gemini> <model> <step> <define> <new-receipt> <max-output-tokens> <timeout-ms>\n';
      const cases: [number, string][] = [
        [0, 'unknown'],
        [1, '/bad'],
        [1, 'bad/'],
        [2, 'bad/name'],
        [3, ''],
        [4, ''],
        [5, '0'],
        [5, '1.5'],
        [6, '0'],
        [6, '1.5'],
        [6, '2147483648'],
        [7, 'extra'],
      ];
      let err = '';
      const proc = {
        argv: ['node', 'plan', 'draft'],
        env: {},
        stdout: { write: () => assert.fail() },
        stderr: { write: (s: string) => (err += s) },
      };
      const send: typeof fetch = async () => assert.fail('unexpected request');
      for (const [position, value] of cases) {
        const input = [...args];
        input[position] = value;
        proc.argv = ['node', 'plan', 'draft', ...input];
        err = '';
        assert.equal(await runPlanCommand(proc, send), 2);
        assert.equal(err, usage);
        assert.equal(existsSync(args[4]!), false);
      }
      proc.argv = ['node', 'plan', 'draft', ...args];
      err = '';
      assert.equal(await runPlanCommand(proc, send), 2);
      assert.equal(err, 'architect-os plan draft: PLAN_DEFINE_INVALID\n');
      proc.argv = ['node', 'plan', 'prepare'];
      err = '';
      assert.equal(await runPlanCommand(proc, send), 2);
      assert.match(err, /architect-os plan: usage: plan prepare/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
