import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import type { SpecPlanningConfig, SpecRoute } from '@architect-os/contracts';
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

const routeEnv = ({ provider, model }: SpecRoute) => `${provider}/${model}`;

/** A separate MCP instance per host journal, using the installed distribution. */
export async function withPlanningSpec<T>(
  node: string,
  root: string,
  home: string,
  temporary: string,
  config: SpecPlanningConfig,
  use: (call: (tool: string, arguments_: Record<string, unknown>) => Promise<string>) => Promise<T>,
): Promise<T> {
  let transport: StdioClientTransport | undefined;
  const client = new Client({ name: 'architect-os-planning', version: '0.1.0' });
  try {
    return await use(async (name, args) => {
      if (!transport) {
        const plugin = realpathSync(root);
        const bundle = join(plugin, 'mcp-server', 'index.js');
        if (
          realpathSync(bundle) !== bundle ||
          createHash('sha256').update(readFileSync(bundle)).digest('hex') !== config.bundle_sha256
        ) {
          throw Error('SPEC_BUNDLE_MISMATCH');
        }
        transport = new StdioClientTransport({
          command: node,
          args: [bundle],
          cwd: home,
          env: {
            HOME: home,
            USERPROFILE: home,
            TMPDIR: temporary,
            TMP: temporary,
            TEMP: temporary,
            PRD_GEN_SKILL_CONFIG: join(plugin, 'packages', 'skill', 'skill-config.json'),
            PRD_GEN_PLAN_DRAFTER: routeEnv(config.drafter.route),
            PRD_GEN_PLAN_REVIEWER: routeEnv(config.reviewer.route),
            ...(config.panel_reviewer
              ? { PRD_GEN_PLAN_PANEL_REVIEWER: routeEnv(config.panel_reviewer.route) }
              : {}),
          },
          stderr: 'ignore',
        });
        await client.connect(transport);
      }
      const response = await client.request(
        {
          method: 'tools/call',
          params: { name, arguments: args },
        },
        CallToolResultSchema,
      );
      const part = response.content[0]!;
      if (response.isError || response.content.length !== 1 || part.type !== 'text') {
        throw Error(`SPEC_TOOL_REFUSED: ${name}`);
      }
      return part.text;
    });
  } finally {
    await transport?.close();
  }
}
