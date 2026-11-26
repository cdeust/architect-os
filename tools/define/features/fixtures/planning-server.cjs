const { appendFileSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { createInterface } = require('node:readline');

async function serve() {
  let client;
  let submission;
  for await (const line of createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) continue;
    let result;
    if (method === 'initialize') {
      client = params.clientInfo;
      result = {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      };
    } else {
      const { name, arguments: args } = params;
      const run_id = 'run_fixture_native';
      let body;
      switch (name) {
        case 'start_pipeline':
          body = { run_id };
          break;
        case 'get_pipeline_state': {
          const invocation = {
            invocation_id: 'first',
            subagent_type: 'author',
            description: 'draft',
            prompt: 'Write a proposal',
            model: 'fixture-author',
            model_route: { provider: 'openai', model: 'fixture-author' },
            isolation: 'none',
          };
          const action = submission
            ? {
                kind: 'done',
                summary: '',
                outcome: { status: 'needs_attention', reasons: ['fixture complete'] },
              }
            : { kind: 'spawn_subagents', purpose: 'draft', batch_id: 'batch', invocations: [invocation] };
          body = { run_id, action, __page: { offset: 0, count: 1, total: 1, next_offset: null } };
          break;
        }
        case 'submit_action_result':
          submission = args.result;
          appendFileSync('submitted.ndjson', JSON.stringify(submission) + '\n');
          body = { run_id };
          break;
        default:
          body = {
            client,
            method,
            name,
            args,
            cwd: process.cwd(),
            home: process.env.HOME,
            profile: process.env.USERPROFILE,
            tmp: [process.env.TMPDIR, process.env.TMP, process.env.TEMP],
            skill: process.env.PRD_GEN_SKILL_CONFIG,
            drafter: process.env.PRD_GEN_PLAN_DRAFTER,
            reviewer: process.env.PRD_GEN_PLAN_REVIEWER,
            panel: process.env.PRD_GEN_PLAN_PANEL_REVIEWER,
            file: __filename,
            outside: (() => {
              try {
                return readFileSync(join(dirname(process.env.HOME), 'outside.txt'), 'utf8');
              } catch (error) {
                return error.code;
              }
            })(),
            child: process.permission.has('child'),
            net: process.permission.has('net'),
          };
      }
      const text = { type: 'text', text: JSON.stringify(body) };
      result = { content: [text] };
      if (name === 'error') result.isError = true;
      if (name === 'multiple') result.content.push(text);
      if (name === 'empty') result.content = [];
      if (name === 'image') result.content = [{ type: 'image', data: 'YQ==', mimeType: 'image/png' }];
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }
  appendFileSync('transport-closed', 'closed\n');
}

serve().catch(() => {
  process.exitCode = 1;
});
