import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { ModulesMcpJson } from '@architect-os/contracts';
import type { Sandbox, SandboxRunner } from '@architect-os/sandbox';
import { z } from 'zod';
import { GatewayError } from '../domain/errors.js';
import type { AgentWorkers, WorkerChannel, WorkerRun } from '../domain/routing.js';
import { StreamClientTransport } from './stream-transport.js';

/** Where the workers run: the sandbox profile and the working directory the runner makes disposable. */
export interface WorkerLaunch {
  profile: string;
  cwd: string;
}

/** A runner per run: the token of the task is a variable of the profile `worker`, its API key at the broker. */
export type WorkerRunners = (variables: { readonly taskToken: string }) => SandboxRunner;

/** Where a sandbox of a task is kept until its task ends (TaskSandboxGroups). */
export interface TaskSandboxRegistry {
  add(task: string, sandbox: Sandbox): void;
}

const NO_ARGUMENTS = { type: 'object' as const, properties: {} };

/** The tools the gateway serves on the streams of a worker (§2, Un seul transport). */
export const WORKER_TOOLS = [
  { name: 'task_input', description: 'The input of the call this worker serves.', inputSchema: NO_ARGUMENTS },
  {
    name: 'call',
    description:
      'Calls the module tool at its address <domain>.<tool>, under the identifier of the call served.',
    inputSchema: {
      type: 'object' as const,
      properties: { address: { type: 'string' }, arguments: { type: 'object' } },
      required: ['address', 'arguments'],
    },
  },
  {
    name: 'task_complete',
    description: 'Gives the output of the call served, once.',
    inputSchema: {
      type: 'object' as const,
      properties: { output: { type: 'object' } },
      required: ['output'],
    },
  },
];

const RelaySchema = z.strictObject({ address: z.string(), arguments: z.record(z.string(), z.unknown()) });

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });

/** A refusal as the worker sees it: `{ code, message }`, the error flag set. */
function refusal(error: unknown): CallToolResult {
  const code = error instanceof GatewayError ? error.code : 'SERVICE_UNAVAILABLE';
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: JSON.stringify({ code, message }) }], isError: true };
}

/** One tool call of the worker, translated to its channel; its identity is the channel, never an argument. */
async function serve(
  channel: WorkerChannel,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (name === 'task_input') return text(JSON.stringify(channel.input()));
  if (name === 'task_complete') return text(channel.complete(args['output']));
  if (name !== 'call') throw new GatewayError('UNKNOWN_TOOL', `no tool ${name} on the streams of a worker`);
  const relay = RelaySchema.safeParse(args);
  if (!relay.success) throw new GatewayError('INVALID_ARGUMENTS', relay.error.message);
  const answer = await channel.relay(relay.data.address, relay.data.arguments);
  return {
    content: [{ type: 'text', text: answer.text }],
    // Undefined is dropped on the wire: an answer without structured content has none.
    structuredContent: answer.structured,
    isError: answer.isError,
  };
}

/**
 * The MCP server of the gateway on the streams of one worker (node_modules/@modelcontextprotocol/sdk/dist/esm/server/
 * index.d.ts, `Server`, `setRequestHandler`): the worker is the client on its own stdio. A refusal is an answer with
 * its error flag, never a broken stream.
 */
export function workerServer(channel: WorkerChannel): Server {
  const server = new Server(
    { name: 'architect-os-gateway', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: WORKER_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    serve(channel, request.params.name, request.params.arguments ?? {}).catch(refusal),
  );
  return server;
}

/**
 * The workers of the agent tools (docs/design/platform-v3-srt.md, §2, brick 1b.5): one sandbox per run, from the
 * server of its module in topology/modules.mcp.json, the token of its task as a variable of its profile, kept with its
 * task so that the end of the task stops it, and stopped when its call is cancelled. Never launched again: a worker
 * that cannot start is SERVICE_UNAVAILABLE. The run ends when the worker exits.
 */
export class WorkerHost implements AgentWorkers {
  constructor(
    private readonly servers: ModulesMcpJson,
    private readonly runners: WorkerRunners,
    private readonly launch: WorkerLaunch,
    private readonly sandboxes: TaskSandboxRegistry,
  ) {}

  async run(run: WorkerRun, channel: WorkerChannel): Promise<void> {
    const server = this.servers.mcpServers[run.module];
    if (server === undefined) throw new GatewayError('SERVICE_UNAVAILABLE', `no server for ${run.module}`);
    let sandbox: Sandbox;
    try {
      sandbox = await this.runners({ taskToken: run.token }).start({
        profile: this.launch.profile,
        cwd: this.launch.cwd,
        command: [server.command, ...server.args],
      });
    } catch (error) {
      throw new GatewayError(
        'SERVICE_UNAVAILABLE',
        `the worker of ${run.module} cannot start: ${String(error)}`,
      );
    }
    this.sandboxes.add(run.task, sandbox);
    const stop = () => void sandbox.stop();
    // An AbortSignal fires `abort` once; the listener is removed when the run ends.
    run.signal.addEventListener('abort', stop);
    if (run.signal.aborted) stop();
    const mcp = workerServer(channel);
    try {
      await mcp.connect(new StreamClientTransport(sandbox.stdout, sandbox.stdin));
      await sandbox.exited;
    } finally {
      run.signal.removeEventListener('abort', stop);
      await mcp.close();
    }
  }
}
