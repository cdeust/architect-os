import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DefineSource } from '../domain/source.js';

/** Only read projections from the local operator's pinned plugin. */
export async function readProjection(
  node: string,
  root: string,
  args:
    | { run_id: string; format: 'define_handoff_v1' }
    | { run_id: string; format: 'verified_plan_v1'; plan_step: string },
) {
  const transport = new StdioClientTransport({
    command: node,
    args: [join(root, 'bin', 'ensure-deps.mjs'), root],
    env: { PRD_GEN_SKILL_CONFIG: join(root, 'packages', 'skill', 'skill-config.json') },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'architect-os-define', version: '0.1.0' });
  try {
    await client.connect(transport);
    return await client.request(
      {
        method: 'tools/call',
        params: { name: 'get_pipeline_state', arguments: args },
      },
      CallToolResultSchema,
    );
  } finally {
    await transport.close();
  }
}

export function prdGenSource(node: string, root: string): DefineSource {
  return { getHandoff: (run_id) => readProjection(node, root, { run_id, format: 'define_handoff_v1' }) };
}
