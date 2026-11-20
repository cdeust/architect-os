import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DefineSource } from '../domain/source.js';

/** The pinned plugin's .mcp.json names these two paths. The root is chosen by the local operator. */
export function prdGenSource(node: string, root: string): DefineSource {
  return {
    async getHandoff(runId) {
      const launcher = join(root, 'bin', 'ensure-deps.mjs');
      const transport = new StdioClientTransport({
        command: node,
        args: [launcher].concat(root),
        env: { PRD_GEN_SKILL_CONFIG: join(root, 'packages', 'skill', 'skill-config.json') },
        stderr: 'ignore',
      });
      const client = new Client({ name: 'architect-os-define', version: '0.1.0' });
      try {
        await client.connect(transport);
        return await client.request(
          {
            method: 'tools/call',
            params: { name: 'get_pipeline_state', arguments: { run_id: runId, format: 'define_handoff_v1' } },
          },
          CallToolResultSchema,
        );
      } finally {
        await transport.close();
      }
    },
  };
}
