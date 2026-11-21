import assert from 'node:assert/strict';
import { record } from '../../src/application/agy-response.js';
import { devNull } from 'node:os';
import { Then } from '@cucumber/cucumber';
import { nativeInvocation, parseNative, type PlanProvider } from '../../src/infrastructure/plan-cli.js';

Then('the three native CLI invocations close their tool surfaces and pin the chosen model', function () {
  const handoff = {
    version: 1 as const,
    run_id: 'r',
    requirements: [{ id: 'FR-1', text: 'Verify.' }],
    acceptance: [{ id: 'AC-1', text: 'Check.', requirement_ids: ['FR-1'] }],
  };
  const common = { handoff, model: 'explicit-model', step: 'delivery', timeoutMs: 5000 };
  const claude = nativeInvocation({ ...common, provider: 'claude' });
  assert.deepEqual(claude.args, [
    '--print',
    '--model',
    'explicit-model',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--settings',
    '{"disableAllHooks":true,"forceLoginMethod":"claudeai"}',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--output-format',
    'json',
  ]);
  const gpt = nativeInvocation({ ...common, provider: 'gpt' });
  const flags = [
    'plugins',
    'apps',
    'hooks',
    'shell_tool',
    'unified_exec',
    'multi_agent',
    'multi_agent_v2',
    'memories',
  ].flatMap((f) => ['--disable', f]);
  assert.deepEqual(gpt.args, [
    'exec',
    '--model',
    'explicit-model',
    '--ephemeral',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ignore-user-config',
    '--ignore-rules',
    ...flags,
    '-c',
    'web_search="disabled"',
    '-c',
    'mcp_servers={}',
    '-c',
    'approval_policy="never"',
    '-c',
    'forced_login_method="chatgpt"',
    '-c',
    'project_doc_max_bytes=0',
    '-',
  ]);
  const google = nativeInvocation({ ...common, provider: 'gemini' });
  const settings = {
    modelProvider: '',
    agentMode: '',
    useG1Credits: false,
    toolPermission: 'strict',
    permissions: {
      deny: ['read_file(*)', 'write_file(*)', 'command(*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)'],
    },
  };
  assert.deepEqual(google.args, [
    '--model',
    'explicit-model',
    '--mode',
    'plan',
    '--sandbox',
    '--disable-slash-commands',
    '--log-file',
    devNull,
    '--settings',
    JSON.stringify(settings),
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
  ]);
  assert.equal(claude.input, gpt.input);
  assert.match(claude.input, /Use no tools/);
  assert.deepEqual(JSON.parse(claude.input.split('\n')[1]!), { step: 'delivery', handoff });
  assert.ok(google.input.endsWith('\n'));
  assert.deepEqual(JSON.parse(google.input), { event: 'user', message: { content: claude.input } });
});

