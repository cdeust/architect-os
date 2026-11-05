import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataOperations } from './application/operations.js';
import type { DataStore } from './domain/ports.js';
import { InMemoryDataStore } from './infrastructure/in-memory.js';
import { migrate } from './infrastructure/migrate.js';
import { connectPostgres } from './infrastructure/pg-pool.js';
import { loadStatementTable, SqlDataStore } from './infrastructure/sql-store.js';
import { createDataApi } from './presentation/http-api.js';
import { serveDataMcp, stdioTransport } from './presentation/mcp-server.js';

/** The package root (data/) from src/main.ts under tsx and from dist/src/main.js in the image. */
const ROOT = new URL(import.meta.url.includes('/dist/') ? '../../' : '../', import.meta.url);
export const SQL_DIR = fileURLToPath(new URL('sql/', ROOT));
export const MIGRATIONS_DIR = fileURLToPath(new URL('migrations/', ROOT));

/** Composition root. All wiring of the data component happens here. */
export function compose(store: DataStore) {
  const operations = new DataOperations(store);
  return { operations, createServer: () => createDataApi(operations) };
}

export function composeInMemory() {
  return compose(new InMemoryDataStore());
}

/**
 * The store of `DATABASE_URL`, migrated, or the in-memory store without it. `log` is stderr: stdout may carry MCP.
 * The statement table is loaded before any connection, so a table whose SQL does not match DATA_OPS stops data first.
 */
async function openStore(
  env: Readonly<Record<string, string | undefined>>,
  log: (line: string) => void,
): Promise<{ store: DataStore; close: () => Promise<void> }> {
  const url = env['DATABASE_URL'];
  if (url === undefined) {
    log('DATABASE_URL is not set: using the in-memory backend (non-persistent).');
    return { store: new InMemoryDataStore(), close: async () => {} };
  }
  const table = loadStatementTable(SQL_DIR);
  const connection = connectPostgres(url);
  log(`migrations applied: [${(await migrate(connection, MIGRATIONS_DIR)).join(', ')}]`);
  return { store: new SqlDataStore(connection, table), close: () => connection.end() };
}

/**
 * The process of data as a child of the gateway (brick 1b.3): MCP on stdin and stdout, logs on stderr. It ends when its
 * stdin ends, its parent gone: 0; a data that cannot open its store writes why on stderr: 1.
 */
export async function serveStdio(
  env: Readonly<Record<string, string | undefined>>,
  stdin: Readable,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const log = (line: string) => void stderr.write(`data: ${line}\n`);
  let opened: Awaited<ReturnType<typeof openStore>>;
  try {
    opened = await openStore(env, log);
  } catch (error) {
    log((error as Error).message);
    return 1;
  }
  const server = await serveDataMcp(compose(opened.store).operations, stdioTransport(stdin, stdout));
  if (!stdin.readableEnded) await once(stdin, 'end');
  await server.close();
  await opened.close();
  return 0;
}

/** The HTTP API of data on `PORT` (8082 by default), until compose is retired (brick 1b.6). Resolves once it listens. */
export async function serveHttp(
  env: Readonly<Record<string, string | undefined>>,
  log: (line: string) => void,
): Promise<Server> {
  const { store } = await openStore(env, log);
  const server = compose(store).createServer();
  server.listen(Number(env['PORT'] ?? 8082));
  await once(server, 'listening');
  log(`data listening on :${(server.address() as AddressInfo).port}`);
  return server;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serveHttp(process.env, console.warn).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
