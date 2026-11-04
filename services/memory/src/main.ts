import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Writable } from 'node:stream';
import { IntentService } from './application/intent-service.js';
import { InternalToolService } from './application/internal-tools.js';
import type { ContainerRunner, DataPort, RunRegistry, WorkerLimits } from './domain/ports.js';
import { HttpDataClient } from './infrastructure/data-client.js';
import { DockerSandboxRunner, type DockerRunnerOptions } from '@architect-os/sandbox';
import { SandboxContainerRunner } from './infrastructure/sandbox-container-runner.js';
import { createHttpHost } from './presentation/http-host.js';
import { createInternalToolsHost } from './presentation/internal-http.js';
import { createMemoryServer } from './presentation/mcp-server.js';

export interface MemoryDependencies {
  registry: RunRegistry;
  data: DataPort;
  runner: ContainerRunner;
  limits: WorkerLimits;
}

export const DEFAULT_LIMITS: WorkerLimits = { timeoutMs: 120_000, maxTurns: 8, maxBudgetUsd: 0.5 };

/** Composition root. All wiring of the memory service happens here. */
export function compose(deps: MemoryDependencies) {
  const intents = new IntentService(deps.registry, deps.runner, deps.limits);
  const internalTools = new InternalToolService(deps.data, 'memory');
  return {
    intents,
    internalTools,
    createServer: () => createMemoryServer(intents),
  };
}

/** The profile the worker runs under, served by the Docker adapter until memory runs under srt (brick 1b.5). */
export const WORKER_PROFILE = 'memory-worker';
/** Most bytes read from a worker's stdout or stderr: far above a Result of the contract, far below a heap. */
export const WORKER_MAX_OUTPUT_BYTES = 1024 * 1024;

/** What the service needs from its environment, read once at start. */
export interface MemoryRuntime {
  readonly dataUrl: string;
  readonly worker: DockerRunnerOptions;
  readonly port: number;
  readonly internalPort: number;
}

/** The runtime of the service from its environment; a missing or empty required variable is an error. */
export function runtimeOf(env: Readonly<Record<string, string | undefined>>): MemoryRuntime {
  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === '') throw new Error(`${name} is required`);
    return value;
  };
  return {
    dataUrl: required('DATA_URL'),
    worker: {
      profile: WORKER_PROFILE,
      image: required('WORKER_IMAGE'),
      network: required('WORKER_NETWORK'),
      memory: env['WORKER_MEMORY'] ?? '512m',
      pidsLimit: 128,
      env: {
        INTERNAL_TOOLS_URL: required('INTERNAL_TOOLS_URL'),
        ANTHROPIC_BASE_URL: required('BROKER_URL'),
      },
    },
    port: Number(env['PORT'] ?? 8081),
    internalPort: Number(env['INTERNAL_PORT'] ?? 8083),
  };
}

/** A started service: its worker runner, the ports it listens on, and how to close it. */
export interface Started {
  readonly runner: ContainerRunner;
  readonly ports: readonly [number, number];
  close(): Promise<void>;
}

/** Listens on `port` (0: any free port) and gives the port taken; a port in use rejects. */
const listen = (server: Server, port: number) =>
  new Promise<number>((done, fail) => {
    server.once('error', fail);
    server.listen(port, () => done((server.address() as AddressInfo).port));
  });

const closeAll = (servers: readonly Server[]) =>
  Promise.all(servers.map((server) => new Promise((closed) => server.close(closed))));

/**
 * Builds the service from its runtime and listens: the MCP host and the internal tools host. The worker's sandbox is
 * the Docker adapter of the SandboxRunner port; `hostEnv` is what its docker client may inherit.
 */
export async function start(
  runtime: MemoryRuntime,
  log: (line: string) => void,
  hostEnv: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Started> {
  const dataClient = new HttpDataClient(runtime.dataUrl);
  const runner = new SandboxContainerRunner(new DockerSandboxRunner(runtime.worker, hostEnv), {
    profile: runtime.worker.profile,
    cwd: process.cwd(),
    maxOutputBytes: WORKER_MAX_OUTPUT_BYTES,
  });
  const app = compose({ registry: dataClient, data: dataClient, runner, limits: DEFAULT_LIMITS });
  const http = createHttpHost(app.createServer);
  const internal = createInternalToolsHost(app.internalTools);
  let ports: readonly [number, number];
  try {
    ports = [await listen(http, runtime.port), await listen(internal, runtime.internalPort)];
  } catch (error) {
    // The host that did listen is closed: a service that cannot listen on both does not run on one.
    await closeAll([http, internal]);
    throw error;
  }
  log(`memory listening on :${ports[0]}`);
  log(`memory internal tools listening on :${ports[1]}`);
  return {
    runner,
    ports,
    close: async () => {
      await closeAll([http, internal]);
    },
  };
}

/** The process entry (src/serve.ts): starts the service, or reports why it cannot and gives exit code 1. */
export async function serve(
  env: Readonly<Record<string, string | undefined>>,
  stderr: Writable,
  begin: typeof start = start,
): Promise<number> {
  try {
    await begin(runtimeOf(env), (line) => stderr.write(`${line}\n`));
    return 0;
  } catch (error) {
    stderr.write(`memory: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
