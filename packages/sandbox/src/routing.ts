// La table de routage (docs/design/orchestration-fable-5-2.md, §13) : un fichier du lanceur, `routing.json`, qui donne
// pour chaque rôle de session des bandes de story points, et pour chaque bande la liste ordonnée des candidats
// (fournisseur, modèle, effort, limite). Plan en dérive les sessions d'une étape à partir du ticket qu'elle sert ; Step
// refait la même dérivation sur la table gelée du lanceur et refuse tout écart. Une seule implémentation, ici.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ticketsSchema } from '@architect-os/contracts';
import { codexModelSchema } from './models.js';

/** Un refus de la dérivation : un code fermé, jamais un texte venu du ticket. */
export class RoutingError extends Error {
  constructor(
    readonly code:
      | 'ROUTING_TICKETS_REQUIRED'
      | 'ROUTING_TICKET_UNKNOWN'
      | 'ROUTING_TICKET_AMBIGUOUS'
      | 'ROUTING_NO_ADMITTED_BUILDER'
      | 'ROUTING_NO_ADMITTED_SCOUT'
      | 'ROUTING_NO_INDEPENDENT_REVIEWER',
  ) {
    super(code);
  }
}

// Les schémas sont construits dans des fonctions : un littéral au niveau du module ferait rejouer toute la suite pour
// chacun de ses mutants (Stryker).
const limit = () => z.int().min(1).max(7200);

/** Les fournisseurs dont Step a un adaptateur : l'opérateur n'en admet pas d'autre. */
export const admittedProviderSchema = () => z.enum(['anthropic', 'openai']);
export type AdmittedProvider = z.infer<ReturnType<typeof admittedProviderSchema>>;

const anthropicCandidate = () =>
  z.strictObject({
    provider: z.literal('anthropic'),
    model: z.string().regex(/^claude-[a-z]+-\d+-\d+$/),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    limitSeconds: limit(),
  });
const openaiCandidate = () =>
  z.strictObject({
    provider: z.literal('openai'),
    model: codexModelSchema,
    effort: z.enum(['low', 'medium', 'high', 'xhigh']),
    limitSeconds: limit(),
  });
/**
 * L'agent de Google, appelé directement : aucun identifiant de modèle n'est qualifié et Step n'a pas d'adaptateur. Une
 * route vers lui est une attente nommée, jamais une session.
 */
const googleCandidate = () => z.strictObject({ provider: z.literal('google'), limitSeconds: limit() });

/**
 * Les bandes d'un rôle : la première commence à 1 point, chacune plus haut que la précédente. `requiresChecks` réserve
 * une bande aux étapes munies d'au moins un contrôle sans modèle ; la dernière ne peut pas l'exiger, pour que tout
 * ticket ait une bande.
 */
function bands<Candidate extends z.ZodType>(candidate: Candidate, checks: boolean) {
  return z
    .array(
      z.strictObject({
        fromPoints: z.int().min(1),
        ...(checks ? { requiresChecks: z.literal(true).optional() } : {}),
        candidates: z.array(candidate).min(1).max(4),
      }),
    )
    .min(1)
    .max(8)
    .refine((rows) => rows[0]!.fromPoints === 1, 'ROUTING_FIRST_BAND')
    .refine(
      (rows) => rows.every((row, index) => index === 0 || row.fromPoints > rows[index - 1]!.fromPoints),
      'ROUTING_BANDS_ORDER',
    )
    .refine(
      (rows) => !(rows.at(-1) as { requiresChecks?: true }).requiresChecks,
      'ROUTING_LAST_BAND_REQUIRES_CHECKS',
    );
}

export function routingTableSchema() {
  return z.strictObject({
    description: z.string().trim().min(1),
    version: z.literal(1),
    status: z.literal('provisional'),
    basis: z.string().trim().min(1),
    roles: z.strictObject({
      scout: z.strictObject({ bands: bands(anthropicCandidate(), false) }),
      // Gemini n'est jamais constructeur : le schéma de la construction n'a pas de candidat Google.
      build: z.strictObject({
        bands: bands(z.discriminatedUnion('provider', [anthropicCandidate(), openaiCandidate()]), true),
      }),
      review: z.strictObject({
        bands: bands(z.discriminatedUnion('provider', [googleCandidate(), anthropicCandidate()]), false),
      }),
    }),
  });
}
export type RoutingTable = z.infer<ReturnType<typeof routingTableSchema>>;

/**
 * Le bloc `routing` que Plan écrit dans `step.json` : la demande (ticket, fournisseurs admis), l'empreinte de la table
 * et la route dérivée. Step refait la dérivation et refuse un bloc qui ne lui est pas égal.
 */
export function routeBlockSchema() {
  const review = z.discriminatedUnion('provider', [
    googleCandidate().extend({ waiting: z.boolean() }),
    anthropicCandidate().extend({ waiting: z.boolean() }),
  ]);
  return z.strictObject({
    ticket: z.string().regex(/^TICKET-\d{3}$/),
    points: z.int().min(1),
    providers: z
      .array(admittedProviderSchema())
      .min(1)
      .refine((list) => new Set(list).size === list.length, 'ROUTING_PROVIDER_DUPLICATE'),
    table_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    start: z.enum(['BAND_OF_POINTS', 'BAND_REQUIRES_CHECKS']),
    scout: anthropicCandidate().optional(),
    ladder: z
      .array(
        z.strictObject({
          band: z.int().min(1),
          build: z.discriminatedUnion('provider', [anthropicCandidate(), openaiCandidate()]),
          review,
        }),
      )
      .min(1)
      .max(8),
  });
}
export type RouteBlock = z.infer<ReturnType<typeof routeBlockSchema>>;

