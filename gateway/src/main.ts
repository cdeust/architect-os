import { pathToFileURL } from 'node:url';
import { TOOLS, TOOL_NAMES } from '@architect-os/contracts';
import { CallTool } from './application/call-tool.js';
import type { AuditLog, Authenticator, Clock, QuotaPolicy, ServiceClient } from './domain/ports.js';
import { InMemoryAuthenticator, InMemoryQuota, SystemClock } from './infrastructure/in-memory.js';
import { connectMcpOverHttp } from './infrastructure/mcp-connect.js';
import { McpServiceClient } from './infrastructure/mcp-service-client.js';
import { JsonLinesAuditLog } from './infrastructure/stdout-audit-log.js';
import { createHttpHost } from './presentation/http-host.js';
import { createGatewayServer } from './presentation/mcp-server.js';

export interface GatewayDependencies {
  auth: Authenticator;
  quota: QuotaPolicy;
  services: ServiceClient;
  audit: AuditLog;
  clock: Clock;
}

/** Composition root. All wiring of the gateway happens here. */
export function compose(deps: GatewayDependencies) {
  const callTool = new CallTool(deps.auth, deps.quota, deps.services, deps.audit, deps.clock);
  return { createServer: () => createGatewayServer(callTool) };
}

/** Every service that owns a tool of the catalogue, and the variable holding its URL (memory -> MEMORY_URL). */
export function routes(): { service: string; urlVariable: string }[] {
  const owners = [...new Set(TOOL_NAMES.map((name) => TOOLS[name].owner))];
  return owners.map((service) => ({ service, urlVariable: `${service.toUpperCase()}_URL` }));
}

function parseTokens(raw: string): Map<string, { subject: string }> {
  // GATEWAY_TOKENS="token1=alice;token2=bob" (local development only; see docs/infrastructure.md).
  return new Map(
    raw
      .split(';')
      .filter(Boolean)
      .map((pair) => {
        const [token, subject] = pair.split('=');
        return [token ?? '', { subject: subject ?? 'unknown' }] as const;
      }),
  );
}

async function main(): Promise<void> {
  const connections = new Map(
    await Promise.all(
      routes().map(async ({ service, urlVariable }) => {
        const url = process.env[urlVariable];
        if (url === undefined || url === '') throw new Error(`${urlVariable} is required`);
        return [service, await connectMcpOverHttp(url, 'gateway')] as const;
      }),
    ),
  );
  const clock = new SystemClock();
  const app = compose({
    auth: new InMemoryAuthenticator(parseTokens(process.env['GATEWAY_TOKENS'] ?? '')),
    quota: new InMemoryQuota(Number(process.env['QUOTA_PER_MINUTE'] ?? 60), 60_000, clock),
    services: new McpServiceClient(connections),
    audit: new JsonLinesAuditLog(),
    clock,
  });
  const port = Number(process.env['PORT'] ?? 8080);
  createHttpHost(app.createServer).listen(port, () => console.warn(`gateway listening on :${port}`));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

/** What the routing of brick 1b.4 is built from: the files of the topology and the adapters of its ports. */
export interface RoutingDependencies {
  files: import('./infrastructure/topology-files.js').TopologyFiles;
  runner: import('@architect-os/sandbox').SandboxRunner;
  launch: import('./infrastructure/module-host.js').ModuleLaunch;
  /** The MCP client of data, child of the gateway on stdio. */
  data: import('./infrastructure/mcp-routing.js').DataCaller;
  tokens: import('./domain/routing.js').TaskTokens;
  sandboxes: import('./domain/routing.js').TaskSandboxes;
  audit: AuditLog;
  clock: Clock;
  scheduler: import('./domain/ports.js').Scheduler;
  ids: import('./domain/routing.js').Ids;
}

/**
 * Composes the routing of the tasks (docs/design/platform-v3-srt.md, §2, brick 1b.4): the topology loaded whole, or
 * refused before any module is launched; the modules hosted in their sandboxes; the router over them and data. Its
 * imports are inline so that the lines above keep their positions (tools/test-gate/mutation-debt.json).
 */
export async function composeRouting(deps: RoutingDependencies) {
  const { loadTopology } = await import('./infrastructure/topology-files.js');
  const { ModuleHost } = await import('./infrastructure/module-host.js');
  const { McpDataClient, McpTaskRegistry } = await import('./infrastructure/mcp-routing.js');
  const { TaskRouter } = await import('./application/task-router.js');
  const topology = loadTopology(deps.files);
  const modules = new ModuleHost(topology.servers, deps.runner, deps.launch);
  const router = new TaskRouter(
    topology,
    modules,
    new McpDataClient(deps.data),
    new McpTaskRegistry(deps.data),
    deps.tokens,
    deps.sandboxes,
    deps.audit,
    deps.clock,
    deps.scheduler,
    deps.ids,
  );
  return { router, modules };
}
