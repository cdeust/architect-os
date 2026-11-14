import { z } from 'zod';

export interface SessionMeasure {
  completed: boolean;
  answers: number;
  turns: number;
  durationSeconds: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheReadPerAnswer: number;
  models: string[];
  permissionDenials: number;
  report: string;
  structuredOutput: unknown;
}

// Seuls les champs lus sont déclarés ; les autres sont tolérés.
const ResultEventSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  num_turns: z.number(),
  duration_ms: z.number(),
  total_cost_usd: z.number(),
  result: z.string(),
  permission_denials: z.array(z.unknown()),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_input_tokens: z.number(),
    cache_creation_input_tokens: z.number(),
  }),
  modelUsage: z.record(z.string(), z.unknown()),
  structured_output: z.unknown().optional(),
});

const AssistantEventSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({ id: z.string() }),
});

/** Les valeurs JSON du flux ; une ligne qui n'est pas du JSON est ignorée. */
function events(stream: string): unknown[] {
  return stream.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
      // Stryker disable next-line BlockStatement: équivalent: sans retour, la ligne donne `undefined`, que ni le schéma d'un événement assistant ni celui d'un événement result n'acceptent : elle reste ignorée.
    } catch {
      // Stryker disable next-line ArrayDeclaration: équivalent: une chaîne n'est acceptée par aucun des deux schémas d'événement : la ligne reste ignorée.
      return [];
    }
  });
}

/** Les mesures d'une session `claude -p --verbose --output-format stream-json`. */
export function measureSession(stream: string): SessionMeasure {
  const all = events(stream);
  const ids = new Set<string>();
  for (const event of all) {
    const assistant = AssistantEventSchema.safeParse(event);
    if (assistant.success) ids.add(assistant.data.message.id);
  }
  const answers = ids.size;
  const result = all
    .map((event) => ResultEventSchema.safeParse(event))
    .find((parsed) => parsed.success)?.data;
  if (result === undefined) {
    return {
      completed: false,
      answers,
      turns: 0,
      durationSeconds: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheReadPerAnswer: 0,
      models: [],
      permissionDenials: 0,
      report: '',
      structuredOutput: undefined,
    };
  }
  return {
    completed: result.subtype === 'success' && !result.is_error,
    answers,
    turns: result.num_turns,
    durationSeconds: Math.round(result.duration_ms / 1000),
    costUsd: result.total_cost_usd,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    cacheReadTokens: result.usage.cache_read_input_tokens,
    cacheWriteTokens: result.usage.cache_creation_input_tokens,
    cacheReadPerAnswer: answers === 0 ? 0 : Math.round(result.usage.cache_read_input_tokens / answers),
    models: Object.keys(result.modelUsage).sort(),
    permissionDenials: result.permission_denials.length,
    report: result.result,
    structuredOutput: result.structured_output,
  };
}
