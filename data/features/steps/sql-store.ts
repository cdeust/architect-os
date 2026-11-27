import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/infrastructure/migrate.js';
import { connectPostgres } from '../../src/infrastructure/pg-pool.js';
import { DATA_OP_NAMES, DATA_OPS } from '@architect-os/contracts';
import {
  loadStatementTable,
  SqlDataStore,
  knownTables,
  readTables,
  SqlSourceError,
  writtenTables,
  type SqlExecutor,
} from '../../src/infrastructure/sql-store.js';
import { MIGRATIONS_DIR, SQL_DIR } from '../../src/main.js';
import { Given, RecordingExecutor, Then, When, scenario } from './helpers.js';

type Table = { statements: Record<string, unknown>[] };

// Named rewrites of operations.json, one per row of the "rejects a table" Examples.
const editTable = (change: (table: Table) => void) => (source: string) => {
  const table = JSON.parse(source) as Table;
  change(table);
  return JSON.stringify(table);
};
const REWRITES: Record<string, (source: string) => string> = {
  'drop the first statement': editTable((t) => void t.statements.splice(0, 1)),
  'rename the first operation to sql.raw': editTable((t) => void (t.statements[0]!['op'] = 'sql.raw')),
  'append the placeholder $4': (source) => `${source} -- $4`,
  'add the unknown field cache': editTable((t) => void (t.statements[0]!['cache'] = true)),
  'point the first statement at nope.sql': editTable((t) => void (t.statements[0]!['file'] = 'nope.sql')),
  'replace the content by an opening brace': () => '{',
  'append a delete of the runs': (source) => `${source};\nDELETE FROM runs WHERE false`,
  'insert into runs instead': (source) => source.replace('INSERT INTO usage_records', 'INSERT INTO runs'),
  'read the runs and the tasks by a comma': (source) =>
    source.replace('FROM runs WHERE', 'FROM runs, tasks WHERE'),
  'select from the tasks too': (source) => `${source};\nSELECT 1 FROM tasks`,
  'return nothing': (source) => source.replace(/RETURNING[\s\S]*/, ''),
  'select the 12 parameters instead': () =>
    `SELECT ${Array.from({ length: 12 }, (_, i) => `$${i + 1}`).join(', ')} AS id`,
};

const RUN_ROW = {
  id: 'r',
  service: 's',
  tool: 't',
  input: {},
  status: 'running',
  result: null,
  created_at: new Date(0),
};

// --- statement table (sql/operations.json) ---

When('I load the committed statement table', function () {
  this.state['table'] = loadStatementTable(SQL_DIR);
});

Then('the table has {int} distinct operations', function (count: number) {
  const table = this.state['table'] as ReturnType<typeof loadStatementTable>;
  assert.equal(new Set(table.statements.map((s) => s.op)).size, count);
});

Then('every statement of the table has a non-empty text', function () {
  const table = this.state['table'] as ReturnType<typeof loadStatementTable>;
  assert.equal(
    table.statements.every((s) => s.text.length > 0),
    true,
  );
});

When('I copy the sql directory and rewrite {string} as {string}', function (file: string, rewrite: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sql-table-'));
  this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(SQL_DIR, dir, { recursive: true });
  const change = REWRITES[rewrite];
  assert.ok(change, `unknown rewrite: ${rewrite}`);
  writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));
  this.state['brokenDir'] = dir;
});

Then('loading the statement table from the copy fails saying {}', function (message: string) {
  assert.throws(() => loadStatementTable(this.state['brokenDir'] as string), { message });
});

Then('loading the statement table from the copy fails', function () {
  assert.throws(() => loadStatementTable(this.state['brokenDir'] as string));
});

Then('the statement {string} writes {string}', function (statement: string, tables: string) {
  assert.equal(writtenTables(statement.replaceAll('\\n', '\n')).join(', '), tables);
});

Then('the statement {string} reads {string}', function (statement: string, tables: string) {
  assert.equal(readTables(statement.replaceAll('\\n', '\n'), knownTables(), 'x.sql').join(', '), tables);
});

Then('only the operation {string} writes the table {string}', function (op: string, table: string) {
  const writers = DATA_OP_NAMES.filter((name) =>
    (DATA_OPS[name].writes as readonly string[]).includes(table),
  );
  assert.deepEqual(writers, [op]);
});

