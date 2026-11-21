import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { runPlanCommand } from '../../src/draft.js';

Then(
  'the Plan drafter using {string} with {string} records {string}',
  async function (provider: string, reply: string, outcome: string) {
    const root = mkdtempSync(join(tmpdir(), 'plan-native-'));
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
      const bytes =
        reply === 'BOM'
          ? Buffer.from('\ufeff' + json)
          : reply === 'invalid UTF8'
            ? Buffer.concat([
                Buffer.from(json.split('records')[0]!),
                Buffer.from([255]),
                Buffer.from(json.slice(json.indexOf('records') + 7)),
              ])
            : Buffer.from(json);
      writeFileSync(path, bytes);
      const proposal = {
        step: reply === 'wrong step' ? 'other' : 'audit',
        objective: 'Audit.',
        verification: 'Read.',
        acceptance_ids: reply === 'missing ID' ? [] : ['AC-1'],
      };
      const text = JSON.stringify(proposal);
      const usage = { input_tokens: 12, output_tokens: 0 };
      const responses: Record<string, object[]> = {
        claude: [
          {
            type: 'result',
            subtype: 'success',
            is_error: reply === 'refused',
            result: text,
            modelUsage: { 'claude-reported': {} },
            usage,
            total_cost_usd: 0,
          },
        ],
        gpt: [
          { type: 'thread.started' },
          { type: 'turn.started' },
          {
            type: 'item.completed',
            item: { type: reply === 'tool' ? 'command_execution' : 'agent_message', text },
          },
          { type: 'turn.completed', usage },
        ],
        gemini: [
          {
            event: 'init',
            conversation_id: 'one',
            init: { model: 'fixture-model', permission_mode: 'strict' },
          },
          {
            event: 'step_update',
            step_update: {
              conversation_id: 'one',
              state: 'DONE',
              step_type: reply === 'tool' ? 'tool_call' : 'agent_response',
            },
          },
          {
            event: 'result',
            result: {
              conversation_id: 'one',
              num_turns: 1,
              status: reply === 'refused' ? 'ERROR' : 'SUCCESS',
              response: text,
              usage,
            },
          },
        ],
      };
      const name = ({ claude: 'claude', gpt: 'codex', gemini: 'agy' } as Record<string, string>)[provider]!;
      const binDir = join(root, '.local', 'bin');
      mkdirSync(binDir, { recursive: true });
      const exe = join(binDir, name);
      const source = `#!${process.execPath}
const fs=require('node:fs'),assert=require('node:assert/strict');const args=process.argv.slice(2),stdin=fs.readFileSync(0,'utf8');
assert.ok(stdin.includes('run_fixture'));assert.ok(!args.join(' ').includes('run_fixture'));
assert.equal(args[args.indexOf('--model')+1],'fixture-model');
assert.ok(!('SYNTHETIC_SECRET' in process.env));assert.ok(!('OPENAI_API_KEY' in process.env));
assert.deepEqual(Object.keys(process.env).filter(k=>k!=='__CF_USER_TEXT_ENCODING').sort(),['HOME','LANG','PATH','TMPDIR']);
assert.equal(fs.readdirSync(process.cwd()).length,0);
const reply=${JSON.stringify(reply)},provider=${JSON.stringify(provider)};
if(provider==='claude'){assert.ok(args.includes('--no-session-persistence'));assert.ok(args.includes('--strict-mcp-config'));assert.equal(args[args.indexOf('--tools')+1],'');}
if(provider==='gpt'){assert.ok(args.includes('--ephemeral'));assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('read-only'));}
if(provider==='gemini'){assert.equal(JSON.parse(stdin).event,'user');assert.ok(args.includes('--sandbox'));const settings=JSON.parse(args[args.indexOf('--settings')+1]);assert.equal(settings.useG1Credits,false);assert.ok(settings.permissions.deny.includes('mcp(*)'));}
if(reply==='timeout'){setInterval(()=>{},10000);}else{if(reply==='diagnostic')process.stderr.write('private cli diagnostic'); console.log(${JSON.stringify(reply === 'malformed' ? 'invalid' : responses[provider]!.map((x) => JSON.stringify(x)).join('\n'))});if(reply==='nonzero')process.exitCode=1;}
`;
      if (reply !== 'absent') writeFileSync(exe, source, { mode: 0o700 });
      let out = '',
        err = '';
      const env = {
        HOME: root,
        ['AOS_PLAN_' + provider.toUpperCase() + '_BIN']: exe,
        SYNTHETIC_SECRET: 'hidden',
        OPENAI_API_KEY: 'fixture',
      };
      const proc = {
        argv: [
          'node',
          'plan',
          'draft',
          provider,
          'fixture-model',
          'audit',
          path,
          receipt,
          reply === 'timeout' ? '10' : '3000',
        ],
        env,
        stdout: { write: (s: string) => (out += s) },
        stderr: { write: (s: string) => (err += s) },
      };
      assert.equal(await runPlanCommand(proc), outcome === 'proposed' ? 0 : 2);
      assert.equal(out, outcome === 'proposed' ? text + '\n' : '');
      assert.equal(err, outcome === 'proposed' ? '' : 'architect-os plan draft: ' + outcome + '\n');
      const journal = readFileSync(receipt, 'utf8');
      const [start, finish] = journal
        .trim()
        .split('\n')
        .map((x) => JSON.parse(x));
      assert.equal(start.transport, 'native-cli');
      assert.equal(start.attempt_id, finish.attempt_id);
      assert.equal(finish.outcome, outcome);
      if (outcome === 'proposed') {
        assert.equal(finish.exit_code, 0);
        assert.equal(finish.usage.input_tokens, 12);
        assert.equal(finish.usage.output_tokens, 0);
        assert.equal(finish.usage.cost_usd, provider === 'claude' ? 0 : null);
        assert.equal(finish.proposal_sha256, createHash('sha256').update(out).digest('hex'));
      }
      assert.doesNotMatch(journal, /private cli diagnostic|Audit\.|SYNTHETIC_SECRET/);
      assert.equal(await runPlanCommand(proc), 2);
      assert.equal(readFileSync(receipt, 'utf8'), journal);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

Then(
  'invalid draft operands refuse without a provider request and prepare keeps its own CLI',
  async function () {
    const root = mkdtempSync(join(tmpdir(), 'plan-args-'));
    try {
      const args = ['gpt', 'model', 'delivery', join(root, 'define'), join(root, 'receipt'), '2147483647'];
      const cases: [number, string][] = [
        [0, 'unknown'],
        [1, '/bad'],
        [1, 'bad/'],
        [2, 'bad/name'],
        [3, ''],
        [4, ''],
        [5, '0'],
        [5, '1.5'],
        [5, '2147483648'],
        [6, 'extra'],
      ];
      let err = '';
      const proc = {
        argv: ['node', 'plan', 'draft'],
        env: {},
        stdout: { write: () => assert.fail() },
        stderr: { write: (s: string) => (err += s) },
      };
      for (const [index, value] of cases) {
        const input = [...args];
        input[index] = value;
        proc.argv = ['node', 'plan', 'draft', ...input];
        err = '';
        assert.equal(await runPlanCommand(proc), 2);
        assert.match(err, /usage: plan draft/);
        assert.equal(existsSync(args[4]!), false);
      }
      proc.argv = ['node', 'plan', 'prepare'];
      err = '';
      assert.equal(await runPlanCommand(proc), 2);
      assert.match(err, /usage: plan prepare/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
