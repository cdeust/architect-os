import { z } from 'zod';

const SessionSchema = z.strictObject({
  model: z.string().min(1),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  limitSeconds: z.number().int().min(1).max(7200),
});

/** `step.json`, le fichier descriptif d'une étape : la session de construction, et la revue si l'étape en a une. */
export const StepFileSchema = z.strictObject({
  build: SessionSchema,
  review: SessionSchema.optional(),
});
export type StepFile = z.infer<typeof StepFileSchema>;

export const parseStepFile = (raw: unknown): StepFile => StepFileSchema.parse(raw);
