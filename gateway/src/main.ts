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

/** What the process of the native gateway is given: everything that touches the outside, so that a scenario drives it. */
export interface NativeHost {
  env: Readonly<Record<string, string | undefined>>;
  /** The platform root and the absolute path of node, for the configuration. */
  root: string;
  node: string;
  /** The refusals of the process, and what its children write on their stderr, each line prefixed by the name of its process. */
  stderr: import('node:stream').Writable;
  audit: AuditLog;
  /** What starts a child by name, over the closed list of the configuration; `log` takes what a child writes on its stderr. */
  launch(
    processes: import('./infrastructure/native-config.js').NativeConfig['processes'],
    log: (name: string, text: string) => void,
  ): { start(name: string): Promise<import('@architect-os/sandbox').NativeChild> };
  runners: NativeDependencies['runners'];
  /** Resolves when the process is asked to stop. */
  stopped: Promise<void>;
  /** The bound of the stop, from its beginning, on `scheduler`. */
  graceMs: number;
  scheduler: import('./domain/ports.js').Scheduler;
  /** The period of the probe of data by the usage forwarder. */
  probeMs: number;
}

/**
 * The process of the native gateway (docs/design/platform-v3-srt.md, §8, 1b.6a): data and the broker as children
 * on their stdio, the composition, the HTTP host of the clients on the loopback; it runs until it is asked to stop or
 * a child exits (the gateway does not outlive them, §2). Resolves with the exit code, once the children have exited:
 * 0 when asked to stop, 1 for a refused configuration, a failed start, a child that exited or a stop that failed.
 *
 * The stop is the same whatever led to it: the HTTP host ends its connections and the composition closes; once that
 * is over, or `graceMs` after the stop began, every sandbox still alive is killed; then the children are closed. Past
 * the bound the composition is left behind, not cancelled: it goes on as long as the process lives, stops a
 * sandbox whose launch ends later (ModuleHost.close waits for the launches; a worker whose call is cancelled stops
 * itself). A stop asked while the process starts waits for the start: nothing but the two children exists until then,
 * and they end with their stdin if the process is killed.
 */
