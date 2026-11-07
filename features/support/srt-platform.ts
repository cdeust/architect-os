import { existsSync, realpathSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SrtSandboxRunner, type ProcessRunnerOptions, type Sandbox } from '@architect-os/sandbox';
import { DataOperations } from '../../data/src/application/operations.js';
import { InMemoryDataStore } from '../../data/src/infrastructure/in-memory.js';
import { createDataMcpServer } from '../../data/src/presentation/mcp-server.js';
import type { TaskRouter } from '../../gateway/src/application/task-router.js';
import { BrokerTaskTokens } from '../../gateway/src/infrastructure/broker-task-tokens.js';
import { InMemoryAuditLog, SystemClock } from '../../gateway/src/infrastructure/in-memory.js';
import { RandomIds } from '../../gateway/src/infrastructure/mcp-routing.js';
import { TaskSandboxGroups } from '../../gateway/src/infrastructure/task-sandboxes.js';
import { loadTopology } from '../../gateway/src/infrastructure/topology-files.js';
import { McpBrokerControl, TimerScheduler } from '../../gateway/src/infrastructure/usage-adapters.js';
import { WorkerHost } from '../../gateway/src/infrastructure/worker-host.js';
import { composeRouting } from '../../gateway/src/main.js';
import { createCallbackHost } from '../../gateway/src/presentation/callback-host.js';
import { keyFile, startTestBroker, testConfig } from '../../modules/broker/features/steps/harness.js';
import { startFakeModel, type FakeModel, type ModelTurn } from './fake-model.js';

/** The platform root: the module and the worker read their code there, and write nothing there. */
export const ROOT = realpathSync(new URL('../../', import.meta.url).pathname);
const SRT_CLI = createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js');
/** The built entry points topology/modules.mcp.json launches (tsc -b: npm test and the gate build first). */
const ENTRY_POINTS = ['modules/memory/dist/src/serve.js', 'services/memory/dist/worker/task-serve.js'];
/** A fake key of the broker, in a throwaway file: never a real one. */
export const BROKER_KEY = 'sk-ant-fake-broker-key-of-the-e2e-not-a-key';

/** The platform of the committed topology under srt, in this process, before a fake model; and how to close it. */
export interface SrtPlatform {
  readonly router: TaskRouter;
  readonly model: FakeModel;
  /** The identifier of the memory data holds. */
  readonly memory: string;
  readonly brokerPort: number;
  /** The sandboxes of the workers, in launch order. */
  readonly workers: Sandbox[];
  close(): Promise<void>;
}

/** The options of a platform runner: the committed profiles, a disposable cwd, the variables of its launcher. */
export const runnerOptions = (variables: Record<string, string>): ProcessRunnerOptions => ({
  profilesDir: join(ROOT, 'packages', 'sandbox', 'profiles'),
  srtCli: SRT_CLI,
  node: process.execPath,
  canaryProbe: join(ROOT, 'packages', 'sandbox', 'src', 'canary-probe.mjs'),
  tmpRoot: tmpdir(),
  home: homedir(),
  hostEnv: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: process.env['HOME'] },
  trusted: [],
  variables,
  workspace: 'disposable',
});

/**
 * Starts the platform as features/sandbox/recall.feature proves it: data in memory over MCP holding one memory, the
 * broker before a fake model with a fake key, the callback of the modules on a free loopback port, and the router of
 * the committed topology, its module memory and its workers under srt in their profiles.
 */
export async function startSrtPlatform(
  content: string,
  script: readonly ModelTurn[],
  options: { readonly cycle?: boolean } = {},
): Promise<SrtPlatform> {
  for (const entry of ENTRY_POINTS)
    if (!existsSync(join(ROOT, entry)))
      throw new Error(`${entry} is built by tsc -b before the suite (npm test, the gate)`);
  const closers: (() => Promise<void> | void)[] = [];
  const close = async () => {
    for (const closer of closers.reverse()) await closer();
  };
  try {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createDataMcpServer(new DataOperations(new InMemoryDataStore()));
    await server.connect(serverSide);
    closers.push(() => server.close());
    const data = new Client({ name: 'e2e-gateway', version: '0.0.0' });
    await data.connect(clientSide);
    const inserted = await data.callTool({ name: 'memory.insert', arguments: { content, tags: [] } });
    const memory = (JSON.parse((inserted.content as { text: string }[])[0]!.text) as { id: string }).id;

    const model = await startFakeModel(script, options);
    closers.push(() => model.close());
    const key = keyFile(BROKER_KEY);
    closers.push(() => key.remove());
    const broker = await startTestBroker(testConfig(model.url, key.file));
    closers.push(() => broker.broker.close());
    const brokerPort = broker.broker.relay.port;

    // The callback is listened before the router exists: it reaches the router once composed.
    let router: TaskRouter | undefined;
    const callback = createCallbackHost({
      describe: (id) => router!.describe(id),
      operate: (call, op, args) => router!.operate(call, op, args),
      call: (caller, address, args) => router!.call(caller, address, args),
    });
    await new Promise<void>((resolve) => callback.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => callback.close(() => resolve())));
    const callbackPort = String((callback.address() as AddressInfo).port);

    const files = {
      catalog: join(ROOT, 'topology', 'catalog.json'),
      servers: join(ROOT, 'topology', 'modules.mcp.json'),
      clients: join(ROOT, 'topology', 'clients.json'),
    };
    const groups = new TaskSandboxGroups();
    const workers: Sandbox[] = [];
    const host = new WorkerHost(
      loadTopology(files).servers,
      ({ taskToken }) => new SrtSandboxRunner(runnerOptions({ brokerPort: String(brokerPort), taskToken })),
      { profile: 'worker', cwd: ROOT },
      { add: (task, sandbox) => (workers.push(sandbox), groups.add(task, sandbox)) },
    );
    const composed = await composeRouting({
      files,
      runner: new SrtSandboxRunner(runnerOptions({ callbackPort })),
      launch: { profile: 'module', cwd: ROOT },
      data,
      tokens: new BrokerTaskTokens(new McpBrokerControl(broker.client)),
      sandboxes: groups,
      audit: new InMemoryAuditLog(),
      clock: new SystemClock(),
      scheduler: new TimerScheduler(),
      ids: new RandomIds(),
      workers: host,
    });
    router = composed.router;
    closers.push(() => composed.modules.close());
    return { router, model, memory, brokerPort, workers, close };
  } catch (error) {
    await close();
    throw error;
  }
}
