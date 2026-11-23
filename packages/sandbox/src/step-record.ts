// `record.json`, l'enregistrement d'une étape (docs/design/orchestration-fable-5-2.md, §14, « Étape 1, les consignes
// d'étape dans le dépôt ») : écrit par l'hôte seul, il ne porte aucun texte de session, seulement des nombres, des
// noms pris du fichier descriptif, des valeurs de listes fermées et des empreintes.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { StepFile } from './step-file.js';
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

export function stepRecordSchema() {
  const commit = () => z.string().regex(/^[0-9a-f]{40}$/);
  const digest = () => z.string().regex(/^[0-9a-f]{64}$/);
  const seconds = () => z.number().int().min(0);
  return z.strictObject({
    step: z.string().regex(stepName()),
    startedAt: z.iso.datetime(),
    tree: z.strictObject({ commit: commit(), tree: commit(), clean: z.boolean() }),
    inputs: keyed(/^(brief\.md|step\.json|scout\.[a-z][a-z0-9-]{0,31}\.md)$/, digest()),
    admission_sha256: digest().optional(),
    launcher: keyed(/^(?!.*\.\.)[a-z0-9][a-z0-9./-]*$/, digest()),
    sessions: z.array(
      z.strictObject({
        role: z.enum(['scout', 'build', 'review']),
        name: z.string().regex(stepName()).optional(),
        model: z.string().min(1),
        effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
        completed: z.boolean(),
        // Les enregistrements publiés avant la conservation du code de sortie ne portent pas ce champ.
        exitCode: z.number().int().nonnegative().optional(),
        stopped: z.boolean(),
        durationSeconds: seconds(),
        costUsd: z.number().min(0),
        costByModel: keyed(modelName(), z.number().min(0)),
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
    reviews: z.array(
      z.strictObject({
        name: z.string().regex(stepName()),
        verdict: z.enum(['accept', 'request_changes', 'invalid']),
        findings: seconds(),
      }),
    ),
    outcome: z.enum(['passed', 'refused']),
  });
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
  role: 'scout' | 'build' | 'review';
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
  /** Le texte de chaque fichier du lanceur, par chemin relatif à `packages/sandbox`. */
  launcher: Readonly<Record<string, string>>;
  sessions: readonly RecordedSession[];
  checks: readonly { name: string; passed: boolean; stopped: boolean; durationSeconds: number }[];
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
    launcher: digests(parts.launcher),
    sessions: parts.sessions.map((session) => ({
      role: session.role,
      name: session.name,
      model: session.config.model,
      effort: session.config.effort,
      completed: session.completed,
      exitCode: session.exitCode,
      stopped: session.stopped,
      durationSeconds: session.durationSeconds,
      costUsd: session.costUsd,
      costByModel: publicCosts(session.costByModel),
    })),
    checks: parts.checks.map(({ name, passed, stopped, durationSeconds }) => ({
      name,
      passed,
      stopped,
      durationSeconds,
    })),
    reviews: parts.reviews,
    outcome: parts.outcome,
  };
}
