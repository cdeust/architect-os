import type { Readable, Writable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DATA_OP_NAMES, DATA_OPS } from '@architect-os/contracts';
import type { z } from 'zod';
import type { DataOperations } from '../application/operations.js';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

/** The answer of a refused operation: its named code, or INTERNAL with nothing of the cause (a database message). */
function refusal(error: unknown) {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string'
    ? { code, message: (error as Error).message }
    : { code: 'INTERNAL', message: 'internal error' };
}

/**
 * The MCP server of data (docs/design/platform-v3-srt.md, §2 and brick 1b.3), generated from DATA_OPS: one tool per
 * typed operation, named as the operation, with its input schema, and nothing else; there is no tool that takes SQL.
 * Its one client is the gateway, its parent on stdio. An answer is the JSON of the operation's output; a refusal is
 * `isError` with `{ code, message }` (node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts, `registerTool`).
 */
export function createDataMcpServer(operations: DataOperations): McpServer {
  const server = new McpServer({ name: 'architect-os-data', version: '0.1.0' });
  for (const op of DATA_OP_NAMES) {
    server.registerTool(
      op,
      {
        description: `Data operation ${op}; writes ${JSON.stringify(DATA_OPS[op].writes)}.`,
        inputSchema: DATA_OPS[op].input as z.ZodObject,
      },
      async (args: unknown) => {
        try {
          return { content: text(await operations.execute(op, args)) };
        } catch (error) {
          return { content: text(refusal(error)), isError: true };
        }
      },
    );
  }
  return server;
}

/** Serves the data operations on `transport` (its stdio, in production) until the transport closes. */
export async function serveDataMcp(operations: DataOperations, transport: Transport): Promise<McpServer> {
  const server = createDataMcpServer(operations);
  await server.connect(transport);
  return server;
}

/** The stdio of the data process: stdin and stdout carry MCP and nothing else. */
export const stdioTransport = (stdin: Readable, stdout: Writable): Transport =>
  new StdioServerTransport(stdin, stdout);
