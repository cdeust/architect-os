import type { Readable, Writable } from 'node:stream';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Serves a module on the stdio of its process until its parent closes its stdin (docs/design/platform-v3-srt.md, §2:
 * the children of the gateway die with it, at the end of their stdin), then closes the server
 * (node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.d.ts, `StdioServerTransport(stdin, stdout)`).
 */
export async function serveStdio(server: McpServer, stdin: Readable, stdout: Writable): Promise<void> {
  const ended = new Promise((resolve) => stdin.once('end', resolve));
  await server.connect(new StdioServerTransport(stdin, stdout));
  await ended;
  await server.close();
}
