import type { Readable, Writable } from 'node:stream';
import { HttpCallback } from './infrastructure/http-callback.js';
import { createMemoryServer } from './presentation/mcp-server.js';
import { serveStdio } from './presentation/stdio.js';

/**
 * The module memory as topology/modules.mcp.json launches it, under the srt profile `module`, which sets
 * GATEWAY_CALLBACK_URL (packages/sandbox/profiles/module.json). Serves until its stdin ends; its exit code. Its stdout
 * is the MCP channel: nothing else is written there.
 */
export async function serve(
  env: Readonly<Record<string, string | undefined>>,
  stdin: Readable,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = env['GATEWAY_CALLBACK_URL'];
  if (url === undefined) {
    stderr.write('GATEWAY_CALLBACK_URL is not set\n');
    return 2;
  }
  await serveStdio(createMemoryServer(new HttpCallback(new URL(url))), stdin, stdout);
  return 0;
}
