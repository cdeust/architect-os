import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import type { SpecPlanningConfig, SpecRoute } from '@architect-os/contracts';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DefineSource } from '../domain/source.js';

/**
 * The operator's pinned producer: the physical `mcp-server/index.js` of the plugin root, started only when its
 * SHA-256 equals the digest the operator gave. Every launch of the producer passes here, reads and planning alike.
 */
export function pinnedBundle(root: string, sha256: string): string {
  const bundle = join(realpathSync(root), 'mcp-server', 'index.js');
  if (
    realpathSync(bundle) !== bundle ||
    createHash('sha256').update(readFileSync(bundle)).digest('hex') !== sha256
  ) {
    throw Error('SPEC_BUNDLE_MISMATCH');
  }
  return bundle;
}

/**
 * Only read projections from the local operator's pinned bundle. It is started directly, never through the plugin's
 * `bin/ensure-deps.mjs`, so a read installs nothing: the operator provisions the bundle's runtime dependencies first.
 */
export async function readProjection(
  node: string,
  root: string,
  sha256: string,
  args:
    | { run_id: string; format: 'define_handoff_v1' }
    | { run_id: string; format: 'verified_plan_v1'; plan_step: string },
) {
  const bundle = pinnedBundle(root, sha256);
  const transport = new StdioClientTransport({
    command: node,
    args: [bundle],
    env: { PRD_GEN_SKILL_CONFIG: join(realpathSync(root), 'packages', 'skill', 'skill-config.json') },
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

export function prdGenSource(node: string, root: string, sha256: string): DefineSource {
  return {
    getHandoff: (run_id) => readProjection(node, root, sha256, { run_id, format: 'define_handoff_v1' }),
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
  const client = new Client({ name: 'architect-os-planning', version: '0.1.0' });
  try {
    return await use(async (name, args) => {
      if (!transport) {
        const plugin = realpathSync(root);
        const bundle = pinnedBundle(plugin, config.bundle_sha256);
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