Then(
  'the database refuses {string} with SQLSTATE {string}',
  async function (statement: string, sqlstate: string) {
    const connection = this.state['connection'] as SqlExecutor | undefined;
    assert.ok(connection, 'the postgres data store must be given first');
    await assert.rejects(
      connection.query(statement, []),
      (error: { code?: string }) => error.code === sqlstate,
    );
  },
);

// --- SqlDataStore without a database ---

Given('a SQL data store over a recording executor answering the run row', function () {
  const data = scenario(this);
  data.recording = new RecordingExecutor(() => [RUN_ROW]);
  data.executor = new SqlDataStore(data.recording, loadStatementTable(SQL_DIR));
});

Given('a SQL data store over a recording executor answering no row', function () {
  const data = scenario(this);
  data.recording = new RecordingExecutor();
  data.executor = new SqlDataStore(data.recording, loadStatementTable(SQL_DIR));
});

Given(
  'a SQL data store over a recording executor failing with SQLSTATE {string} and message {string}',
  function (code: string, message: string) {
    const data = scenario(this);
    data.recording = new RecordingExecutor(() => {
      throw Object.assign(new Error(message), { code });
    });
    data.executor = new SqlDataStore(data.recording, loadStatementTable(SQL_DIR));
  },
);

Then('the recorded statement {int} does not contain {string}', function (index: number, fragment: string) {
  assert.ok(!scenario(this).calls[index]?.text.includes(fragment));
});

Then('the recorded statement {int} contains {string}', function (index: number, fragment: string) {
  const call = scenario(this).calls[index];
  assert.ok(call?.text.includes(fragment), `statement ${index} does not contain ${fragment}`);
});

Then('the recorded statement {int} has the parameters:', function (index: number, expected: string) {
  assert.deepEqual(scenario(this).calls[index]?.params, JSON.parse(expected));
});

Then('the recorded statement {int} has the parameters {string}', function (index: number, expected: string) {
  assert.deepEqual(scenario(this).calls[index]?.params, JSON.parse(expected));
});

// The answer as JSON, so an absent field and an undefined one are the same (deep equality on the JSON form).
Then('the answer as JSON equals:', function (expected: string) {
  assert.deepEqual(JSON.parse(JSON.stringify(scenario(this).answer)), JSON.parse(expected));
});

// --- migrate ---

When('I migrate twice from the committed migrations directory with an in-memory ledger', async function () {
  const applied = new Set<string>();
  const statements: string[] = [];
  const sql: SqlExecutor = {
    async query(text, params) {
      statements.push(text);
      if (text.startsWith('INSERT INTO schema_migrations')) applied.add(String(params[0]));
      if (text.startsWith('SELECT version')) return { rows: [...applied].map((version) => ({ version })) };
      return { rows: [] };
    },
    transaction: (work) => work(sql),
  };
  this.state['migrations'] = {
    first: await migrate(sql, MIGRATIONS_DIR),
    second: await migrate(sql, MIGRATIONS_DIR),
    statements,
  };
});

Then('the first migration applies {string}', function (names: string) {
  const { first } = this.state['migrations'] as { first: string[] };
  assert.deepEqual(first, names.split(', '));
});

Then('the second migration applies nothing', function () {
  const { second } = this.state['migrations'] as { second: string[] };
  assert.deepEqual(second, []);
});

Then('the migration statements include {string}', function (fragment: string) {
  const { statements } = this.state['migrations'] as { statements: string[] };
  assert.equal(
    statements.some((s) => s.includes(fragment)),
    true,
  );
});

When(
  'a first append to the Step {string} of the run {string} holds its transaction open while a second one arrives',
  async function (step: string, run: string) {
    const connection = this.state['connection'] as SqlExecutor | undefined;
    assert.ok(connection, 'the postgres data store must be given first');
    const append = loadStatementTable(SQL_DIR).statements.find((s) => s.op === 'steps.appendEvent')!;
    const store = scenario(this).store;
    let second: Promise<unknown> | undefined;
    const first = await connection.transaction(async (tx) => {
      const { rows } = await tx.query(append.text, [run, step, 'phase.started', 'scouts']);
      second = store.execute('steps.appendEvent', { run, step, type: 'phase.ended', phase: 'scouts' });
      // The second append is on another connection of the pool: it is waiting for a lock before this one commits.
      for (let waited = 0; ; waited += 1) {
        const { rows: waiting } = await connection.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
          [],
        );
        if ((waiting[0] as { n: number }).n > 0) break;
        assert.ok(waited < 500, 'the second append never waited for the first');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return rows[0];
    });
    this.state['appends'] = [first, await second];
  },
);

