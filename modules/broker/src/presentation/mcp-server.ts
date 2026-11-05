import type { Readable, Writable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { BROKER_TOOLS, USAGE_LOGGER } from '@architect-os/contracts';
import type { z } from 'zod';
import type { BrokerService } from '../application/broker-service.js';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

/**
 * The MCP server of the broker, on its stdio, for its one client, the gateway: `token_grant`, `token_revoke`, and the
 * `logging` capability that carries the usage records (node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts,
 * `sendLoggingMessage`).
 */
export function createBrokerServer(service: BrokerService): McpServer {
  const server = new McpServer(
    { name: 'architect-os-broker', version: '0.1.0' },
    { capabilities: { logging: {} } },
  );
  server.registerTool(
    'token_grant',
    {
      description: BROKER_TOOLS.token_grant.description,
      inputSchema: BROKER_TOOLS.token_grant.input as z.ZodObject,
    },
    (args: unknown) => {
      try {
        service.grant(args as z.infer<typeof BROKER_TOOLS.token_grant.input>);
        return { content: text({ granted: true }) };
      } catch (error) {
        return { content: text({ error: (error as Error).message }), isError: true };
      }
    },
  );
  server.registerTool(
    'token_revoke',
    {
      description: BROKER_TOOLS.token_revoke.description,
      inputSchema: BROKER_TOOLS.token_revoke.input as z.ZodObject,
    },
    (args: unknown) => ({
      content: text({
        revoked: service.revoke((args as z.infer<typeof BROKER_TOOLS.token_revoke.input>).token),
      }),
    }),
  );
  return server;
}

/**
 * Hands each usage record to the gateway as `notifications/message`, logger `usage`. The relay is closed before the
 * server, so no record comes after it; a send that fails all the same rejects unhandled and ends the process: the
 * gateway sees its child gone, and nothing is spent without its record.
 */
export function usageNotifier(server: McpServer): (record: object) => void {
  return (record) => void server.sendLoggingMessage({ level: 'info', logger: USAGE_LOGGER, data: record });
}

/** The MCP side of a started broker: its usage notifier, and its end. */
export interface BrokerChannel {
  readonly notify: (record: object) => void;
  close(): Promise<void>;
}

/** Serves the broker's tools on `transport` (its stdio, in production) and gives the notifier of its usage records. */
export async function openChannel(service: BrokerService, transport: Transport): Promise<BrokerChannel> {
  const server = createBrokerServer(service);
  await server.connect(transport);
  return { notify: usageNotifier(server), close: () => server.close() };
}

/** The stdio of the broker's process: stdin and stdout carry MCP and nothing else. */
export const stdioTransport = (stdin: Readable, stdout: Writable): Transport =>
  new StdioServerTransport(stdin, stdout);
