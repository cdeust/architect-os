// `record.json`, l'enregistrement d'une étape (docs/design/orchestration-fable-5-2.md, §14, « Étape 1, les consignes
// d'étape dans le dépôt ») : écrit par l'hôte seul, il ne porte aucun texte de session, seulement des nombres, des
// noms pris du fichier descriptif, des valeurs de listes fermées et des empreintes.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ticketsSchema } from '@architect-os/contracts';
import { codexModelSchema, type StepFile } from './step-file.js';
import { freshInputsMax, freshInputId, freshReasons, type FreshInputOutcome } from './fresh-inputs.js';
import type { TreeFingerprint } from './tree-fingerprint.js';

// Les schémas et les expressions sont construits dans des fonctions : un littéral au niveau du module ferait rejouer
// toute la suite pour chacun de ses mutants (Stryker).
function stepName(): RegExp {
  return /^[a-z][a-z0-9-]{0,31}$/;
}
function modelName(): RegExp {
  return /^[a-z0-9][a-z0-9.-]{0,63}$/;
}

/** Le nom d'une étape est le nom de son dossier : il entre dans un chemin du dépôt. */
export function isStepName(name: string): boolean {
  return stepName().test(name);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Un objet dont chaque clé passe `key`. zod écarte sans rien dire une clé `__proto__` : elle est cherchée avant lui, et
 * l'objet qui la porte est refusé.
 */
function keyed<Value extends z.ZodType>(key: RegExp, value: Value) {
  return z.preprocess(
    // `Object(raw)` : une valeur qui n'est pas un objet n'a aucune clé propre, et le schéma la refuse ensuite.
    (raw) => (Object.hasOwn(Object(raw), '__proto__') ? undefined : raw),
    z.record(z.string().regex(key), value),
  );
}

/** Missing terminal usage leaves the corresponding run total unknown. */
export function observedTokens(
  receipts: readonly import('./responses-proxy.js').ResponseReceipt[],
  field: 'inputTokens' | 'outputTokens',
) {
  let total = 0;
  for (const receipt of receipts) {
    const tokens = receipt[field];
    if (tokens === null) return null;
    total += tokens;
  }
  return total;
}

export function stepRecordSchema() {
  const commit = () => z.string().regex(/^[0-9a-f]{40}$/);
  const digest = () => z.string().regex(/^[0-9a-f]{64}$/);
  const seconds = () => z.number().int().min(0);
  const record = z.strictObject({
    step: z.string().regex(stepName()),
    startedAt: z.iso.datetime(),
    tree: z.strictObject({ commit: commit(), tree: commit(), clean: z.boolean() }),
    inputs: keyed(/^(brief\.md|step\.json|scout\.[a-z][a-z0-9-]{0,31}\.md)$/, digest()),
    tickets: ticketsSchema().optional(),
    // Les écarts que la construction a déclarés (`src/build-claims.ts`), absent quand son rapport n'en porte aucun
    // bloc : un bloc refusé (`valid` faux) n'en donne aucun ; sinon l'identifiant que l'hôte a donné à chacun, dans
    // l'ordre, et l'empreinte de la ligne que les revues ont reçue. Jamais leur texte.
    claims: z
      .strictObject({
        valid: z.boolean(),
        given: z.array(z.strictObject({ id: z.string(), sha256: digest() })).max(20),
      })
      .optional(),
    admission_sha256: digest().optional(),
    launcher: keyed(/^(?!.*\.\.)[a-z0-9][a-z0-9./-]*$/, digest()),
    sessions: z.array(
      z
        .strictObject({
          role: z.enum(['scout', 'build', 'fresh', 'review']),
          provider: z.enum(['anthropic', 'openai']).optional(),
          client: z.strictObject({ version: z.string().min(1), sha256: digest() }).optional(),
          usage: z
            .strictObject({ inputTokens: seconds().nullable(), outputTokens: seconds().nullable() })
            .optional(),
          responses: z
            .array(
              z.strictObject({
                model: codexModelSchema,
                request: z.int().positive(),
                terminal: z.enum(['completed', 'failed', 'incomplete', 'interrupted']),
                inputTokens: seconds().nullable(),
                outputTokens: seconds().nullable(),
              }),
            )
            .optional(),
          name: z.string().regex(stepName()).optional(),
          model: z.string().min(1),
          effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
          completed: z.boolean(),
          // Les enregistrements publiés avant la conservation du code de sortie ne portent pas ce champ.
          exitCode: z.number().int().nonnegative().optional(),
          stopped: z.boolean(),
          durationSeconds: seconds(),
          costUsd: z.number().min(0).nullable(),
          costByModel: keyed(modelName(), z.number().min(0)),
        })
        .refine((session) => {
          if (session.provider !== 'openai')
            return session.costUsd !== null && !session.client && !session.usage && !session.responses;
          if (
            session.role !== 'build' ||
            !session.client ||
            !session.usage ||
            !session.responses ||
            session.costUsd !== null
          )
            return false;
          return (
            codexModelSchema.safeParse(session.model).success &&
            session.responses.every((r, i) => r.model === session.model && r.request === i + 1) &&
            session.usage.inputTokens === observedTokens(session.responses, 'inputTokens') &&
            session.usage.outputTokens === observedTokens(session.responses, 'outputTokens') &&
            (!session.completed ||
              (session.responses.length > 0 && session.responses.every((r) => r.terminal === 'completed')))
          );
        }),
    ),
    checks: z.array(
      z.strictObject({
        name: z.string().regex(stepName()),
        passed: z.boolean(),
        stopped: z.boolean(),
        durationSeconds: seconds(),
      }),
    ),
    // Les entrées inventées (§4) : si la configuration de l'exécuteur avait changé, si la sortie de la session a été
    // reçue, pourquoi la phase arrête l'étape, puis l'identifiant que l'hôte a donné à chaque entrée, son issue et sa
    // durée ; aucun texte de la session. Absent quand l'étape n'en a pas. La cohérence de ces champs entre eux et avec
    // l'issue de l'étape est tenue plus bas (`freshConsistent`).
    freshInputs: z
      .strictObject({
        runnerChanged: z.boolean(),
        received: z.boolean(),
        reasons: z.array(
          z.enum([
            'FRESH_INPUT_FAILED',
            'FRESH_INPUT_INVALID',
            'FRESH_OUTPUT_REFUSED',
            'FRESH_RUNNER_CHANGED',
            'FRESH_VALIDATOR_STOPPED',
          ]),
        ),
        // L'identifiant d'une entrée est sa place : `fresh-1`, `fresh-2`, … dans l'ordre, seize au plus.
        inputs: z
          .array(
            z.strictObject({
              id: z.string(),
              outcome: z.enum(['passed', 'failed', 'stopped', 'invalid', 'unvalidated']),
              durationSeconds: seconds(),
            }),
          )
          .max(freshInputsMax())
          .refine((inputs) => inputs.every(({ id }, index) => id === freshInputId(index))),
      })
      .optional(),
    reviews: z.array(
      z.strictObject({
        name: z.string().regex(stepName()),
        verdict: z.enum(['accept', 'request_changes', 'invalid']),
        findings: seconds(),
        // Le statut de chaque critère d'acceptation qu'un verdict valide a rendu (R2) ; absent sans critère.
        criteria: z
          .array(
            z.strictObject({
              id: z.string().regex(/^AC-\d{1,9}$/),
              status: z.enum(['met', 'unmet', 'not_established']),
            }),
          )
          .min(1)
          .optional(),
        // Le statut de chaque écart déclaré qu'un verdict valide a rendu ; absent sans écart déclaré.
        claims: z
          .array(
            z.strictObject({
              id: z.string(),
              status: z.enum(['verified', 'refuted', 'not_checked']),
            }),
          )
          .min(1)
          .optional(),
      }),
    ),
    outcome: z.enum(['passed', 'refused']),
  });
  return record.refine(coherent).refine(freshConsistent);
}

/**
 * Les entrées inventées d'un enregistrement se tiennent : une configuration changée n'a rien reçu, une sortie reçue a
 * au moins une entrée et une sortie non reçue aucune, les raisons sont exactement celles que `freshReasons` déduit, et une étape `passed` n'en a aucune.
 */
function freshConsistent({ freshInputs, outcome }: { freshInputs?: FreshRecord; outcome: string }): boolean {
  if (freshInputs === undefined) return true;
  const { runnerChanged, received, reasons, inputs } = freshInputs;
  const outcomes = inputs.map((input) => input.outcome);
  return (
    !(runnerChanged && received) &&
    received === inputs.length > 0 &&
    JSON.stringify(reasons) === JSON.stringify(freshReasons({ runnerChanged, received, outcomes })) &&
    (outcome !== 'passed' || reasons.length === 0)
  );
}

interface FreshRecord {
  runnerChanged: boolean;
  received: boolean;
  reasons: readonly string[];
  inputs: readonly { outcome: FreshInputOutcome }[];
}

/** Les champs que `coherent` lit, typés sans passer par le schéma qui l'appelle. */
interface Coherence {
  readonly claims?:
    { readonly valid: boolean; readonly given: readonly { readonly id: string }[] } | undefined;
  readonly checks: readonly { readonly passed: boolean }[];
  readonly reviews: readonly {
    readonly verdict: 'accept' | 'request_changes' | 'invalid';
    readonly criteria?: readonly { readonly id: string; readonly status: string }[] | undefined;
    readonly claims?: readonly { readonly id: string; readonly status: string }[] | undefined;
  }[];
  readonly outcome: 'passed' | 'refused';
}

/** Les identifiants d'une liste de statuts, en une chaîne comparable ; une liste absente est vide. */
const idsOf = (statuses: readonly { id: string }[] | undefined): string =>
  JSON.stringify((statuses ?? []).map(({ id }) => id));

/**
 * Ce que l'enregistrement doit dire de lui-même, que les schémas de ses champs ne voient pas.
 *
 * - Les revendications sont exactement CL-1, CL-2… dans l'ordre (cette règle seule dit ce qu'est leur identifiant) ;
 *   un bloc refusé n'en donne aucune.
 * - Un verdict invalide ne rend aucun statut. Un verdict valide rend un statut pour chaque revendication donnée, et
 *   tous les verdicts valides couvrent les mêmes critères : un statut retiré à la main se voit.
 * - Une étape qui passe n'a que des contrôles passés, des verdicts `accept`, des critères `met` et des revendications
 *   `verified`, et une revendication donnée n'y passe jamais sans revue.
 */
function coherent({ claims, checks, reviews, outcome }: Coherence): boolean {
  const given = claims?.given ?? [];
  const judged = reviews.filter((review) => review.verdict !== 'invalid');
  return (
    (claims?.valid !== false || given.length === 0) &&
    given.every(({ id }, index) => id === `CL-${index + 1}`) &&
    reviews.every(
      (review) =>
        review.verdict !== 'invalid' || (review.claims === undefined && review.criteria === undefined),
    ) &&
    judged.every((review) => idsOf(review.claims) === idsOf(given)) &&
    new Set(judged.map((review) => idsOf(review.criteria))).size <= 1 &&
    (outcome === 'refused' ||
      (checks.every((check) => check.passed) &&
        (given.length === 0 || reviews.length > 0) &&
        reviews.every(
          (review) =>
            review.verdict === 'accept' &&
            (review.criteria ?? []).every(({ status }) => status === 'met') &&
            (review.claims ?? []).every(({ status }) => status === 'verified'),
        )))
  );
}
export type StepRecord = z.infer<ReturnType<typeof stepRecordSchema>>;

/**
 * Le coût par modèle tel que l'enregistrement le garde : une clé du flux d'une session n'est gardée que si elle passe
 * l'expression des noms de modèles ; le coût de toute autre est ajouté sous `other`. Les clés sont triées.
 */
export function publicCosts(costs: Readonly<Record<string, number>>): Record<string, number> {
  const kept = new Map<string, number>();
  for (const [name, cost] of Object.entries(costs)) {
    const key = modelName().test(name) ? name : 'other';
    kept.set(key, (kept.get(key) ?? 0) + cost);
  }
  // Les clés viennent de la Map : chacune y a sa somme.
  return Object.fromEntries([...kept.keys()].sort().map((key) => [key, kept.get(key) as number]));
}

/** Ce qu'une session a laissé de mesurable. */
export interface RecordedSession {
  role: 'scout' | 'build' | 'fresh' | 'review';
  provider?: 'anthropic' | 'openai';
  client?: { version: string; sha256: string };
  usage?: { inputTokens: number | null; outputTokens: number | null };
  responses?: readonly import('./responses-proxy.js').ResponseReceipt[];
  /** Absent pour la construction. */
  name?: string | undefined;
  config: Pick<StepFile['build'], 'model' | 'effort'>;
  completed: boolean;
  exitCode: number;
  stopped: boolean;
  durationSeconds: number;
  costUsd: number;
  costByModel: Readonly<Record<string, number>>;
}

export interface RecordParts {
  step: string;
  admission_sha256?: string;
  startedAt: Date;
  tree: TreeFingerprint;
  /** Le texte lu au départ de chaque fichier d'entrée, par nom de fichier. */
  inputs: Readonly<Record<string, string>>;
  tickets?: StepFile['tickets'];
  claims?: StepRecord['claims'];
  /** Le texte de chaque fichier du lanceur, par chemin relatif à `packages/sandbox`. */
  launcher: Readonly<Record<string, string>>;
  sessions: readonly RecordedSession[];
  checks: readonly { name: string; passed: boolean; stopped: boolean; durationSeconds: number }[];
  freshInputs?: StepRecord['freshInputs'];
  reviews: StepRecord['reviews'];
  outcome: StepRecord['outcome'];
}

function digests(texts: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(texts).map(([file, text]) => [file, sha256(text)]));
}