Then('only native single-turn drafting events and measured counters are accepted', function () {
  const parse = (provider: PlanProvider, rows: object[]) =>
    parseNative(
      provider,
      provider === 'claude'
        ? JSON.stringify(rows[0], null, 2)
        : rows.map((e) => JSON.stringify(e)).join('\n'),
      'fixture',
    );
  const usage = {
    input_tokens: 3,
    output_tokens: 4,
    cache_read_input_tokens: 1,
    cache_creation_input_tokens: 2,
  };
  const c = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'proposal',
    usage,
    modelUsage: { 'claude-live': {} },
    total_cost_usd: 0.09,
  };
  const cResult = parse('claude', [c]);
  assert.equal(cResult.text, 'proposal');
  assert.deepEqual(cResult.usage, {
    model_reported: 'claude-live',
    input_tokens: 3,
    output_tokens: 4,
    cache_read_tokens: 1,
    cache_creation_tokens: 2,
    reasoning_tokens: null,
    cost_usd: 0.09,
  });
  assert.throws(() => parse('claude', [{ ...c, type: 'error' }]));
  for (const change of [{ is_error: true }, { subtype: 'error' }, { result: {} }])
    assert.equal(parse('claude', [{ ...c, ...change }]).text, null);
  for (const modelUsage of [{ a: {}, b: {} }, { 'bad/': {} }, { '/bad': {} }, {}])
    assert.equal(parse('claude', [{ ...c, modelUsage }]).usage.model_reported, null);
  for (const total_cost_usd of [-1, '1', null])
    assert.equal(parse('claude', [{ ...c, total_cost_usd }]).usage.cost_usd, null);
  const start = { type: 'thread.started' },
    turn = { type: 'turn.started' },
    msg = { type: 'item.completed', item: { type: 'agent_message', text: 'proposal' } },
    reason = { type: 'item.completed', item: { type: 'reasoning' } },
    end = {
      type: 'turn.completed',
      usage: {
        input_tokens: 3,
        output_tokens: 4,
        cached_input_tokens: 1,
        cache_write_input_tokens: 2,
        reasoning_output_tokens: 3,
      },
    };
  const gResult = parse('gpt', [start, turn, reason, msg, end]);
  assert.equal(gResult.text, 'proposal');
  assert.deepEqual(gResult.usage, {
    model_reported: null,
    input_tokens: 3,
    output_tokens: 4,
    cache_read_tokens: 1,
    cache_creation_tokens: 2,
    reasoning_tokens: 3,
    cost_usd: null,
  });
  for (const rows of [
    [start, msg],
    [start, turn, end],
    [start, msg, msg, end],
    [start, { type: 'unexpected' }, msg, end],
    [start, { type: 'item.completed', item: { type: 'tool' } }, msg, end],
  ])
    assert.throws(() => parse('gpt', rows));
  const i = { event: 'init', conversation_id: 'r', init: { model: 'fixture', permission_mode: 'strict' } },
    step = { conversation_id: 'r', step_type: 'agent_response', state: 'DONE' },
    u = { event: 'step_update', step_update: step },
    result = {
      conversation_id: 'r',
      num_turns: 1,
      status: 'SUCCESS',
      response: 'proposal',
      usage: { input_tokens: 2, output_tokens: 3, cache_read_tokens: 4, thinking_tokens: 5 },
    },
    z = { event: 'result', result };
  const read = (rows: object[]) => parse('gemini', rows);
  for (const invalid of [null, false, 0, '', 'text', []])
    assert.throws(() => record(invalid), /invalid_object/);
  for (const id of ['', 42])
    assert.throws(
      () =>
        read([
          { ...i, conversation_id: id },
          { ...z, result: { ...result, conversation_id: id } },
        ]),
      /unexpected_invocation/,
    );
  assert.throws(() => read([z]), /incomplete_stream/);
  assert.throws(() => read([i, { event: 'other' }, z]), /unexpected_event/);
  assert.throws(
    () => read([i, { ...u, step_update: { ...step, tool_name: 'read_file' } }, z]),
    /unexpected_step/,
  );
  assert.equal(
    parseNative(
      'claude',
      JSON.stringify(c).replace('"total_cost_usd":0.09', '"total_cost_usd":1e999'),
      'fixture',
    ).usage.cost_usd,
    null,
  );
  const a = read([i, u, z]);
  assert.equal(a.text, 'proposal');
  assert.deepEqual(a.usage, {
    model_reported: null,
    input_tokens: 2,
    output_tokens: 3,
    cache_read_tokens: 4,
    cache_creation_tokens: null,
    reasoning_tokens: 5,
    cost_usd: null,
  });
  for (const init of [
    { ...i, event: 'x' },
    { ...i, conversation_id: '' },
    { ...i, conversation_id: 1 },
    { ...i, init: { ...i.init, model: 'wrong' } },
    { ...i, init: { ...i.init, permission_mode: 'auto' } },
  ])
    assert.throws(() => read([init, u, z]));
  for (const key of ['tool_name', 'tool_info', 'subagent_info'])
    assert.throws(() => read([i, { ...u, step_update: { ...step, [key]: null } }, z]));
  for (const mod of [{ conversation_id: 'wrong' }, { state: 'ERROR' }, { step_type: 'command' }])
    assert.throws(() => read([i, { ...u, step_update: { ...step, ...mod } }, z]));
  for (const step_type of ['user_input', 'checkpoint'])
    assert.equal(
      read([i, { ...u, step_update: { ...step, step_type, state: 'ACTIVE' } }, z]).text,
      'proposal',
    );
  for (const rows of [
    [i, { ...u, event: 'x' }, z],
    [i, u, { ...z, event: 'x' }],
    [i, u, { ...z, result: { ...result, num_turns: 2 } }],
    [i, u, { ...z, result: { ...result, conversation_id: 'other' } }],
  ])
    assert.throws(() => read(rows));
  assert.equal(read([i, { ...z, result: { ...result, status: 'ERROR' } }]).text, null);
  for (const n of [-1, 1.5, '12', null])
    assert.equal(
      read([i, { ...z, result: { ...result, usage: { input_tokens: n } } }]).usage.input_tokens,
      null,
    );
});
