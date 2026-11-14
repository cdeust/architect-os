// `npm run step -- <dossier>` : une étape de la boucle d'orchestration (docs/design/orchestration-fable-5-2.md, §4).
// La session de construction avec le brief, puis la session de revue, chacune sous srt par l'outil de code ; tout ce
// qu'il faut pour relire l'étape reste dans le dossier. Ni rejeu sur l'hôte, ni porte, ni commit : ils restent à
// l'orchestrateur. `step.ts` ne fait que lui passer le processus.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
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
const verdictSchema = () =>
  JSON.stringify(z.toJSONSchema(ReviewVerdictSchema, { target: 'draft-07', io: 'output' }));

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
  name: 'build' | 'review',
  tool: 'code.json' | 'review.json',
  config: StepFile['build'],
  extra: readonly string[],
  brief: string,
): Promise<{ measure: SessionMeasure; stopped: boolean }> {
  const streamFile = join(folder, `${name}.stream.jsonl`);
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
  deps.writeFile(join(folder, `${name}.measure.json`), json({ ...measure, stopped }));
  if (name === 'build') deps.writeFile(join(folder, 'build.report.md'), report);
  return { measure: { ...measure, report, structuredOutput: _structured }, stopped };
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

/** Une étape ; son code de sortie : 0, 1 (l'étape ne passe pas) ou 2 (refus, échec de l'outil). */
export async function runStep(deps: StepDependencies): Promise<number> {
  try {
    const { folder, step, brief } = readStep(deps);
    const build = await play(deps, folder, 'build', 'code.json', step.build, [], brief);
    const summary: Record<string, unknown> = {
      build: {
        completed: build.measure.completed,
        stopped: build.stopped,
        answers: build.measure.answers,
        turns: build.measure.turns,
        durationSeconds: build.measure.durationSeconds,
        costUsd: build.measure.costUsd,
        cacheReadPerAnswer: build.measure.cacheReadPerAnswer,
      },
    };
    let passes = build.measure.completed && !build.stopped;
    if (step.review !== undefined && passes) {
      const review = await play(
        deps,
        folder,
        'review',
        'review.json',
        step.review,
        ['--json-schema', verdictSchema()],
        brief,
      );
      const verdict = verdictOf(review.measure.structuredOutput);
      deps.writeFile(join(folder, 'review.verdict.json'), json(verdict.file));
      summary['review'] = {
        verdict: verdict.verdict,
        blocks: verdict.blocks,
        findings: verdict.findings,
        costUsd: review.measure.costUsd,
      };
      passes = !verdict.blocks;
    }
    deps.stdout.write(`${JSON.stringify(summary)}\n`);
    return passes ? 0 : 1;
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
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    writeFile: (path, content) => writeFileSync(path, content),
    appendFile: (path, content) => appendFileSync(path, content),
    session: codeToolSession(toolDependencies(proc)),
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}
