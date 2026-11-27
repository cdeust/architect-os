// Le port `StepStore` (docs/design/orchestration-fable-5-2.md, §15, étape A) : ce que `npm run step` retient d'une
// étape, derrière un port. Une étape d'un run se réserve une fois ; chaque artefact est d'un genre nommé, écrit une fois,
// avec ses octets, après que le port a vérifié son nom, sa taille, l'absence de forme de secret et le schéma de son
// genre ; les événements s'ajoutent dans l'ordre et ne changent plus. Le vocabulaire (genres, noms, événements) est
// celui de `@architect-os/contracts`, que partagent les opérations `steps.*` de `data`. Ni fichier ni processus ici :
// l'adaptateur des fichiers est `step-store-file.ts` ; l'adaptateur en mémoire est plus bas.
import { z } from 'zod';
import {
  STEP_ARTIFACT_MAX_BYTES,
  StepArtifactKindSchema,
  StepEventSchema,
  StepNameSchema,
  UNNAMED_STEP_ARTIFACT_KINDS,
  type StepArtifactKind,
  type StepEvent,
} from '@architect-os/contracts';
import { findCredential } from './credential-shapes.js';
import { ReviewVerdictSchema } from './review-verdict.js';
import { buildClaimsSchema } from './build-claims.js';
import { factsSchema, rejections } from './scout-facts.js';

export { STEP_ARTIFACT_MAX_BYTES, type StepArtifactKind, type StepEvent };

/** Les arbres que l'étape lit : son état ne doit pas les recouvrir. Seul un adaptateur sur le disque en a l'usage. */
export interface StepPlace {
  readonly intake: string;
  readonly worktree: string;
}

/** Un événement tel qu'il est relu : son rang, à partir de 0, dans l'ordre de l'ajout. */
export type RecordedStepEvent = StepEvent & { readonly seq: number };

/** L'état d'une étape réservée. Chaque écriture est vérifiée avant l'adaptateur ; aucune ne remplace ce qui est écrit. */
export interface StepRecorder {
  /** Écrit un artefact ; `name` est celui de la session ou du contrôle, absent pour les genres uniques par étape. */
  record(kind: StepArtifactKind, name: string | undefined, text: string): void;
  appendEvent(event: StepEvent): void;
  /** Le texte d'un artefact écrit, `undefined` s'il ne l'est pas. */
  read(kind: StepArtifactKind, name: string | undefined): string | undefined;
  events(): RecordedStepEvent[];
}

/** Les étapes d'un run. Réserver deux fois la même étape est refusé (`EEXIST`). */
export interface StepStore {
  reserve(step: string, place: StepPlace): StepRecorder;
}

export type StepStoreErrorCode =
  | 'EEXIST'
  | 'STEP_NAME_INVALID'
  | 'STEP_NOT_RESERVED'
  | 'STEP_ARTIFACT_INVALID'
  | 'STEP_ARTIFACT_TOO_LARGE'
  | 'STEP_ARTIFACT_CREDENTIAL'
  | 'STEP_EVENT_INVALID';

/** Un refus du port. Le message nomme ce qui est refusé, jamais le contenu (une forme de secret n'y est pas recopiée). */
export class StepStoreError extends Error {
  constructor(
    readonly code: StepStoreErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'StepStoreError';
  }
}

/** Refuse un nom d'étape qui n'en est pas un : il entre dans un chemin. */
export function checkStepName(step: string): void {
  if (!StepNameSchema.safeParse(step).success) throw new StepStoreError('STEP_NAME_INVALID', 'nom d’étape');
}

// Les schémas sont construits dans des fonctions : un littéral au niveau du module ferait rejouer toute la suite pour
// chacun de ses mutants (Stryker). Chacun accepte au moins ce que `runStep` écrit aujourd'hui : un refus ici est une
// étape en 2.

