import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { MEMORY_TOOLS, callTool, type Callback, type MemoryToolName } from '../application/memory-tools.js';

/**
 * The MCP server of the module memory, on its stdio, child of the gateway (docs/design/platform-v3-srt.md, §2, Un seul
 * transport). The call identifier comes in `_meta.call` (node_modules/@modelcontextprotocol/sdk/dist/esm/shared/
 * protocol.d.ts, `RequestHandlerExtra._meta`); the answer of the gateway is forwarded untouched.
 */
export function createMemoryServer(callback: Callback): McpServer {
  const server = new McpServer({ name: 'architect-os-module-memory', version: '0.1.0' });
  for (const name of Object.keys(MEMORY_TOOLS) as MemoryToolName[]) {
    server.registerTool(
      name,
      { description: MEMORY_TOOLS[name].description, inputSchema: MEMORY_TOOLS[name].input as z.ZodObject },
      async (args: Record<string, unknown>, extra) => {
        const answer = await callTool(callback, name, args, extra._meta?.['call']);
        return {
          content: [{ type: 'text' as const, text: answer.text }],
          // Undefined is dropped on the wire: an answer without structured content has none.
          structuredContent: answer.structured,
          isError: answer.isError,
        };
      },
    );
  }
  return server;
}
