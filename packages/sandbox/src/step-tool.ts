// `npm run step -- <dossier>` : une étape de la boucle d'orchestration (docs/design/orchestration-fable-5-2.md, §4).
// La session de construction avec le brief, puis les sessions de revue (au plus `parallel` à la fois), chacune sous srt par l'outil de code ; tout ce
// qu'il faut pour relire l'étape reste dans le dossier. Ni rejeu sur l'hôte, ni porte, ni commit : ils restent à
// l'orchestrateur. `step.ts` ne fait que lui passer le processus.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { isatty } from 'node:tty';
import { z } from 'zod';
import {
  failureReporter,
  processDependencies,
  runCodeTool,
  timer,
  type CodeProcess,
  type CodeToolDependencies,
} from './code-tool.js';
import { measureSession, type SessionMeasure } from './measure.js';
import { blocks, parseReviewVerdict, ReviewVerdictSchema } from './review-verdict.js';
import { parseStepFile, type StepFile } from './step-file.js';

/** Une session de l'outil : son code de sortie, et si la limite l'a arrêtée. `onOutput` reçoit sa sortie au fil de l'eau. */
export type StepSession = (
  tool: 'code.json' | 'review.json',
  argv: readonly string[],
  brief: string,
  limitSeconds: number,
  onOutput: (chunk: Uint8Array) => void,
) => Promise<{ exitCode: number; stopped: boolean }>;

