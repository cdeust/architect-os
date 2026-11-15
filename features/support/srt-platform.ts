import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { MemoryItem } from '@architect-os/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SrtSandboxRunner,
  type ProcessRunnerOptions,
  type Sandbox,
  type SandboxRunner,
} from '@architect-os/sandbox';
import { DataOperations } from '../../data/src/application/operations.js';
import { InMemoryDataStore } from '../../data/src/infrastructure/in-memory.js';
import { createDataMcpServer } from '../../data/src/presentation/mcp-server.js';
import type { TaskRouter } from '../../gateway/src/application/task-router.js';
import {
  InMemoryAuditLog,
  InMemoryAuthenticator,
  InMemoryQuota,
  SystemClock,
} from '../../gateway/src/infrastructure/in-memory.js';
import { RandomIds } from '../../gateway/src/infrastructure/mcp-routing.js';
import { TimerScheduler } from '../../gateway/src/infrastructure/usage-adapters.js';
import { composeNative } from '../../gateway/src/main.js';
import { keyFile, startTestBroker, testConfig } from '../../modules/broker/features/steps/harness.js';
import { startFakeModel, type FakeModel, type ModelTurn } from './fake-model.js';

/** The platform root: the module and the worker read their code there, and write nothing there. */
export const ROOT = realpathSync(new URL('../../', import.meta.url).pathname);
const SRT_CLI = createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js');
/** The built entry points topology/modules.mcp.json launches (tsc -b: npm test and the gate build first). */
const ENTRY_POINTS = ['modules/memory/dist/src/serve.js', 'services/memory/dist/worker/task-serve.js'];
/** A fake key of the broker, in a throwaway file: never a real one. */
export const BROKER_KEY = 'sk-ant-fake-broker-key-of-the-e2e-not-a-key';

/** The bearer token the clients' front accepts, and the subject it stands for. */
export const FRONT_TOKEN = 'front-token-of-the-e2e';
export const FRONT_SUBJECT = 'front-client';

/** The platform of the committed topology under srt, in this process, before a fake model; and how to close it. */
export interface SrtPlatform {
  readonly router: TaskRouter;
  /** The MCP server of the clients, over the router. */
  readonly createServer: () => McpServer;
  /** The audit log of the gateway: the calls of the clients and the operations of the router. */
  readonly audit: InMemoryAuditLog;
  /** The MCP client of data, to read its registry. */
  readonly data: Client;
  /** Every operation the gateway asked of data, in order: what it wrote to the registry, and what it did not. */
  readonly dataCalls: { name: string; arguments: Record<string, unknown> }[];
  /** Where the callback host of the modules listens. */
  readonly callback: { address: string; port: number };
  readonly model: FakeModel;
  /** The identifier of the memory data holds. */
  readonly memory: string;
  readonly brokerPort: number;
  /** Every memory the store holds, read through data. */
  memories(): Promise<MemoryItem[]>;
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

    const audit = new InMemoryAuditLog();
    const dataCalls: SrtPlatform['dataCalls'] = [];
    const recorded: Pick<Client, 'callTool'> = {
      callTool: (request, ...rest) => {
        dataCalls.push({ name: request.name, arguments: { ...request.arguments } });
        return data.callTool(request, ...rest);
      },
    };
    const clock = new SystemClock();
    const workers: Sandbox[] = [];
    const runners = (variables: Record<string, string>): SandboxRunner => {
      const runner = new SrtSandboxRunner(runnerOptions(variables));
      return {
        start: async (request) => {
          const sandbox = await runner.start(request);
          if (request.profile === 'worker') workers.push(sandbox);
          return sandbox;
        },
      };
    };
    const composed = await composeNative({
      files: {
        catalog: join(ROOT, 'topology', 'catalog.json'),
        servers: join(ROOT, 'topology', 'modules.mcp.json'),
        clients: join(ROOT, 'topology', 'clients.json'),
      },
      data: recorded,
      broker: broker.client,
      brokerPort,
      runners,
      root: ROOT,
      callbackPort: 0,
      auth: new InMemoryAuthenticator(new Map([[FRONT_TOKEN, { subject: FRONT_SUBJECT }]])),
      quota: new InMemoryQuota(1000, 60_000, clock),
      audit,
      clock,
      scheduler: new TimerScheduler(),
      ids: new RandomIds(),
      profile: 'owner',
      probeMs: 1000,
    });
    closers.push(() => composed.close());
    const { router, createServer, callback } = composed;
    const memories = async () => {
      const found = await data.callTool({ name: 'memory.search', arguments: { query: '', limit: 50 } });
      return JSON.parse((found.content as { text: string }[])[0]!.text) as MemoryItem[];
    };
    return {
      router,
      createServer,
      audit,
      data,
      dataCalls,
      callback,
      model,
      memory,
      brokerPort,
      memories,
      workers,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
