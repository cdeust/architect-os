import { z } from 'zod';
import { IdSchema } from './ids.js';

/**
 * The broker of 1b.2 (docs/design/platform-v3-srt.md, §2, Broker), as its client the gateway sees it: two tools on its
 * stdio, and one usage record per upstream answer, sent back as an MCP `notifications/message` of the logger `usage`.
 */

/** A task token: random, url-safe, at least 32 characters, so that it cannot be guessed by joining the port. */
export const BrokerTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

export const BROKER_TOOLS = {
  token_grant: {
    description:
      'Make a task token worth spending for its task, until revoked: the worker presents it as its API key. ' +
      'A token already granted is refused.',
    input: z.strictObject({ token: BrokerTokenSchema, task: IdSchema, parent: IdSchema.optional() }),
  },
  token_revoke: {
    description: 'Make a task token worth nothing: the broker answers 401 to it from then on.',
    input: z.strictObject({ token: BrokerTokenSchema }),
  },
} as const;

export type BrokerToolName = keyof typeof BROKER_TOOLS;

/** The logger of the usage notifications. */
export const USAGE_LOGGER = 'usage';

const Tokens = z.number().int().nonnegative();

/** One answered request: never its content, never a key or a token. */
export const UsageRecordSchema = z.strictObject({
  at: z.iso.datetime(),
  status: z.number().int(),
  task: IdSchema,
  parent: IdSchema.optional(),
  route: z.string().optional(),
  error_type: z.string().optional(),
  model: z.string().optional(),
  input_tokens: Tokens.optional(),
  output_tokens: Tokens.optional(),
  cache_read_input_tokens: Tokens.optional(),
  cache_creation_input_tokens: Tokens.optional(),
});
export type BrokerUsageRecord = z.infer<typeof UsageRecordSchema>;