export const parseRoutingTable = (text: string): RoutingTable => routingTableSchema().parse(JSON.parse(text));

export const routingDigest = (text: string): string => createHash('sha256').update(text).digest('hex');

type BuildCandidate = RoutingTable['roles']['build']['bands'][number]['candidates'][number];
type ReviewCandidate = RoutingTable['roles']['review']['bands'][number]['candidates'][number];
type ScoutCandidate = RoutingTable['roles']['scout']['bands'][number]['candidates'][number];

/** La revue d'une passe : une session, ou une attente quand son fournisseur n'est pas admis ou n'a pas d'adaptateur. */
export type ReviewRoute = ReviewCandidate & { waiting: boolean };

/** Une passe de construction : la bande, le constructeur et sa revue indépendante. */
export interface Rung {
  band: number;
  build: BuildCandidate;
  review: ReviewRoute;
}

export interface Route {
  ticket: string;
  points: number;
  /** Pourquoi la première passe est dans sa bande. */
  start: 'BAND_OF_POINTS' | 'BAND_REQUIRES_CHECKS';
  scout?: ScoutCandidate;
  /** La première passe, puis une par bande au-dessus, dans l'ordre : l'escalade n'en saute aucune. */
  ladder: Rung[];
}

export interface RouteRequest {
  readonly tickets: z.infer<ReturnType<typeof ticketsSchema>> | undefined;
  /** Le ticket désigné par l'opérateur ; à défaut, la racine unique du graphe. */
  readonly ticket?: string | undefined;
  readonly providers: readonly AdmittedProvider[];
  readonly checks: number;
  readonly scouts: number;
}

/** L'index de la bande d'un nombre de points : la plus haute dont le seuil ne le dépasse pas. */
function bandIndex(rows: readonly { fromPoints: number }[], points: number): number {
  return rows.findLastIndex((row) => row.fromPoints <= points);
}

function chosenTicket(request: RouteRequest) {
  const tickets = request.tickets;
  if (!tickets) throw new RoutingError('ROUTING_TICKETS_REQUIRED');
  if (request.ticket !== undefined) {
    const named = tickets.find(({ id }) => id === request.ticket);
    if (!named) throw new RoutingError('ROUTING_TICKET_UNKNOWN');
    return named;
  }
  const roots = tickets.filter(({ depends_on }) => depends_on.length === 0);
  if (roots.length !== 1) throw new RoutingError('ROUTING_TICKET_AMBIGUOUS');
  return roots[0]!;
}

/**
 * Les sessions d'une étape, dérivées du ticket qu'elle sert et de la table. Le premier candidat admis de chaque bande ;
 * une bande sans candidat admis arrête l'échelle. Le relecteur de chaque passe n'est jamais du fournisseur de son
 * constructeur ; faute d'un relecteur admis, la passe porte l'attente du premier candidat indépendant.
 */
export function deriveRoute(table: RoutingTable, request: RouteRequest): Route {
  const ticket = chosenTicket(request);
  const points = ticket.story_points;
  const admitted = (provider: string) => (request.providers as readonly string[]).includes(provider);
  const buildBands = table.roles.build.bands;
  const reviewBand = table.roles.review.bands[bandIndex(table.roles.review.bands, points)]!;
  const own = bandIndex(buildBands, points);
  const ladder: Rung[] = [];
  let start: Route['start'] = 'BAND_OF_POINTS';
  for (const [index, row] of buildBands.entries()) {
    if (index < own) continue;
    if (row.requiresChecks && request.checks === 0) {
      if (ladder.length === 0) start = 'BAND_REQUIRES_CHECKS';
      continue;
    }
    const build = row.candidates.find(({ provider }) => admitted(provider));
    if (!build) break;
    const independent = reviewBand.candidates.filter(({ provider }) => provider !== build.provider);
    const chosen = independent.find(({ provider }) => admitted(provider)) ?? independent[0];
    if (!chosen) throw new RoutingError('ROUTING_NO_INDEPENDENT_REVIEWER');
    ladder.push({ band: row.fromPoints, build, review: { ...chosen, waiting: !admitted(chosen.provider) } });
  }
  if (ladder.length === 0) throw new RoutingError('ROUTING_NO_ADMITTED_BUILDER');
  const scoutBand = table.roles.scout.bands[bandIndex(table.roles.scout.bands, points)]!;
  const scout = scoutBand.candidates.find(({ provider }) => admitted(provider));
  if (request.scouts > 0 && !scout) throw new RoutingError('ROUTING_NO_ADMITTED_SCOUT');
  return {
    ticket: ticket.id,
    points,
    start,
    ...(request.scouts > 0 ? { scout } : {}),
    ladder,
  };
}
