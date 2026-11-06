import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { DataOpName } from '@architect-os/contracts';
import type { Answer, Callback } from '../domain/ports.js';

/**
 * The callback of the gateway over streamable HTTP, the call identifier as bearer (gateway/src/presentation/
 * callback-host.ts), one connection per call (node_modules/@modelcontextprotocol/sdk/dist/esm/client/
 * streamableHttp.d.ts, `requestInit`). Under srt the URL is the loopback of the gateway, reached through the proxy of
 * the profile `module`.
 */
export class HttpCallback implements Callback {
  constructor(private readonly url: URL) {}

  async operate(call: string, op: DataOpName, args: Record<string, unknown>): Promise<Answer> {
    const client = new Client({ name: 'architect-os-module-memory', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(this.url, {
        requestInit: { headers: { authorization: `Bearer ${call}` } },
      }),
    );
    try {
      const answer = await client.callTool({ name: op, arguments: args });
      const first = (answer.content as { type: string; text?: string }[])[0];
      return {
        text: first?.type === 'text' ? String(first.text) : '',
        structured: answer.structuredContent as Record<string, unknown> | undefined,
        isError: answer.isError === true,
      };
    } finally {
      await client.close();
    }
  }
}