Then('both appends succeeded, numbered {int} and {int} in their order', function (a: number, b: number) {
  const [first, second] = this.state['appends'] as { seq: number; type: string }[];
  assert.deepEqual(
    [first, second].map((event) => [event!.seq, event!.type]),
    [
      [a, 'phase.started'],
      [b, 'phase.ended'],
    ],
  );
});

Then(
  'the statement {string} is refused as unreadable, saying {string}',
  function (statement: string, why: string) {
    assert.throws(
      () => readTables(statement.replaceAll('\\n', '\n'), knownTables(), 'x.sql'),
      (error: unknown) =>
        error instanceof SqlSourceError &&
        error.name === 'SqlSourceError' &&
        error.code === 'SQL_SOURCES_UNREADABLE' &&
        error.message === `x.sql: SQL_SOURCES_UNREADABLE: ${why}`,
    );
  },
);

When(
  'a first append to the run kept as {string} holds its transaction open while a second one arrives',
  async function (name: string) {
    const connection = this.state['connection'] as SqlExecutor | undefined;
    assert.ok(connection, 'the postgres data store must be given first');
    const data = scenario(this);
    const run = data.vars[name]!;
    const append = loadStatementTable(SQL_DIR).statements.find((s) => s.op === 'runs.appendEvent')!;
    let second: Promise<unknown> | undefined;
    const first = await connection.transaction(async (tx) => {
      const { rows } = await tx.query(append.text, [run, 'run.created', '{}']);
      second = data.store.execute('runs.appendEvent', { run_id: run, type: 'worker.started', payload: {} });
      // The second append is on another connection of the pool: it is waiting for a lock before this one commits.
      for (let waited = 0; ; waited += 1) {
        const { rows: waiting } = await connection.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
          [],
        );
        if ((waiting[0] as { n: number }).n > 0) break;
        assert.ok(waited < 500, 'the second append never waited for the first');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return rows[0];
    });
    this.state['run appends'] = [first, await second];
  },
);

Then('both run appends succeeded, numbered {int} and {int} in their order', function (a: number, b: number) {
  const [first, second] = this.state['run appends'] as { seq: number; type: string }[];
  assert.deepEqual(
    [first, second].map((event) => [event!.seq, event!.type]),
    [
      [a, 'run.created'],
      [b, 'worker.started'],
    ],
  );
});

Given(
  'the postgres data store migrated up to {string} with a completed run of {int} events',
  async function (last: string, events: number) {
    assert.notEqual(this.databaseUrl, '', 'the @postgres hook must have created a database');
    const connection = connectPostgres(this.databaseUrl);
    this.cleanups.push(() => connection.end());
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name <= last))
      cpSync(join(MIGRATIONS_DIR, file), join(dir, file));
    await migrate(connection, dir);
    const { rows } = await connection.query(
      "INSERT INTO runs (service, tool, input, status) VALUES ('s', 't', '{}', 'running') RETURNING id",
      [],
    );
    const run = String(rows[0]!['id']);
    for (let seq = 0; seq < events; seq += 1)
      await connection.query("INSERT INTO run_events (run_id, seq, type) VALUES ($1, $2, 'run.created')", [
        run,
        seq,
      ]);
    await connection.query("UPDATE runs SET status = 'ok', completed_at = now() WHERE id = $1", [run]);
    this.state['connection'] = connection;
    scenario(this).vars['run'] = run;
  },
);

When('the remaining migrations are applied', async function () {
  const connection = this.state['connection'] as SqlExecutor;
  await migrate(connection, MIGRATIONS_DIR);
  scenario(this).executor = new SqlDataStore(connection, loadStatementTable(SQL_DIR));
});
