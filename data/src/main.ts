import { fileURLToPath } from 'node:url';
import { DataOperations } from './application/operations.js';
import type { DataStore } from './domain/ports.js';
import { InMemoryDataStore } from './infrastructure/in-memory.js';
import { migrate } from './infrastructure/migrate.js';
import { connectPostgres } from './infrastructure/pg-pool.js';
import { loadStatementTable, SqlDataStore } from './infrastructure/sql-store.js';
import { serveDataMcp, stdioTransport } from './presentation/mcp-server.js';

/** The package root (data/) from src/main.ts under tsx and from dist/src/main.js once built. */
const ROOT = new URL(import.meta.url.includes('/dist/') ? '../../' : '../', import.meta.url);
export const SQL_DIR = fileURLToPath(new URL('sql/', ROOT));
export const MIGRATIONS_DIR = fileURLToPath(new URL('migrations/', ROOT));

/** Composition root. All wiring of the data component happens here. */
export function compose(store: DataStore) {
  return { operations: new DataOperations(store) };
}

// The imports of the process entries (brick 1b.3) come after the declarations above, whose positions the mutation debt
// register names (tools/test-gate/mutation-debt.json, rule 6): an import added on top would move them.
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';

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
