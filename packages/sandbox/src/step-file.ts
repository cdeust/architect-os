import { z } from 'zod';
import { ticketsSchema } from '@architect-os/contracts';

import { codexModelSchema } from './models.js';
import {
  deriveRoute,
  routeBlockSchema,
  routingDigest,
  ticketIdSchema,
  type RoutingTable,
} from './routing.js';

export { codexModelSchema, type CodexModel } from './models.js';

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
    reviews: namedSessions('review'),
    parallel: z.number().int().min(1).max(8).default(2),
  });
export const stepFileSchema = () =>
  stepPolicySchema().extend({ tickets: ticketsSchema().optional(), routing: routeBlockSchema().optional() });
export type StepFile = z.infer<ReturnType<typeof stepFileSchema>>;

export const parseStepPolicy = (raw: unknown) => stepPolicySchema().parse(raw);
export const parseStepFile = (raw: unknown): StepFile => stepFileSchema().parse(raw);

/**
 * La politique routée de l'opérateur (docs/design/orchestration-fable-5-2.md, §13) : le ticket que l'étape sert (à
 * défaut, la racine unique du graphe), les fournisseurs qu'il admet, les noms des éclaireurs, les contrôles et le
 * parallélisme. Les modèles, les efforts et les limites viennent de la table, jamais de l'opérateur.
 */
const routedPolicySchema = () =>
  z.strictObject({
    routing: z.strictObject({
      ticket: ticketIdSchema().optional(),
      providers: routeBlockSchema().shape.providers,
    }),
    scouts: z
      .array(z.strictObject({ name: nameSchema() }))
      .max(8)
      .refine((scouts) => duplicated(scouts).length === 0, 'duplicate scout name')
      .default([]),
    checks: checksSchema(),
    parallel: z.number().int().min(1).max(8).default(2),
  });
export type RoutedPolicy = z.infer<ReturnType<typeof routedPolicySchema>>;
export const parseRoutedPolicy = (raw: unknown): RoutedPolicy => routedPolicySchema().parse(raw);

/**
 * Le `step.json` d'une politique routée : la première passe de la route pour la construction, le candidat de la table
 * pour chaque éclaireur, aucune revue hors de l'échelle, et le bloc `routing` qui porte la route entière et l'empreinte
 * de la table. Plan l'écrit ; Step le refait et compare.
 */
export function routedStep(
  policy: RoutedPolicy,
  table: RoutingTable,
  tableText: string,
  tickets: StepFile['tickets'],
): StepFile {
  const route = deriveRoute(table, {
    tickets,
    ticket: policy.routing.ticket,
    providers: policy.routing.providers,
    checks: policy.checks.length,
    scouts: policy.scouts.length,
  });
  // Une session d'éclaireur ne porte pas de fournisseur : elle est toujours de Claude Code, sous le profil `reviewer`.
  const { provider: _provider, ...scout } = route.scout ?? { provider: 'anthropic' };
  return parseStepFile({
    build: route.ladder[0]!.build,
    scouts: policy.scouts.map(({ name }) => ({ name, ...scout })),
    checks: policy.checks,
    reviews: [],
    parallel: policy.parallel,
    ...(tickets ? { tickets } : {}),
    routing: {
      providers: policy.routing.providers,
      table_sha256: routingDigest(tableText),
      ...route,
    },
  });
}