export function buildRecord(parts: RecordParts): StepRecord {
  return {
    step: parts.step,
    startedAt: parts.startedAt.toISOString(),
    tree: parts.tree,
    ...(parts.admission_sha256 ? { admission_sha256: parts.admission_sha256 } : {}),
    inputs: digests(parts.inputs),
    ...(parts.tickets ? { tickets: parts.tickets } : {}),
    ...(parts.claims ? { claims: parts.claims } : {}),
    launcher: digests(parts.launcher),
    sessions: parts.sessions.map((session) => ({
      role: session.role,
      ...(session.provider ? { provider: session.provider } : {}),
      ...(session.client
        ? {
            client: session.client,
            usage: session.usage,
            responses: session.responses?.slice(),
          }
        : {}),
      name: session.name,
      model: session.config.model,
      effort: session.config.effort,
      completed: session.completed,
      exitCode: session.exitCode,
      stopped: session.stopped,
      durationSeconds: session.durationSeconds,
      costUsd: session.provider === 'openai' ? null : session.costUsd,
      costByModel: publicCosts(session.costByModel),
    })),
    checks: parts.checks.map(({ name, passed, stopped, durationSeconds }) => ({
      name,
      passed,
      stopped,
      durationSeconds,
    })),
    ...(parts.freshInputs ? { freshInputs: parts.freshInputs } : {}),
    reviews: parts.reviews,
    outcome: parts.outcome,
  };
}