export async function serveNative(host: NativeHost): Promise<number> {
  const { readNativeConfig } = await import('./infrastructure/native-config.js');
  const { connectOverStreams } = await import('./infrastructure/stream-transport.js');
  const { RandomIds } = await import('./infrastructure/mcp-routing.js');
  const { once } = await import('node:events');

  const say = (text: string): void => void host.stderr.write(`${text}\n`);
  let config;
  try {
    config = readNativeConfig(host.env, host.root, host.node);
  } catch (error) {
    say(`gateway: ${(error as Error).message}`);
    return 1;
  }
  let code = 0;
  const fail = (error: unknown): void => {
    code = 1;
    say(`gateway: ${(error as Error).message}`);
  };
  // What a child writes comes in chunks: a line is written once whole, and the last one when the child is gone.
  const partial = new Map<string, string>();
  const log = (name: string, text: string): void => {
    const lines = `${partial.get(name) ?? ''}${text}`.split('\n');
    partial.set(name, lines.pop()!);
    for (const line of lines) say(`${name}: ${line}`);
  };
  const children: import('@architect-os/sandbox').NativeChild[] = [];
  // Every sandbox the runners start is kept until it exits: a sandbox is a detached process group, it survives the
  // gateway if nobody kills it.
  const live = new Set<import('@architect-os/sandbox').Sandbox>();
  const runners: NativeDependencies['runners'] = (variables) => {
    const runner = host.runners(variables);
    return {
      start: async (request) => {
        const sandbox = await runner.start(request);
        live.add(sandbox);
        void sandbox.exited.then(() => live.delete(sandbox));
        return sandbox;
      },
    };
  };
  const connected = (child: (typeof children)[number]) => connectOverStreams(child.stdout, child.stdin);
  let composed: Awaited<ReturnType<typeof composeNative>> | undefined;
  let web: import('node:http').Server | undefined;
  try {
    const launcher = host.launch(config.processes, log);
    const data = await launcher.start('data');
    children.push(data);
    const broker = await launcher.start('broker');
    children.push(broker);
    const clock = new SystemClock();
    composed = await composeNative({
      files: config.files,
      data: await connected(data),
      broker: await connected(broker),
      brokerPort: config.brokerPort,
      runners,
      root: host.root,
      callbackPort: 0,
      auth: new InMemoryAuthenticator(
        new Map([...config.tokens].map(([token, subject]) => [token, { subject }])),
      ),
      quota: new InMemoryQuota(config.quotaPerMinute, 60_000, clock),
      audit: host.audit,
      clock,
      scheduler: host.scheduler,
      ids: new RandomIds(),
      profile: config.profile,
      probeMs: host.probeMs,
    });
    web = createHttpHost(composed.createServer);
    web.listen(config.port, '127.0.0.1');
    // `once` rejects when the host emits `error` first: a port that is taken.
    await once(web, 'listening');
    const first = await Promise.race([
      host.stopped.then(() => undefined),
      data.exited.then(() => 'data'),
      broker.exited.then(() => 'broker'),
    ]);
    if (first !== undefined) fail(new Error(`${first} exited`));
  } catch (error) {
    fail(error);
  }

  // The stop. Past the bound the composition is left behind: what it could not stop in time is killed below, and
  // what it reports from then on is said to come after the bound.
  const serving = web;
  let behind = false;
  const closing = (async () => {
    if (serving?.listening)
      await new Promise<void>((done) => {
        serving.close(() => done());
        serving.closeAllConnections();
      });
    await composed?.close();
  })().catch((error: unknown) =>
    fail(behind ? new Error(`after the bound: ${(error as Error).message}`) : error),
  );
  await Promise.race([closing, new Promise<void>((bound) => host.scheduler.after(host.graceMs, bound))]);
  behind = true;
  await Promise.all(
    [...live].map((sandbox) =>
      sandbox
        .stop()
        .catch((error: unknown) => fail(new Error(`killing a sandbox: ${(error as Error).message}`))),
    ),
  );
  await Promise.all(children.map((child) => child.close()));
  for (const [name, rest] of partial) if (rest !== '') say(`${name}: ${rest}`);
  return code;
}

/** What the entry reads of its process; `process` is one. */
export interface GatewayProcess {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  readonly stderr: import('node:stream').Writable;
  on(signal: 'SIGTERM' | 'SIGINT', stop: () => void): unknown;
}

/**
 * The host of the real process, for `entry`, the URL of its entry file (gateway/dist/src/serve.js: three levels under
 * the platform root): the real launcher of the two children, the srt runner of the sandboxes, the audit log on stdout,
 * a stop on SIGTERM and SIGINT. The entry file itself holds nothing a scenario could not reach here.
 */
export async function nativeHost(proc: GatewayProcess, entry: string): Promise<NativeHost> {
  const { realpathSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { NativeLauncher, SrtSandboxRunner, processRunnerOptions, timer } =
    await import('@architect-os/sandbox');
  const { TimerScheduler } = await import('./infrastructure/usage-adapters.js');
  const root = realpathSync(fileURLToPath(new URL('../../../', entry)));
  return {
    env: proc.env,
    root,
    node: proc.execPath,
    stderr: proc.stderr,
    audit: new JsonLinesAuditLog(),
    // A child is given 5 s between the end of its stdin and its kill; the stop of the gateway 10 s before it kills
    // the sandboxes that are left (srt then gives a group 2 s): 17 s at worst from the signal to the end, under the
    // 20 s a supervisor such as launchd leaves by default. The usage forwarder probes data every second while down.
    launch: (processes, log) => new NativeLauncher(processes, { graceMs: 5000, schedule: timer, log }),
    runners: (variables) => new SrtSandboxRunner(processRunnerOptions(root, proc.execPath, variables)),
    // The listeners stay: a second signal during the stop (a double Ctrl-C) is ignored instead of ending the
    // process by its default action, with its sandboxes left behind.
    stopped: new Promise<void>((resolve) => {
      proc.on('SIGTERM', resolve);
      proc.on('SIGINT', resolve);
    }),
    graceMs: 10_000,
    scheduler: new TimerScheduler(),
    probeMs: 1000,
  };
}
