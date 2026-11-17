import { z } from 'zod';

// Les schémas sont construits dans des fonctions : un littéral au niveau du module ferait rejouer toute la suite
// pour chacun de ses mutants (Stryker).
const sessionSchema = () =>
  z.strictObject({
    model: z.string().min(1),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    limitSeconds: z.number().int().min(1).max(7200),
  });

/** Les noms que plus d'une session porte, une fois chacun, dans l'ordre du fichier. */
const duplicated = (sessions: readonly { name: string }[]): string[] => [
  ...new Set(
    sessions.map((session) => session.name).filter((name, index, names) => names.indexOf(name) !== index),
  ),
];

/** Une liste de sessions nommées (revues ou éclaireurs), au plus 8, chaque nom une seule fois dans la liste. */
const namedSessions = (kind: string) =>
  z
    .array(
      sessionSchema().extend({
        name: z
          .string()
          .max(32)
          .regex(/^[a-z][a-z0-9-]*$/),
      }),
    )
    .max(8)
    .refine((sessions) => duplicated(sessions).length === 0, {
      error: (issue) => `duplicate ${kind} name: ${duplicated(issue.input as { name: string }[]).join(', ')}`,
    })
    .default([]);

/**
 * `step.json`, le fichier descriptif d'une étape : la session de construction, les éclaireurs et les revues (au plus 8
 * de chaque, chacun avec son nom, son modèle, son effort et sa limite) et le nombre de sessions d'une même sorte qui
 * peuvent tourner en même temps. Un nom d'éclaireur peut être celui d'une revue.
 * Le nom entre dans des noms de fichiers : l'expression est ce qui les rend sûrs.
 */
export const stepFileSchema = () =>
  z.strictObject({
    build: sessionSchema(),
    scouts: namedSessions('scout'),
    reviews: namedSessions('review'),
    parallel: z.number().int().min(1).max(8).default(2),
  });
export type StepFile = z.infer<ReturnType<typeof stepFileSchema>>;

export const parseStepFile = (raw: unknown): StepFile => stepFileSchema().parse(raw);
