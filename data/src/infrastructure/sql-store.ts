import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_OP_NAMES, DATA_OPS, type DataOpInput, type DataOpName } from '@architect-os/contracts';
import { z } from 'zod';
import { DataError } from '../domain/errors.js';
import type { DataStore } from '../domain/ports.js';

/** Minimal query surface the store and the migrator need. The pg pool adapter lives in pg-pool.ts. */
export interface SqlExecutor {
  query(text: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** Runs `work` on one connection inside BEGIN/COMMIT, ROLLBACK on error. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** Schema of sql/operations.json: which SQL file serves which operation, with which parameters. */
const TableSchema = z.strictObject({
  /** SQLSTATE to the named failure it means (e.g. 23503 foreign key violation: unknown run). */
  errors: z.record(z.string().regex(/^[0-9A-Z]{5}$/), z.enum(['NOT_FOUND', 'INVALID_OPERATION'])),
  statements: z.array(
    z.strictObject({
      op: z.enum(DATA_OP_NAMES as [DataOpName, ...DataOpName[]]),
      /** Optional input field: the statement applies only when that field is present. */
      when: z.string().optional(),
      file: z.string().regex(/^[a-z][a-z0-9.-]*\.sql$/),
      /** Input fields bound to $1..$n in order; the suffix `:json` sends the value as JSON text (jsonb, vector). */
      params: z.array(z.string().regex(/^[a-z_]+(:json)?$/)),
      /** row: the first row (none is NOT_FOUND); rows: every row; value: the `value` column of the first row. */
      returns: z.enum(['row', 'rows', 'value']),
    }),
  ),
});
type Statement = z.infer<typeof TableSchema>['statements'][number] & { text: string };

export interface StatementTable {
  errors: Record<string, 'NOT_FOUND' | 'INVALID_OPERATION'>;
  statements: Statement[];
}

/**
 * Loads sql/operations.json and its SQL files; rejects a table that does not serve exactly the contract operations,
 * whose parameters do not match the placeholders of its SQL, or that writes other tables than declared (checkWrites).
 */
export function loadStatementTable(directory: string): StatementTable {
  const table = TableSchema.parse(JSON.parse(readFileSync(join(directory, 'operations.json'), 'utf8')));
  const statements = table.statements.map((statement) => {
    const text = readFileSync(join(directory, statement.file), 'utf8');
    const highest = Math.max(0, ...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    if (highest !== statement.params.length) {
      throw new Error(
        `${statement.file}: uses $1..$${highest} but declares ${statement.params.length} params`,
      );
    }
    return { ...statement, text };
  });
  for (const op of DATA_OP_NAMES) {
    const forOp = statements.filter((s) => s.op === op);
    if (forOp.length === 0 || forOp.at(-1)?.when !== undefined) {
      throw new Error(`operation ${op} needs a statement without "when" as its last entry`);
    }
  }
  return checkWrites({ errors: table.errors, statements });
}

function bind(input: Record<string, unknown>, param: string): unknown {
  const [field = '', encoding] = param.split(':');
  const value = input[field];
  if (encoding !== 'json') return value ?? null;
  return value === undefined ? null : JSON.stringify(value);
}

/** Rows as the contracts expect them: timestamps as ISO strings, SQL NULL as an absent field. */
function normalize(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

/** One generic executor for every data operation, driven by the statement table. */
export class SqlDataStore implements DataStore {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly table: StatementTable,
  ) {}

  async execute<Op extends DataOpName>(op: Op, input: DataOpInput<Op>): Promise<unknown> {
    const fields = input as Record<string, unknown>;
    const statement = this.table.statements.find(
      (s) => s.op === op && (s.when === undefined || fields[s.when] !== undefined),
    ) as Statement;
    let rows: Record<string, unknown>[];
    try {
      rows = (
        await this.sql.query(
          statement.text,
          statement.params.map((p) => bind(fields, p)),
        )
      ).rows;
    } catch (error) {
      const named = this.table.errors[(error as { code?: string }).code ?? ''];
      // The database message names tables and constraints: it is not forwarded to callers.
      if (named !== undefined) throw new DataError(named, `${op}: ${named.toLowerCase().replace('_', ' ')}`);
      throw error;
    }
    if (statement.returns === 'rows') return rows.map(normalize);
    const first = rows[0];
    if (first === undefined) throw new DataError('NOT_FOUND', `${op}: no such record`);
    return statement.returns === 'row' ? normalize(first) : first['value'];
  }
}

/**
 * The tables a statement writes: the target of each INSERT INTO, UPDATE, DELETE FROM, TRUNCATE and MERGE INTO, comments
 * removed. `FOR UPDATE` (a row lock) and `DO UPDATE SET` (the update of an upsert, on the table of its INSERT) name
 * no table.
 */
export function writtenTables(sql: string): string[] {
  const code = sql.replace(/--[^\n]*/g, '');
  const targets = code.matchAll(
    /(?<!\b(?:FOR|DO|KEY)\s+)\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO)\s+(?:ONLY\s+)?([A-Za-z_][\w.]*)/gi,
  );
  return [...new Set([...targets].map((m) => String(m[1]).toLowerCase()))];
}

/** A statement whose table sources the reader cannot enumerate whole: refused when the statement table loads. */
export class SqlSourceError extends Error {
  readonly code = 'SQL_SOURCES_UNREADABLE';
  constructor(where: string, why: string) {
    super(`${where}: SQL_SOURCES_UNREADABLE: ${why}`);
    this.name = 'SqlSourceError';
  }
}

/** The words that end the source of a FROM or a JOIN; JOIN and USING start another one, read on their own. */
const ends = (): ReadonlySet<string> =>
  new Set([
    'where',
    'group',
    'order',
    'limit',
    'offset',
    'having',
    'window',
    'fetch',
    'for',
    'returning',
    'union',
    'intersect',
    'except',
    'join',
    'left',
    'right',
    'inner',
    'full',
    'cross',
    'natural',
    'on',
    'using',
    ')',
    ';',
  ]);

/**
 * The tokens of a statement, scanned in one left-to-right pass: line comments and string literals (E'' and standard) are
 * skipped; quoted identifiers, names and single characters are kept. Block comments, dollar-quoted strings and unclosed
 * quotes are refused with `refuse`.
 */
function tokens(sql: string, refuse: (why: string) => never): string[] {
  const words: string[] = [];
  for (const [raw] of sql.matchAll(
    /--[^\n]*|\/\*|\$\w*\$|\bE'(?:[^'\\]|\\.)*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|['"]|[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*|\S/gi,
  )) {
    if (raw === '/*') refuse('a block comment');
    if (raw[0] === '$' && raw.length > 1) refuse('a dollar-quoted string');
    if (raw === "'" || raw === '"') refuse('an unclosed quote');
    if (raw.startsWith('--') || raw.endsWith("'")) continue;
    words.push(raw.toLowerCase());
  }
  return words;
}

/** A token of `tokens` is an unquoted name (schema-qualified or not) iff it starts with a letter or underscore. */
const isName = (word: string | undefined): word is string => word !== undefined && /^[a-z_]/.test(word);

/**
 * The tables a statement reads: the source of each FROM and JOIN, except the target of a statement-leading DELETE FROM,
 * the operand of IS [NOT] DISTINCT FROM and the CTE names its WITH clauses define; and, when it has a RETURNING clause,
 * the tables it writes, whose rows it returns. It fails closed: any source or construct it cannot read whole is refused
 * with SqlSourceError, never left out (block comments, dollar-quoted strings, unclosed quotes, TABLE shorthand, commas
 * between sources, USING that brings a table, subqueries or functions in FROM/JOIN, unreadable or unclosed WITH
 * clauses, and WITH clauses taking the name of a table of `tables`).
 */
export function readTables(sql: string, tables: ReadonlySet<string>, where: string): string[] {
  const refuse: (why: string) => never = (why) => {
    throw new SqlSourceError(where, why);
  };
  const words = tokens(sql, refuse);
  const stops = ends();
  const defined = new Set<string>();
  words.forEach((word, i) => {
    if (word !== 'with') return;
    let at = i + 1;
    if (words[at] === 'recursive') at += 1;
    for (;;) {
      const name = words[at];
      if (!isName(name)) refuse('an unreadable WITH clause');
      defined.add(name);
      at += 1;
      if (words[at] !== 'as' || words[at + 1] !== '(') refuse('an unreadable WITH clause');
      at += 2;
      let depth = 1;
      while (depth > 0) {
        const next = words[at];
        if (next === undefined) refuse('an unclosed WITH clause');
        if (next === '(') depth += 1;
        else if (next === ')') depth -= 1;
        at += 1;
      }
      if (words[at] !== ',') break;
      at += 1;
    }
  });
  for (const name of defined)
    if (tables.has(name)) refuse(`a WITH clause takes the name of the table ${name}`);
  const sources: string[] = [];
  words.forEach((word, index) => {
    if (word === 'using' && words[index + 1] !== '(') refuse('a USING that brings a table');
    if (word === 'table') refuse('a TABLE shorthand');
    if (word !== 'from' && word !== 'join') return;
    const before = words[index - 1];
    const prev = words[index - 2];
    if (before === 'delete' && (prev === undefined || prev === ';' || prev === '(')) return;
    if (before === 'distinct' && (prev === 'is' || prev === 'not')) return;
    let at = index + 1;
    if (words[at] === 'only') at += 1;
    const source = words[at];
    if (source === '(') refuse(`a subquery after ${word.toUpperCase()}`);
    if (!isName(source)) refuse(`no table after ${word.toUpperCase()}`);
    if (words[at + 1] === '(') refuse(`a function after ${word.toUpperCase()}`);
    at += 1;
    if (words[at] === 'as') at += 1;
    const alias = words[at];
    if (isName(alias) && !stops.has(alias)) at += 1;
    const next = words[at];
    if (next === ',') refuse(`a comma between two sources of one ${word.toUpperCase()}`);
    if (next !== undefined && !stops.has(next)) refuse(`an unreadable source after ${word.toUpperCase()}`);
    if (!defined.has(source)) sources.push(source);
  });
  const returned = words.includes('returning') ? writtenTables(sql) : [];
  return [...new Set([...sources, ...returned])];
}

/** The tables the contract names, written or read by an operation: a WITH clause may not take one of their names. */
export function knownTables(): ReadonlySet<string> {
  return new Set(DATA_OP_NAMES.flatMap((op) => [...DATA_OPS[op].writes, ...DATA_OPS[op].reads]));
}

/** The tables of `actual` against those of `declared`: equal as sets, or the error that names both. */
function checkAccess(
  op: DataOpName,
  verb: 'writes' | 'reads',
  actual: Set<string>,
  declared: readonly string[],
): void {
  if (actual.size !== declared.length || declared.some((name) => !actual.has(name)))
    throw new Error(
      `operation ${op} ${verb} ${JSON.stringify([...actual])} but declares ${JSON.stringify(declared)} in DATA_OPS`,
    );
}

/**
 * Refuses a table whose SQL for an operation writes, or reads, other tables than the `writes`, or the `reads`, that
 * operation declares in DATA_OPS.
 */
function checkWrites(table: StatementTable): StatementTable {
  for (const op of DATA_OP_NAMES) {
    const statements = table.statements.filter((s) => s.op === op);
    checkAccess(op, 'writes', new Set(statements.flatMap((s) => writtenTables(s.text))), DATA_OPS[op].writes);
    checkAccess(
      op,
      'reads',
      new Set(statements.flatMap((s) => readTables(s.text, knownTables(), s.file))),
      DATA_OPS[op].reads,
    );
  }
  return table;
}
