import type { Readable, Writable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * The client side of MCP on the stdio of a child the gateway did not spawn itself: a sandbox gives its stdout and its
 * stdin as streams (packages/sandbox, `Sandbox`). Framing of the SDK (node_modules/@modelcontextprotocol/sdk/dist/esm/
 * shared/stdio.d.ts, `ReadBuffer`, `serializeMessage`). The transport closes when the stdout of the child closes, and
 * when the child writes what is not MCP: a module that breaks the protocol is treated as ended.
 */
export class StreamClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  async start(): Promise<void> {
    this.input.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      try {
        for (let message = this.buffer.readMessage(); message !== null; message = this.buffer.readMessage())
          // Set by the Protocol before start() (node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js, connect).
          this.onmessage!(message);
      } catch {
        void this.close();
      }
    });
    this.input.on('close', () => this.onclose!());
  }

  /** A message for a child whose stdin has ended is refused: written after the end, it would raise on the stream. */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.output.writable) throw new Error('the child is gone: its stdin has ended');
    this.output.write(serializeMessage(message));
  }

  /** Closes the transport; the sandbox of the module is stopped by its host (ModuleHost). */
  async close(): Promise<void> {
    this.input.destroy();
  }
}

/**
 * The MCP client of the gateway on the streams of a child (its stdout to read, its stdin to write), once initialized:
 * a module in its sandbox, data, the broker. They all see the same client.
 */
export async function connectOverStreams(input: Readable, output: Writable): Promise<Client> {
  const client = new Client({ name: 'architect-os-gateway', version: '0.1.0' });
  await client.connect(new StreamClientTransport(input, output));
  return client;
}
