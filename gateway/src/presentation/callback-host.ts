import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { DATA_OPS, DATA_OP_NAMES } from '@architect-os/contracts';
import { z } from 'zod';
import { GatewayError } from '../application/errors.js';
import type { TaskRouter } from '../application/task-router.js';

/** What the callback of the modules reaches of the router. */
export type CallbackRouter = Pick<TaskRouter, 'describe' | 'operate' | 'call'>;

/** The data operations a module may call back, with the JSON schema of their input. */
const DATA_TOOLS = DATA_OP_NAMES.map((name) => ({
  name,
  inputSchema: z.toJSONSchema(DATA_OPS[name].input, { io: 'input' }) as { type: 'object' },
}));

function refusal(error: unknown): CallToolResult {
  const code = error instanceof GatewayError ? error.code : 'SERVICE_UNAVAILABLE';
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: JSON.stringify({ code, message }) }], isError: true };
}

/**
 * The MCP server of one callback, for the call identifier it was presented with (docs/design/platform-v3-srt.md, §2,
 * Identifiant d'appel): a data operation goes to `operate`, any other name is a module address that goes to `call`.
 * The task and the caller come from the identifier, never from an argument.
 */
export function callbackServer(router: CallbackRouter, call: string): Server {
  const server = new Server(
    { name: 'architect-os-gateway-callback', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: DATA_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    try {
      const answer = Object.hasOwn(DATA_OPS, name)
        ? await router.operate(call, name, args)
        : await router.call({ call }, name, args);
      return {
        content: [{ type: 'text', text: answer.text }],
        // Undefined is dropped on the wire: an answer without structured content has none.
        structuredContent: answer.structured,
        isError: answer.isError,
      };
    } catch (error) {
      return refusal(error);
    }
  });
  return server;
}

/**
 * The callback of the modules over streamable HTTP, `POST /mcp`, listened on 127.0.0.1 only, reached through the srt
 * proxy of the profile `module` (§2, T-38). The bearer is the call identifier of the call the module serves: missing,
 * unknown or invalidated, `401` before any MCP. Stateless: one server and one transport per request, answers in JSON
 * (node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts, `enableJsonResponse`).
 */
export function createCallbackHost(router: CallbackRouter): HttpServer {
  return createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    const call = req.headers.authorization?.match(/^Bearer (.+)/i)?.[1];
    if (call === undefined || router.describe(call) === undefined) {
      res.writeHead(401).end();
      return;
    }
    // In JSON mode the transport keeps no stream once it answered (node_modules/@modelcontextprotocol/sdk/dist/esm/
    // server/webStandardStreamableHttp.js, `close`): the server and the transport are garbage with the request, nothing
    // to close. handleRequest answers its own failures, 500 included (node_modules/@hono/node-server/dist/index.mjs,
    // `getRequestListener`, `handleFetchError`), and a fresh transport always connects: nothing to catch.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    void callbackServer(router, call)
      .connect(transport)
      .then(() => transport.handleRequest(req, res));
  });
}
