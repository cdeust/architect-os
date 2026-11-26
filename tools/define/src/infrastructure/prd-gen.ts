import { homedir } from 'node:os';
import type { SpecPlanningConfig, SpecRoute } from '@architect-os/contracts';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DefineSource } from '../domain/source.js';
import { producerArguments, stageProducer } from './producer.js';

/**
 * Only read projections from the operator's pinned producer (`producer.ts`): a private copy of the pinned files,
 * run under the permission model. It is never started through the plugin's `bin/ensure-deps.mjs`, so a read
 * installs nothing; the server may read and write only its data directory, `~/.prd-gen` of the given home.
 */
export async function readProjection(
  node: string,
  root: string,
  sha256: string,
  args:
    | { run_id: string; format: 'define_handoff_v1' }
    | { run_id: string; format: 'verified_plan_v1'; plan_step: string },
  home: string = homedir(),
) {
  const staged = stageProducer(root, sha256);
  try {
    const transport = new StdioClientTransport({
      command: node,
      args: producerArguments(staged, [join(home, '.prd-gen')]),
      env: { HOME: home, PRD_GEN_SKILL_CONFIG: staged.skillConfig },
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
  } finally {
    staged.dispose();
  }
}

export function prdGenSource(node: string, root: string, sha256: string, home?: string): DefineSource {
  return {
    getHandoff: (run_id) => readProjection(node, root, sha256, { run_id, format: 'define_handoff_v1' }, home),
  };
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
  let staged: ReturnType<typeof stageProducer> | undefined;
  const client = new Client({ name: 'architect-os-planning', version: '0.1.0' });
  try {
    return await use(async (name, args) => {
      if (!transport) {
        staged = stageProducer(root, config.producer_sha256);
        transport = new StdioClientTransport({
          command: node,
          args: producerArguments(staged, [home, temporary]),
          cwd: home,
          env: {
            HOME: home,
            USERPROFILE: home,
            TMPDIR: temporary,
            TMP: temporary,
            TEMP: temporary,
            PRD_GEN_SKILL_CONFIG: staged.skillConfig,
            PRD_GEN_PLAN_DRAFTER: routeEnv(config.drafter.route),
            PRD_GEN_PLAN_REVIEWER: routeEnv(config.reviewer.route),
            ...(config.panel_reviewer
              ? { PRD_GEN_PLAN_PANEL_REVIEWER: routeEnv(config.panel_reviewer.route) }
              : {}),
          },
          stderr: 'ignore',
        });
        try {
          await client.connect(transport);
        } catch {
          throw Error('SPEC_TRANSPORT_FAILED');
        }
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
    staged?.dispose();
  }
}
