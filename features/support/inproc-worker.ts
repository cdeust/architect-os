import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { WorkerSession } from '../../gateway/src/application/worker-session.js';
import type { ServiceResponse } from '../../gateway/src/domain/ports.js';
import { StreamClientTransport } from '../../gateway/src/infrastructure/stream-transport.js';
import { workerServer } from '../../gateway/src/infrastructure/worker-host.js';
import { SdkTaskAgent } from '../../services/memory/worker/infrastructure/sdk-task-agent.js';
import { serveWorker } from '../../services/memory/worker/task-main.js';

/** The key the worker presents: in the platform the token of its task at the broker; here a fixed fake. */
export const TASK_KEY = 'tok-test-not-a-key';
export const AGENT_FILE = new URL('../../agents/memory.md', import.meta.url).pathname;

/** One call of an agent tool served in this process, as features/integration/agent-worker.feature proves it. */
export interface InProcessCall {
  readonly modelUrl: string;
  readonly tool: string;
  readonly input: unknown;
  readonly turns: number;
  readonly relay: (address: string, args: Record<string, unknown>) => Promise<ServiceResponse>;
  readonly agentFile?: string | undefined;
  readonly executable?: string | undefined;
}

/** What the call left: its session, the exit code of the worker, what the gateway saw of it, and its config folder. */
export interface InProcessRun {
  readonly session: WorkerSession;
  readonly exit: number;
  readonly client: unknown;
  readonly stdinListeners: number;
  readonly config: string;
  remove(): void;
}

/**
 * Serves one call of an agent tool in this process, without srt: the MCP server of the gateway on the streams of the
 * worker (a real WorkerSession), the worker v3 with the real Agent SDK and Claude Code, before a model at `modelUrl`.
 */
export async function serveInProcess(call: InProcessCall): Promise<InProcessRun> {
  const config = mkdtempSync(join(tmpdir(), 'aos-agent-worker-'));
  const session = new WorkerSession(
    'task-1',
    call.tool,
    call.input as Record<string, unknown>,
    call.turns,
    call.relay,
  );
  // The stdio of the worker: the gateway writes its stdin and reads its stdout.
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const server = workerServer(session);
  await server.connect(new StreamClientTransport(stdout, stdin));
  const agent = new SdkTaskAgent(
    {
      PATH: process.env['PATH'],
      HOME: config,
      ANTHROPIC_BASE_URL: call.modelUrl,
      ANTHROPIC_API_KEY: TASK_KEY,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
    },
    call.executable,
  );
  const exit = await serveWorker(call.agentFile ?? AGENT_FILE, stdin, stdout, new PassThrough(), agent);
  const run = {
    session,
    exit,
    client: server.getClientVersion(),
    stdinListeners: stdin.listenerCount('data'),
    config,
    remove: () => rmSync(config, { recursive: true, force: true }),
  };
  await server.close();
  return run;
}
