import { z } from 'zod';
import { ticketsSchema } from '@architect-os/contracts';
import { freshInputsMax } from './fresh-inputs.js';
import { refusedPath } from './scout-facts.js';

export const codexModelSchema = z.enum(['gpt-6.2-astra', 'gpt-6.2-sol']);
export type CodexModel = z.infer<typeof codexModelSchema>;

// Les schémas sont construits dans des fonctions : un littéral au niveau du module ferait rejouer toute la suite
// pour chacun de ses mutants (Stryker).
const sessionSchema = () =>
  z.strictObject({
    model: z.string().min(1),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    limitSeconds: z.number().int().min(1).max(7200),
  });

/** Le nom d'une session ou d'un contrôle : il entre dans des noms de fichiers, l'expression est ce qui les rend sûrs. */
const nameSchema = () =>
  z
    .string()
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/);

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
        name: nameSchema(),
        ...(kind === 'review'
          ? {
              provider: z.literal('anthropic').optional(),
              dimension: z.enum(['correctness', 'general']).optional(),
            }
          : {}),
      }),
    )
    .max(8)
    .refine((sessions) => duplicated(sessions).length === 0, {
      error: (issue) => `duplicate ${kind} name: ${duplicated(issue.input as { name: string }[]).join(', ')}`,
    })
    .default([]);

/** Un argument de commande : 1 à 300 caractères, sans NUL, saut de ligne ni retour chariot. */
const argumentSchema = () =>
  z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\0\n\r]*$/);

/** Les contrôles de l'étape (§13, O.3c) : au plus 8, chacun un nom (unique parmi eux), un argv et une limite. */
const checksSchema = () =>
  z
    .array(
      z.strictObject({
        name: nameSchema(),
        command: z.array(argumentSchema()).min(1).max(32),
        limitSeconds: z.number().int().min(1).max(7200),
      }),
    )
    .max(8)
    .refine((checks) => duplicated(checks).length === 0, {
      error: (issue) => `duplicate check name: ${duplicated(issue.input as { name: string }[]).join(', ')}`,
    })
    .default([]);

/**
 * Les entrées inventées (docs/design/orchestration-fable-5-2.md, §4) : allumées ou non (`enabled`), le nombre d'entrées
 * demandé (`count`, de 1 à 16), la session neuve qui les invente (modèle, effort, limite) et l'exécuteur fixe que l'hôte
 * joue sous le profil `checker` pour chacune (`runner` : un argv, auquel l'hôte ajoute le chemin du scénario qu'il a
 * écrit, et sa limite), et, facultatif, le validateur (`validate`, de même forme, par exemple la répétition à sec et
 * stricte de l'exécuteur) que l'hôte joue avant lui sur chaque entrée : une entrée qu'il refuse est `invalid`, une
 * faute de la session et non du code. `runnerFiles` nomme les fichiers de configuration de l'exécuteur (de 1 à 16) que
 * l'hôte lit au départ de l'étape, avant toute session : si la construction en change un, aucune entrée n'est jouée. Absentes, l'étape n'en a pas : les dossiers d'avant restent rejouables.
 */
const commandSchema = () =>
  z.strictObject({
    command: z.array(argumentSchema()).min(1).max(32),
    limitSeconds: z.number().int().min(1).max(7200),
  });

/**
 * Un chemin de fichier du worktree, depuis sa racine : ni absolu, ni `..`, ni `.git`, ni barre oblique inverse, NUL ou
 * saut de ligne (`refusedPath`, la règle des citations d'éclaireur).
 */
const worktreePathSchema = () =>
  z
    .string()
    .min(1)
    .max(300)
    .refine((path) => !refusedPath(path), { error: 'a path the host does not read' });

const freshInputsSchema = () =>
  sessionSchema().extend({
    enabled: z.boolean(),
    count: z.number().int().min(1).max(freshInputsMax()),
    runner: commandSchema(),
    validate: commandSchema().optional(),
    runnerFiles: z.array(worktreePathSchema()).min(1).max(16),
  });

/**
 * `step.json`, le fichier descriptif d'une étape : la session de construction, les éclaireurs et les revues (au plus 8
 * de chaque, chacun avec son nom, son modèle, son effort et sa limite) et le nombre de sessions d'une même sorte qui
 * peuvent tourner en même temps. Un nom d'éclaireur peut être celui d'une revue.
 * Le nom entre dans des noms de fichiers : l'expression est ce qui les rend sûrs.
 */
const stepPolicySchema = () =>
  z.strictObject({
    build: z.union([
      sessionSchema().extend({ provider: z.literal('anthropic').optional() }),
      sessionSchema().extend({
        provider: z.literal('openai'),
        model: codexModelSchema,
        effort: z.enum(['low', 'medium', 'high', 'xhigh']),
      }),
    ]),
    scouts: namedSessions('scout'),
    checks: checksSchema(),
    freshInputs: freshInputsSchema().optional(),
    reviews: namedSessions('review'),
    parallel: z.number().int().min(1).max(8).default(2),
  });
/**
 * Ce que Plan ajoute à la politique, et qu'une politique ne peut pas nommer : les tickets et les critères
 * d'acceptation approuvés, que chaque verdict de revue couvre un par un, dans cet ordre (exigence R2,
 * docs/design/exigences-spec.md). Absents dans les dossiers d'avant Plan, qui restent rejouables.
 */
export const stepFileSchema = () =>
  stepPolicySchema().extend({
    tickets: ticketsSchema().optional(),
    acceptance: z
      .array(z.string().regex(/^AC-\d{1,9}$/))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, { error: 'duplicate acceptance id' })
      .optional(),
  });
export type StepFile = z.infer<ReturnType<typeof stepFileSchema>>;

export const parseStepPolicy = (raw: unknown) => stepPolicySchema().parse(raw);
export const parseStepFile = (raw: unknown): StepFile => stepFileSchema().parse(raw);
