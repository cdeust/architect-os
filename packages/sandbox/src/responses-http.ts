import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { ResponsesProxy } from './responses-proxy.js';

/** One loopback port and one reader per Step. An idle local peer cannot accumulate request buffers. */
export interface SbxNetwork {
  port: number;
  deniedPort: number;
}
export async function withResponsesHttp<T>(
  proxy: ResponsesProxy,
  bytes: number,
  use: (network: SbxNetwork) => Promise<T>,
) {
  let reading = false,
    refused = false;
  const server = createServer(async (req, res) => {
    try {
      const authorization = req.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) throw Error('RESPONSES_TOKEN');
      const token = authorization.slice(7);
      const method = req.method!,
        path = req.url!;
      proxy.authorize(method, path, token);
      if (reading) {
        res.writeHead(429).end();
        return;
      }
      reading = true;
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > bytes) {
            refused = true;
            proxy.revoke();
            res.writeHead(413, { connection: 'close' }).end();
            return;
          }
          chunks.push(chunk);
        }
        const state = req.headers['x-codex-turn-state'];
        await proxy.relay(
          {
            method,
            path,
            token,
            headers: typeof state === 'string' ? { 'x-codex-turn-state': state } : {},
            body: Buffer.concat(chunks),
          },
          {
            async start(status, headers) {
              res.writeHead(status, headers);
              res.flushHeaders();
            },
            write: (chunk) =>
              new Promise<void>((done, fail) => res.write(chunk, (err) => (err ? fail(err) : done()))),
          },
        );
        res.end();
      } catch (error) {
        refused = true;
        proxy.revoke();
        throw error;
      } finally {
        reading = false;
      }
    } catch (error) {
      if (res.headersSent) res.destroy();
      else
        res
          .writeHead(error instanceof Error && error.message === 'RESPONSES_TOKEN' ? 401 : 403, {
            connection: 'close',
          })
          .end();
    }
  });
  const forbidden = createServer((_req, res) => res.writeHead(204).end());
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    forbidden.listen(0, '127.0.0.1');
    await once(forbidden, 'listening');
    const result = await use({
      port: (server.address() as AddressInfo).port,
      deniedPort: (forbidden.address() as AddressInfo).port,
    });
    return { result, refused: refused || reading };
  } finally {
    proxy.revoke();
    forbidden.closeAllConnections();
    forbidden.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}