export interface StepDependencies {
  /** Les arguments après le nom du script. */
  readonly folderArguments: readonly string[];
  /** Le contenu d'un fichier, `undefined` s'il manque. */
  readonly readFile: (path: string) => string | undefined;
  readonly writeFile: (path: string, content: string) => void;
  readonly appendFile: (path: string, content: Uint8Array) => void;
  readonly session: StepSession;
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/** Le refus d'une étape avant toute session. */
class Refusal extends Error {}

const SESSION_ARGUMENTS = ['-p', '--verbose', '--output-format', 'stream-json'];

/** Le schéma du verdict pour `--json-schema` : Claude Code 2.1.325 refuse le `$schema` 2020-12 (mesuré). */
const verdictSchema = () => JSON.stringify(z.toJSONSchema(ReviewVerdictSchema, { target: 'draft-07' }));

const issues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Lit le dossier ; refuse avant toute session. */
function readStep(deps: StepDependencies): { folder: string; step: StepFile; brief: string } {
  const [folder, ...others] = deps.folderArguments;
  if (folder === undefined || others.length > 0) throw new Refusal('un seul dossier est attendu');
  if (!isAbsolute(folder)) throw new Refusal(`le dossier doit être un chemin absolu : ${folder}`);
  const raw = deps.readFile(join(folder, 'step.json'));
  if (raw === undefined) throw new Refusal(`step.json introuvable dans ${folder}`);
  let step: StepFile;
  try {
    step = parseStepFile(JSON.parse(raw));
  } catch (error) {
    throw new Refusal(
      error instanceof z.ZodError ? `step.json refusé : ${issues(error)}` : "step.json n'est pas du JSON",
    );
  }
  const brief = deps.readFile(join(folder, 'brief.md'));
  if (brief === undefined || brief.trim() === '') throw new Refusal('brief.md absent ou vide');
  return { folder, step, brief };
}

/** Joue une session, garde son flux, ses mesures et son rapport ; rend les mesures et le flux. */
async function play(
  deps: StepDependencies,
  folder: string,
  prefix: string,
  tool: 'code.json' | 'review.json',
  config: StepSessionConfig,
  extra: readonly string[],
  brief: string,
): Promise<{ measure: SessionMeasure; stopped: boolean }> {
  const streamFile = join(folder, `${prefix}.stream.jsonl`);
  deps.writeFile(streamFile, '');
  const chunks: Buffer[] = [];
  const argv = [...SESSION_ARGUMENTS, '--model', config.model, '--effort', config.effort, ...extra];
  const { stopped } = await deps.session(tool, argv, brief, config.limitSeconds, (chunk) => {
    chunks.push(Buffer.from(chunk));
    deps.appendFile(streamFile, chunk);
  });
  const {
    report,
    structuredOutput: _structured,
    ...measure
  } = measureSession(Buffer.concat(chunks).toString());
  deps.writeFile(join(folder, `${prefix}.measure.json`), json({ ...measure, stopped }));
  if (tool === 'code.json') deps.writeFile(join(folder, 'build.report.md'), report);
  return { measure: { ...measure, report, structuredOutput: _structured }, stopped };
}

type StepSessionConfig = StepFile['build'];
type ReviewConfig = StepFile['reviews'][number];

interface ReviewOutcome {
  config: ReviewConfig;
  verdict: ReturnType<typeof verdictOf>;
  measure: SessionMeasure;
}

/** Une revue : sa session, puis son verdict écrit dans son fichier. */
async function review(
  deps: StepDependencies,
  folder: string,
  config: ReviewConfig,
  brief: string,
): Promise<ReviewOutcome> {
  const prefix = `review.${config.name}`;
  const { measure } = await play(
    deps,
    folder,
    prefix,
    'review.json',
    config,
    ['--json-schema', verdictSchema()],
    brief,
  );
  const verdict = verdictOf(measure.structuredOutput);
  deps.writeFile(join(folder, `${prefix}.verdict.json`), json(verdict.file));
  return { config, verdict, measure };
}

/**
 * Les revues, au plus `parallel` en même temps, démarrées dans l'ordre du fichier dès qu'une place se libère. Toutes
 * sont attendues, quoi qu'il arrive aux autres ; l'échec rendu est celui de la première en échec, dans l'ordre du fichier.
 */
async function playReviews(
  deps: StepDependencies,
  folder: string,
  configs: readonly ReviewConfig[],
  parallel: number,
  brief: string,
): Promise<ReviewOutcome[]> {
  // Les places prises : chacune se libère quand sa revue a fini, qu'elle ait abouti ou non.
  const places = new Set<Promise<unknown>>();
  const started: Promise<PromiseSettledResult<ReviewOutcome>>[] = [];
  for (const config of configs) {
    if (places.size >= parallel) await Promise.race(places);
    const ended = Promise.allSettled([review(deps, folder, config, brief)]).then(
      ([outcome]) => outcome as PromiseSettledResult<ReviewOutcome>,
    );
    const place: Promise<unknown> = ended.then(() => places.delete(place));
    places.add(place);
    started.push(ended);
  }
  return (await Promise.all(started)).map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}

/** Le verdict de la revue, ou ce qui l'invalide. */
function verdictOf(output: unknown): { file: unknown; verdict: string; blocks: boolean; findings: number } {
  if (output === undefined) return invalid('la session n’a donné aucune sortie structurée');
  try {
    const verdict = parseReviewVerdict(output);
    return {
      file: verdict,
      verdict: verdict.verdict,
      blocks: blocks(verdict),
      findings: verdict.findings.length,
    };
  } catch (error) {
    return invalid(issues(error as z.ZodError));
  }
}
const invalid = (why: string) => ({ file: { invalid: why }, verdict: 'invalid', blocks: true, findings: 0 });

/**
 * La somme par modèle, les modèles dans l'ordre alphabétique ; les dollars sont additionnés tels quels. Une Map et non
 * un objet : un nom de modèle vient du flux d'une session, et `constructor` ou `__proto__` liraient une valeur héritée.
 */
function sumByModel(parts: readonly Record<string, number>[]): Record<string, number> {
  const total = new Map<string, number>();
  for (const part of parts) {
    for (const [model, cost] of Object.entries(part)) total.set(model, (total.get(model) ?? 0) + cost);
  }
  // Les clés viennent de la Map : chacune y a sa somme.
  return Object.fromEntries([...total.keys()].sort().map((model) => [model, total.get(model) as number]));
}

/** Une étape ; son code de sortie : 0, 1 (l'étape ne passe pas) ou 2 (refus, échec de l'outil). */
export async function runStep(deps: StepDependencies): Promise<number> {
  try {
    const { folder, step, brief } = readStep(deps);
    const build = await play(deps, folder, 'build', 'code.json', step.build, [], brief);
    const completed = build.measure.completed && !build.stopped;
    const outcomes = completed ? await playReviews(deps, folder, step.reviews, step.parallel, brief) : [];
    const reviews = Object.fromEntries(
      outcomes.map(({ config, verdict, measure }) => [
        config.name,
        {
          model: config.model,
          verdict: verdict.verdict,
          blocks: verdict.blocks,
          findings: verdict.findings,
          costUsd: measure.costUsd,
          costByModel: measure.costByModel,
        },
      ]),
    );
    const measures = [build.measure, ...outcomes.map(({ measure }) => measure)];
    const summary = {
      build: {
        completed: build.measure.completed,
        stopped: build.stopped,
        answers: build.measure.answers,
        turns: build.measure.turns,
        durationSeconds: build.measure.durationSeconds,
        costUsd: build.measure.costUsd,
        cacheReadPerAnswer: build.measure.cacheReadPerAnswer,
        costByModel: build.measure.costByModel,
      },
      reviews,
      costUsd: measures.reduce((sum, measure) => sum + measure.costUsd, 0),
      costByModel: sumByModel(measures.map((measure) => measure.costByModel)),
    };
    deps.stdout.write(`${JSON.stringify(summary)}\n`);
    return completed && !outcomes.some(({ verdict }) => verdict.blocks) ? 0 : 1;
  } catch (error) {
    if (error instanceof Refusal) {
      deps.stderr.write(`architect-os step: ${error.message}\n`);
      return 2;
    }
    return failureReporter(deps.stderr, 'step')(error);
  }
}

/** Une session réelle : l'outil de code sur les flux, `dependencies(tool)` en donnant les dépendances. */
export function codeToolSession(
  dependencies: (tool: 'code.json' | 'review.json') => CodeToolDependencies,
  run: (deps: CodeToolDependencies) => Promise<number> = runCodeTool,
): StepSession {
  return async (tool, argv, brief, limitSeconds, onOutput) => {
    const base = dependencies(tool);
    let stopped = false;
    const exitCode = await run({
      ...base,
      argv,
      terminal: false,
      stdin: Readable.from([brief]),
      stdout: new Writable({
        write(chunk: Buffer, _encoding, done) {
          onOutput(chunk);
          done();
        },
      }),
      limitMs: limitSeconds * 1000,
      schedule: (fire, ms) =>
        (base.schedule ?? timer)(() => {
          stopped = true;
          fire();
        }, ms),
    });
    return { exitCode, stopped };
  };
}

/** Les dépendances de l'outil de code d'un fichier de description, pour le processus. */
export const toolDependencies =
  (proc: CodeProcess) =>
  (tool: 'code.json' | 'review.json'): CodeToolDependencies =>
    processDependencies(proc, isatty, tool);

/** Les dépendances réelles : les fichiers du disque, les sessions sous srt, les flux du processus. */
export function stepDependencies(proc: CodeProcess): StepDependencies {
  return {
    folderArguments: proc.argv.slice(2),
    readFile: (path) =>
      existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : undefined,
    writeFile: (path, content) => writeFileSync(path, content),
    appendFile: (path, content) => appendFileSync(path, content),
    session: codeToolSession(toolDependencies(proc)),
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}
