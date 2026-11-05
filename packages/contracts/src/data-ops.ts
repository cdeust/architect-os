import { z } from 'zod';
import { RunEventSchema, RunEventTypeSchema, RunSchema, RunStatusSchema } from './run.js';
import { MemoryItemSchema } from './tools.js';
import { UsageRecordSchema } from './broker.js';
import { IdSchema } from './ids.js';

/** Dimension of the pgvector column declared in data/migrations/0002_memory.sql. */
export const EMBEDDING_DIMENSION = 384;

const RunIdSchema = z.uuid();
const EmbeddingSchema = z.array(z.number()).length(EMBEDDING_DIMENSION);

/** Typed operations of the data component. There is no free-form SQL operation. */
export const RunsCreateInputSchema = z.object({
  service: z.string(),
  tool: z.string(),
  input: z.unknown(),
});
export const RunsAppendEventInputSchema = z.object({
  run_id: RunIdSchema,
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const RunsCompleteInputSchema = z.object({
  run_id: RunIdSchema,
  status: RunStatusSchema.exclude(['running']),
  result: z.unknown(),
});
export const RunsGetInputSchema = z.object({ run_id: RunIdSchema });
export const RunsEventsInputSchema = z.object({ run_id: RunIdSchema });
export const MemoryInsertInputSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  embedding: EmbeddingSchema.optional(),
});
export const MemorySearchInputSchema = z.object({
  query: z.string(),
  embedding: EmbeddingSchema.optional(),
  limit: z.number().int().min(1).max(50).default(5),
});

/**
 * The layer a usage record measures (docs/design/platform-v3-srt.md, §2, Mesure du coût): `broker`, what passes through
 * the broker, stamped by the gateway that forwards its records; `client`, the context tokens of the client, from the M1
 * hook of brick 1c. M2 sums both.
 */
export const UsageLayerSchema = z.enum(['broker', 'client']);
export type UsageLayer = z.infer<typeof UsageLayerSchema>;

/** One usage record as the registry keeps it: the record of the broker and its layer. Append-only. */
export const UsageAppendInputSchema = UsageRecordSchema.extend({ layer: UsageLayerSchema });
export type UsageAppendInput = z.infer<typeof UsageAppendInputSchema>;

/** The sums of M2, per task, layer and model, for one task or all, bounded in rows like every read. */
export const UsageAggregateInputSchema = z.strictObject({
  task: UsageRecordSchema.shape.task.optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
const Sum = z.number().int().nonnegative();
/** One group of M2. `model` is absent for the answers that named none (an error before the model was known). */
export const UsageAggregateRowSchema = z.strictObject({
  task: z.string(),
  layer: UsageLayerSchema,
  model: z.string().optional(),
  requests: Sum,
  input_tokens: Sum,
  output_tokens: Sum,
  cache_read_input_tokens: Sum,
  cache_creation_input_tokens: Sum,
});
export type UsageAggregateRow = z.infer<typeof UsageAggregateRowSchema>;

/** Why a task ended (§2, Bornes opérationnelles): done, its deadline, its number of calls, cancelled, an error. */
export const TaskEndingSchema = z.enum(['completed', 'deadline', 'max_calls', 'cancelled', 'error']);
export type TaskEnding = z.infer<typeof TaskEndingSchema>;

export const TasksOpenInputSchema = z.strictObject({
  task: IdSchema,
  client: z.string().min(1).max(200),
  profile: z.string().min(1).max(200),
  deadline_at: z.iso.datetime(),
});
export const TasksEndInputSchema = z.strictObject({ task: IdSchema, ending: TaskEndingSchema });
export const TasksGetInputSchema = z.strictObject({ task: IdSchema });
/** A task of the registry; `ended_at` and `ending` are absent while it is open. */
export const TaskRecordSchema = z.strictObject({
  task: z.string(),
  client: z.string(),
  profile: z.string(),
  opened_at: z.iso.datetime(),
  deadline_at: z.iso.datetime(),
  ended_at: z.iso.datetime().optional(),
  ending: TaskEndingSchema.optional(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

/**
 * Every operation declares the tables it writes (`writes`), schema-qualified when not in `public`. data/sql is checked
 * against it when the statement table loads (data/src/infrastructure/sql-store.ts), and the gateway refuses at each
 * operation a table outside the `writes_tables` of the calling module (§3, brick 1b.4).
 */
export const DATA_OPS = {
  'runs.create': { input: RunsCreateInputSchema, output: RunSchema, writes: ['runs'] },
  'runs.appendEvent': { input: RunsAppendEventInputSchema, output: RunEventSchema, writes: ['run_events'] },
  'runs.complete': { input: RunsCompleteInputSchema, output: RunSchema, writes: ['runs'] },
  'runs.get': { input: RunsGetInputSchema, output: RunSchema, writes: [] },
  'runs.events': { input: RunsEventsInputSchema, output: z.array(RunEventSchema), writes: [] },
  'memory.insert': {
    input: MemoryInsertInputSchema,
    output: z.object({ id: z.string() }),
    writes: ['memory.memories'],
  },
  'memory.search': { input: MemorySearchInputSchema, output: z.array(MemoryItemSchema), writes: [] },
  'usage.append': {
    input: UsageAppendInputSchema,
    output: z.object({ id: z.string() }),
    writes: ['usage_records'],
  },
  'tasks.open': { input: TasksOpenInputSchema, output: TaskRecordSchema, writes: ['tasks'] },
  'tasks.end': { input: TasksEndInputSchema, output: TaskRecordSchema, writes: ['tasks'] },
  'tasks.get': { input: TasksGetInputSchema, output: TaskRecordSchema, writes: [] },
  'usage.aggregate': {
    input: UsageAggregateInputSchema,
    output: z.array(UsageAggregateRowSchema),
    writes: [],
  },
} as const satisfies Record<string, { input: z.ZodType; output: z.ZodType; writes: readonly string[] }>;
export type DataOpName = keyof typeof DATA_OPS;
export type DataOpInput<Op extends DataOpName> = z.output<(typeof DATA_OPS)[Op]['input']>;
export type DataOpOutput<Op extends DataOpName> = z.output<(typeof DATA_OPS)[Op]['output']>;
export const DATA_OP_NAMES = Object.keys(DATA_OPS) as DataOpName[];

/**
 * Tools a worker agent may call back into, served by the owning service on the exec network.
 * Each one is a restricted view of one data operation: its input is a subset of that operation's input.
 */
export const INTERNAL_TOOLS = {
  memory_search: {
    owner: 'memory',
    op: 'memory.search',
    description: 'Search stored memories by text.',
    input: MemorySearchInputSchema.pick({ query: true, limit: true }),
  },
  memory_insert: {
    owner: 'memory',
    op: 'memory.insert',
    description: 'Store one memory.',
    input: MemoryInsertInputSchema.pick({ content: true, tags: true }),
  },
} as const;
export type InternalToolName = keyof typeof INTERNAL_TOOLS;
export const INTERNAL_TOOL_NAMES = Object.keys(INTERNAL_TOOLS) as InternalToolName[];