/** Les mesures d'une session (`measure.ts`, sans `report` ni `structuredOutput`), son code et son arrêt. */
const measureFileSchema = () =>
  z.object({
    completed: z.boolean(),
    answers: z.number(),
    turns: z.number(),
    durationSeconds: z.number(),
    // `null` pour une construction OpenAI : le coût n'en est pas mesuré en dollars.
    costUsd: z.number().nullable(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    cacheReadPerAnswer: z.number(),
    models: z.array(z.string()),
    costByModel: z.record(z.string(), z.number()),
    permissionDenials: z.number(),
    ignoredLines: z.number(),
    exitCode: z.number().nullable(),
    stopped: z.boolean(),
  });

const invalidFileSchema = () => z.strictObject({ invalid: z.string() });

/** Les faits d'un éclaireur : vérifiés, rejetés avec leur raison, et ses `open` ; ou ce qui les invalide. */
const factsFileSchema = () => {
  const fact = factsSchema().shape.facts.element;
  return z.union([
    invalidFileSchema(),
    z.strictObject({
      verified: z.array(fact),
      rejected: z.array(
        z.strictObject({
          fact,
          reason: z.enum(rejections()),
        }),
      ),
      open: z.array(z.string()),
    }),
  ]);
};

/** Un contrôle joué (`step-checks.ts`) : sa commande, son code (`null` sur un signal), sa durée, sa sortie gardée. */
const checkFileSchema = () =>
  z.strictObject({
    command: z.array(z.string()),
    exitCode: z.number().nullable(),
    stopped: z.boolean(),
    durationSeconds: z.number(),
    cut: z.boolean(),
    output: z.string(),
  });

/** Le verdict d'une revue (`review-verdict.ts`), ou ce qui l'invalide. */
const verdictFileSchema = () => z.union([ReviewVerdictSchema, invalidFileSchema()]);

/** Les écarts que la construction déclare (`build-claims.ts`), chacun avec l'identifiant que l'hôte lui donne ; ou ce qui invalide leur bloc. */
const claimsFileSchema = () =>
  z.union([
    invalidFileSchema(),
    z.strictObject({ claims: z.array(buildClaimsSchema().shape.claims.element.extend({ id: z.string() })) }),
  ]);

/** Le schéma du contenu de chaque genre JSON ; un genre absent est un texte (brief, rapport), que rien ne contraint. */
function contentSchemas(): Partial<Record<StepArtifactKind, () => z.ZodType>> {
  return {
    'scout.measure': measureFileSchema,
    'build.measure': measureFileSchema,
    'review.measure': measureFileSchema,
    'scout.facts': factsFileSchema,
    check: checkFileSchema,
    'review.verdict': verdictFileSchema,
    'build.claims': claimsFileSchema,
  };
}

/** Refuse un texte qui porte une forme de secret ; le message nomme la forme, jamais la valeur. */
function refuseCredential(file: string, text: string): void {
  const shape = findCredential(text);
  if (shape !== undefined)
    throw new StepStoreError('STEP_ARTIFACT_CREDENTIAL', `${file} contient la forme ${shape}`);
}

/** Le nom de fichier d'un artefact, celui que `npm run step` écrit depuis O.1. */
export function artifactFile(kind: StepArtifactKind, name: string | undefined): string {
  const [role, part] = kind.split('.') as [string, string | undefined];
  // Un genre unique par étape est un fichier JSON quand son contenu a un schéma, un texte Markdown sinon.
  if (name === undefined) return contentSchemas()[kind] === undefined ? `${kind}.md` : `${kind}.json`;
  return part === undefined ? `${role}.${name}.json` : `${role}.${name}.${part}.json`;
}

/**
 * Vérifie un artefact avant toute écriture, dans cet ordre : son genre et son nom (présent pour une session ou un
 * contrôle, absent sinon), sa taille en octets UTF-8, l'absence d'une forme de secret dans son texte ; pour un genre
 * JSON, ensuite, que c'est du JSON, l'absence d'une forme de secret dans sa valeur une fois les échappements lus
 * (`\u0073k-ant-` y est `sk-ant-`), puis le schéma de son genre.
 */
export function checkArtifact(kind: StepArtifactKind, name: string | undefined, text: string): void {
  const unnamed = UNNAMED_STEP_ARTIFACT_KINDS.includes(kind);
  if (
    !StepArtifactKindSchema.safeParse(kind).success ||
    unnamed !== (name === undefined) ||
    (name !== undefined && !StepNameSchema.safeParse(name).success)
  )
    throw new StepStoreError('STEP_ARTIFACT_INVALID', `genre ou nom refusé : ${kind}`);
  const file = artifactFile(kind, name);
  const bytes = Buffer.byteLength(text);
  if (bytes > STEP_ARTIFACT_MAX_BYTES)
    throw new StepStoreError(
      'STEP_ARTIFACT_TOO_LARGE',
      `${file} : ${bytes} octets, au plus ${STEP_ARTIFACT_MAX_BYTES}`,
    );
  refuseCredential(file, text);
  const schema = contentSchemas()[kind];
  if (schema === undefined) return;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new StepStoreError('STEP_ARTIFACT_INVALID', `${file} n'est pas du JSON`);
  }
  refuseCredential(file, JSON.stringify(value));
  if (!schema().safeParse(value).success)
    throw new StepStoreError('STEP_ARTIFACT_INVALID', `${file} ne suit pas le schéma de ${kind}`);
}

/** Vérifie un événement avant toute écriture : un type et une phase des listes fermées, rien d'autre. */
export function checkEvent(event: StepEvent): void {
  if (!StepEventSchema.safeParse(event).success)
    throw new StepStoreError('STEP_EVENT_INVALID', 'événement refusé');
}

/** Adaptateur en mémoire du port : les étapes d'un run, gardées dans ce processus. */
export class InMemoryStepStore implements StepStore {
  private readonly steps = new Map<string, InMemoryStepRecorder>();

  reserve(step: string): StepRecorder {
    checkStepName(step);
    if (this.steps.has(step)) throw new StepStoreError('EEXIST', `étape déjà réservée : ${step}`);
    const recorder = new InMemoryStepRecorder();
    this.steps.set(step, recorder);
    return recorder;
  }
}

class InMemoryStepRecorder implements StepRecorder {
  private readonly artifacts = new Map<string, string>();
  private readonly log: RecordedStepEvent[] = [];

  record(kind: StepArtifactKind, name: string | undefined, text: string): void {
    checkArtifact(kind, name, text);
    const file = artifactFile(kind, name);
    if (this.artifacts.has(file)) throw new StepStoreError('EEXIST', `artefact déjà écrit : ${file}`);
    this.artifacts.set(file, text);
  }

  appendEvent(event: StepEvent): void {
    checkEvent(event);
    this.log.push({ seq: this.log.length, type: event.type, phase: event.phase });
  }

  read(kind: StepArtifactKind, name: string | undefined): string | undefined {
    return this.artifacts.get(artifactFile(kind, name));
  }

  events(): RecordedStepEvent[] {
    return this.log.map((event) => ({ ...event }));
  }
}
