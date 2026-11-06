import type { Readable, Writable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { WorkerOutput } from '@architect-os/contracts';
import type { PlatformChannel } from '../task-worker.js';

/** The MCP client of the worker, as the channel uses it. */
export type PlatformCaller = Pick<Client, 'callTool'>;

/** The text of the first content of an answer when it is text; empty otherwise. */
function textOf(answer: Record<string, unknown>): string {
  const first = (answer['content'] as { type: string; text?: string }[] | undefined)?.[0];
  return first?.type === 'text' ? String(first.text) : '';
}

/**
 * The gateway on the stdin and stdout of the worker (docs/design/platform-v3-srt.md, §2, Un seul transport): the
 * worker is the MCP client, the gateway the server of its streams, with the tools `task_input`, `call` and
 * `task_complete` (gateway/src/infrastructure/worker-host.ts). The worker names no task: its identity is the stream.
 */
export class McpPlatformChannel implements PlatformChannel {
  constructor(private readonly client: PlatformCaller) {}

  async input(): Promise<unknown> {
    return JSON.parse(textOf(await this.client.callTool({ name: 'task_input', arguments: {} })));
  }

  async relay(address: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const answer = await this.client.callTool({ name: 'call', arguments: { address, arguments: args } });
    return { text: textOf(answer), isError: answer.isError === true };
  }

  async complete(output: WorkerOutput): Promise<void> {
    const answer = await this.client.callTool({ name: 'task_complete', arguments: { output } });
    if (answer.isError === true) throw new Error(`the gateway refused the output: ${textOf(answer)}`);
  }
}

/**
 * The channel over the stdin and stdout of the worker, connected (node_modules/@modelcontextprotocol/sdk/dist/esm/
 * server/stdio.d.ts, `StdioServerTransport(stdin, stdout)`: the stdio of the process, whatever the role of MCP on it),
 * and its close.
 */
export async function connectPlatform(
  stdin: Readable,
  stdout: Writable,
): Promise<{ channel: PlatformChannel; close: () => Promise<void> }> {
  const client = new Client({ name: 'architect-os-worker', version: '0.1.0' });
  await client.connect(new StdioServerTransport(stdin, stdout));
  return { channel: new McpPlatformChannel(client), close: () => client.close() };
}
