import { z } from 'zod';
import { CostSchema, EvidenceSchema, ResultStatusSchema, resultSchema } from './result.js';

export const MemoryItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  score: z.number(),
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const RecallInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(5),
});
export type RecallInput = z.infer<typeof RecallInputSchema>;

export const RecallDataSchema = z.object({
  summary: z.string(),
  memories: z.array(MemoryItemSchema),
});
export type RecallData = z.infer<typeof RecallDataSchema>;

export const RememberInputSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type RememberInput = z.infer<typeof RememberInputSchema>;

export const RememberDataSchema = z.object({
  memory_id: z.string(),
});
export type RememberData = z.infer<typeof RememberDataSchema>;

export const ServiceIdSchema = z.enum(['memory']);
export type ServiceId = z.infer<typeof ServiceIdSchema>;

export interface ToolContract<I extends z.ZodType = z.ZodType, D extends z.ZodType = z.ZodType> {
  readonly owner: ServiceId;
  readonly description: string;
  readonly input: I;
  readonly data: D;
  readonly output: z.ZodType;
}

function tool<I extends z.ZodType, D extends z.ZodType>(
  owner: ServiceId,
  description: string,
  input: I,
  data: D,
): ToolContract<I, D> {
  return { owner, description, input, data, output: resultSchema(data) };
}

/** Intent tools exposed to clients. The gateway routes each to its owner. */
export const TOOLS = {
  recall: tool(
    'memory',
    'Recall memories relevant to a question and return a grounded summary with evidence.',
    RecallInputSchema,
    RecallDataSchema,
  ),
  remember: tool('memory', 'Store a piece of knowledge in memory.', RememberInputSchema, RememberDataSchema),
} as const;
export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

/** Wire contract between a service and its worker (one JSON document each way). */
export const WorkerInputSchema = z.object({
  run_id: z.string(),
  tool: z.string(),
  input: z.unknown(),
  /** Set by the service (services/<name>/src/main.ts DEFAULT_LIMITS); the worker has no defaults of its own. */
  limits: z.object({ max_turns: z.number().int().positive(), max_budget_usd: z.number().positive() }),
});
export type WorkerInput = z.infer<typeof WorkerInputSchema>;

/** The worker reports a free-form error code; the service maps it to a named ErrorCode. */
export const WorkerOutputSchema = z.object({
  status: ResultStatusSchema,
  data: z.unknown(),
  evidence: z.array(EvidenceSchema).max(50),
  cost: CostSchema,
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type WorkerOutput = z.infer<typeof WorkerOutputSchema>;

/**
 * What `task_input` gives the worker of an agent tool on its streams (docs/design/platform-v3-srt.md, §2, Un seul
 * transport, brick 1b.5): the tool, its input, and the max_turns of its agent (§2, Bornes opérationnelles). No
 * budget in dollars (decision 11): the tokens of a task are spent at the broker alone.
 */
export const TaskInputSchema = z.strictObject({
  tool: z.string(),
  input: z.unknown(),
  limits: z.strictObject({ max_turns: z.number().int().positive() }),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

/**
 * The frontmatter of a task profile, `agents/<name>.md`, in the format of Claude Code (§4, Profils de task): its
 * name, what it is for, the only tools it may use, and its model. The body of the file is its system prompt.
 */
export const AgentFileSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1),
  tools: z.array(z.string().regex(/^mcp__[a-z][a-z0-9-]*__[a-z][a-z0-9_]*$/)).min(1),
  model: z.enum(['haiku', 'sonnet', 'opus']),
});
export type AgentFile = z.infer<typeof AgentFileSchema>;
