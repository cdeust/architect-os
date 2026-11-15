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
  /** The workers of the agent tools, one sandbox per run. */
  workers: import('./domain/routing.js').AgentWorkers;
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
    deps.workers,
  );
  return { router, modules };
}

/** What the native gateway is built from: the topology, its children as clients, the runners, the ports of the platform. */
export interface NativeDependencies {
  files: import('./infrastructure/topology-files.js').TopologyFiles;
  /** The MCP client of data. */
  data: import('./infrastructure/mcp-routing.js').DataCaller;
  /** The MCP client of the broker, and the port of its relay. */
  broker: import('./infrastructure/usage-adapters.js').BrokerClient;
  brokerPort: number;
  /** A runner with the variables of a profile: the callback port for a module; the broker port and the task token for a worker. */
  runners: (variables: Record<string, string>) => import('@architect-os/sandbox').SandboxRunner;
  /** The platform root: the `cwd` of the launches. */
  root: string;
  /** The port the callback host listens on, 0 for any free port. */
  callbackPort: number;
  auth: Authenticator;
  quota: QuotaPolicy;
  audit: AuditLog;
  clock: Clock;
  scheduler: import('./domain/ports.js').Scheduler;
  ids: import('./domain/routing.js').Ids;
  /** The profile of the tasks opened for the clients. */
  profile: string;
  /** The period of the probe of data by the usage forwarder. */
  probeMs: number;
}

/**
 * Composes the native gateway: the callback host of the modules on the loopback, the modules and the workers under their
 * sandboxes, the router, the usage of the broker written through data, and the MCP server of the clients over the
 * router. The caller owns data, the broker and the HTTP host of the clients.
 */
export async function composeNative(deps: NativeDependencies) {
  const { createCallbackHost } = await import('./presentation/callback-host.js');
  const { WorkerHost } = await import('./infrastructure/worker-host.js');
  const { TaskSandboxGroups } = await import('./infrastructure/task-sandboxes.js');
  const { McpBrokerControl, McpUsageSink, onUsage } = await import('./infrastructure/usage-adapters.js');
  const { UsageForwarder } = await import('./application/usage-forwarder.js');
  const { RouterServices } = await import('./infrastructure/router-services.js');
  const { loadTopology } = await import('./infrastructure/topology-files.js');
  const { GatewayError } = await import('./domain/errors.js');
  const { once } = await import('node:events');

  // A profile the topology does not hold is refused here, with the topology, not at the first call of a client.
  const topology = loadTopology(deps.files);
  if (!topology.clients.profiles.some((profile) => profile.name === deps.profile))
    throw new GatewayError('UNKNOWN_PROFILE', `no profile ${deps.profile}`);
  const forwarder = new UsageForwarder(
    new McpUsageSink(deps.data),
    new McpBrokerControl(deps.broker),
    deps.scheduler,
    deps.probeMs,
  );
  const groups = new TaskSandboxGroups();
  const workers = new WorkerHost(
    topology.servers,
    ({ taskToken }) => deps.runners({ brokerPort: String(deps.brokerPort), taskToken }),
    { profile: 'worker', cwd: deps.root },
    groups,
  );
  // Nothing listens and nothing is launched until the whole of it is composed: a module is launched at its first
  // call (ModuleHost), and its runner takes the callback port then, once the callback host listens. Once closed, the
  // host has no port left to give: no module is launched after close().
  const { router, modules } = await composeRouting({
    files: deps.files,
    runner: { start: (request) => deps.runners({ callbackPort: String(listening().port) }).start(request) },
    launch: { profile: 'module', cwd: deps.root },
    data: deps.data,
    tokens: forwarder,
    sandboxes: groups,
    audit: deps.audit,
    clock: deps.clock,
    scheduler: deps.scheduler,
    ids: deps.ids,
    workers,
  });
  const front = compose({
    auth: deps.auth,
    quota: deps.quota,
    services: new RouterServices(router, deps.profile),
    audit: deps.audit,
    clock: deps.clock,
  });
  const callback = createCallbackHost(router);
  const listening = () => callback.address() as import('node:net').AddressInfo;
  // Last: a port that cannot be listened on rejects, with nothing behind it to close and nothing of the caller
  // touched. `once` leaves no listener behind (node:events): a later error of the host is not swallowed.
  callback.listen(deps.callbackPort, '127.0.0.1');
  await once(callback, 'listening');
  onUsage(deps.broker, (record) => forwarder.receive(record));
  return {
    createServer: front.createServer,
    router,
    /** Where the callback host of the modules listens: the loopback, and its port. */
    callback: { address: listening().address, port: listening().port },
    /**
     * Ends the open tasks and waits for what the router has under way (a call in flight, hence the worker it runs),
     * stops the modules, closes the callback host: each step is attempted whatever the one before did, so that a
     * failure leaves no sandbox running and nothing listening; close() then rejects with the first failure. The steps
     * run one after the other and set no bound: a registry that does not answer delays the stop of the modules, up
     * to the timeout of its MCP request. Whoever calls close() bounds it.
     */
    close: async () => {
      const steps = [
        () => router.shutdown(),
        () => modules.close(),
        () => new Promise<void>((resolve) => callback.close(() => resolve())),
      ];
      const failures: unknown[] = [];
      for (const step of steps) await step().catch((error: unknown) => failures.push(error));
      if (failures.length > 0) throw failures[0];
    },
  };
}
