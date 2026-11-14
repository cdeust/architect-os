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
  /** Les lignes non vides du flux qui ne sont pas du JSON (une ligne coupée par la mort de la session en est une). */
  ignoredLines: number;
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

/** Les valeurs JSON du flux, et le nombre de lignes non vides qui n'en sont pas : elles sont ignorées. */
function events(stream: string): { values: unknown[]; ignoredLines: number } {
  const lines = stream.split('\n').filter((line) => line !== '');
  const values: unknown[] = [];
  for (const line of lines) {
    try {
      values.push(JSON.parse(line) as unknown);
    } catch {
      // Une ligne qui n'est pas du JSON ne donne pas de valeur : elle est comptée par différence, plus bas.
    }
  }
  // Par différence : toute ligne non vide donne une valeur ou est ignorée, donc une valeur en trop se voit ici.
  return { values, ignoredLines: lines.length - values.length };
}

/** Les mesures d'une session `claude -p --verbose --output-format stream-json`. */
export function measureSession(stream: string): SessionMeasure {
  const { values: all, ignoredLines } = events(stream);
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
      ignoredLines,
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
    ignoredLines,
    report: result.result,
    structuredOutput: result.structured_output,
  };
}
