// `npm run step -- <dossier>` : une étape de la boucle d'orchestration (docs/design/orchestration-fable-5-2.md, §4).
// Les éclaireurs (au plus `parallel` à la fois), dont l'hôte vérifie chaque citation en lisant le fichier ; la session de
// construction avec le brief et les faits vérifiés, puis les contrôles sans modèle (§13, O.3c), un à la fois, sous srt
// par le profil `checker`, puis les sessions de revue (au plus `parallel` à la fois), chacune sous srt par l'outil de
// code ; l'état de l'étape reste sous la racine admise, les flux dans le temporaire du run. Ni rejeu sur l'hôte, ni porte, ni commit : ils restent à
// l'orchestrateur. `step.ts` ne fait que lui passer le processus.
import {
  appendFileSync,
  closeSync,
  constants,
  openSync,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { isatty } from 'node:tty';
import { z } from 'zod';
import {
  failureReporter,
  PKG,
  processDependencies,
  runCodeTool,
  srtOptions,
  timer,
  type CodeProcess,
  type CodeToolDependencies,
} from './code-tool.js';
import { buildSbxStep } from './sbx-step.js';
import {
  ClaudeBuilder,
  type Builder,
  type BuildOutcome,
  type StepSession,
  type ToolFile,
} from './builder.js';
import { measureSession, type SessionMeasure } from './measure.js';
import {
  blocks,
  criteriaRefusal,
  parseReviewVerdict,
  priorFindingsDefect,
  renderAcceptance,
  ReviewVerdictSchema,
  type ReviewVerdict,
} from './review-verdict.js';
import { factsJsonSchema, parseFacts, renderFacts, verifyFacts, type Fact } from './scout-facts.js';
import { SrtSandboxRunner } from './srt-runner.js';
import type { SandboxRunner } from './port.js';
import { outputTail, passed, renderChecks, type CheckOutcome, type CheckReport } from './step-checks.js';
import { parseStepFile, routedStep, type StepFile } from './step-file.js';
import {
  passSignal,
  promotes,
  renderPriorFindings,
  renderPromotion,
  stepOutcome,
  type PassSignal,
} from './step-passes.js';
import { parseRoutingTable, RoutingError } from './routing.js';
import {
  observedTokens,
  buildRecord,
  isStepName,
  stepRecordSchema,
  type RecordedSession,
} from './step-record.js';
import { reserveStepOutputs, type StepOutputs } from './step-outputs.js';
import { stepsFolder, type StepsFolder } from './steps-folder.js';
import { parseTool } from './tool.js';
import {
  freezeStepLauncher,
  readStepAdmission,
  requireStepAdmission,
  type StepAdmissionSubject,
} from './step-admission.js';
import { fingerprintTree, type TreeFingerprint } from './tree-fingerprint.js';
import { resolveWorktree } from './worktree.js';

export type { StepSession, ToolFile } from './builder.js';

/** Un contrôle : la commande jouée sous srt (profil `checker`), sa limite en secondes ; ce qu'elle a rendu. */
export type StepCheck = (command: readonly string[], limitSeconds: number) => Promise<CheckOutcome>;

export interface StepDependencies {
  /** Les arguments après le nom du script. */
  readonly folderArguments: readonly string[];
  /** Le contenu d'un fichier, `undefined` s'il manque. */
  readonly readFile: (path: string) => string | undefined;
  /** Le texte d'un fichier du worktree où l'étape tourne, `undefined` s'il n'en est pas un (fichier ordinaire dans ce worktree). */
  readonly readSource: (path: string) => string | undefined;
  readonly writeFile: (path: string, content: string) => void;
  readonly reserveOutputs: (name: string, intake: string, worktree: string) => StepOutputs;
  readonly appendFile: (path: string, content: Uint8Array) => void;
  readonly session: StepSession;
  readonly builder: Builder;
  readonly check: StepCheck;
  /** L'heure, en millisecondes : la durée d'un contrôle est mesurée par l'étape. */
  readonly now: () => number;
  /** La date de départ de l'étape, pour `startedAt` de son enregistrement. */
  readonly date: () => Date;
  /** La racine du worktree où l'étape tourne ; lève si le répertoire de lancement n'est pas cette racine. */
  readonly root: () => string;
  /** L'empreinte du worktree où l'étape tourne ; lève un message fixe si git échoue. */
  readonly fingerprint: () => TreeFingerprint;
  /** Le texte d'un fichier du lanceur, chemin relatif à `packages/sandbox` ; lève s'il manque. */
  readonly readLauncher: (file: string) => string;
  readonly admit: (subject: StepAdmissionSubject) => string;
  readonly dispose?: () => void;
  /** Le dossier `steps/` du worktree. */
  readonly steps: StepsFolder;
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
function readStep(deps: StepDependencies): {
  folder: string;
  step: StepFile;
  raw: string;
  brief: string;
  questions: string[];
} {
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
  if (
    (step.build.provider ?? 'anthropic') === 'anthropic' &&
    step.reviews.some(
      (r) => r.name === 'correctness' || r.name === 'justesse' || r.dimension === 'correctness',
    )
  )
    throw new Refusal('STEP_CORRECTNESS_PROVIDER');
  const brief = deps.readFile(join(folder, 'brief.md'));
  if (brief === undefined || brief.trim() === '') throw new Refusal('brief.md absent ou vide');
  // La question d'un éclaireur est son fichier ; il en faut un, non vide, avant toute session.
  const questions = step.scouts.map((scout) => {
    const file = `scout.${scout.name}.md`;
    const question = deps.readFile(join(folder, file));
    if (question === undefined || question.trim() === '') throw new Refusal(`${file} absent ou vide`);
    return question;
  });
  return { folder, step, raw, brief, questions };
}

type PlayedSession = Awaited<ReturnType<StepSession>> & { measure: SessionMeasure };

/** Le résultat structuré ne peut servir qu'après la réussite du processus et du flux. */
function sessionSucceeded(session: PlayedSession): boolean {
  return passed(session) && session.measure.completed;
}

/** Joue une session et conserve ses mesures avec l'issue observée par le lanceur. */
async function play(
  deps: StepDependencies,
  outputs: StepOutputs,
  prefix: string,
  tool: ToolFile,
  config: StepSessionConfig,
  extra: readonly string[],
  brief: string,
): Promise<PlayedSession> {
  const streamFile = join(outputs.streams, `${prefix}.stream.jsonl`);
  deps.writeFile(streamFile, '');
  const chunks: Buffer[] = [];
  const argv = [...SESSION_ARGUMENTS, '--model', config.model, '--effort', config.effort, ...extra];
  const { exitCode, stopped } = await deps.session(tool, argv, brief, config.limitSeconds, (chunk) => {
    chunks.push(Buffer.from(chunk));
    deps.appendFile(streamFile, chunk);
  });
  const {
    report,
    structuredOutput: _structured,
    ...measure
  } = measureSession(Buffer.concat(chunks).toString());
  deps.writeFile(join(outputs.retained, `${prefix}.measure.json`), json({ ...measure, exitCode, stopped }));
  return { measure: { ...measure, report, structuredOutput: _structured }, exitCode, stopped };
}

/** La borne, en octets, de la sortie gardée d'un contrôle ; celle de `outputTail` et celle que le bloc des revues annonce. */
const outputBound = () => 4000;

type CheckConfig = StepFile['checks'][number];

/** Un contrôle : joué, sa durée mesurée en secondes entières, son résultat écrit dans `check.<nom>.json`. */
async function playCheck(
  deps: StepDependencies,
  outputs: StepOutputs,
  config: CheckConfig,
  pre: string,
): Promise<CheckReport> {
  const before = deps.now();
  const outcome = await deps.check(config.command, config.limitSeconds);
  const durationSeconds = Math.round((deps.now() - before) / 1000);
  const { exitCode, stopped, cut, output } = outcome;
  deps.writeFile(
    join(outputs.retained, `${pre}check.${config.name}.json`),
    json({ command: config.command, exitCode, stopped, durationSeconds, cut, output }),
  );
  return { name: config.name, command: config.command, exitCode, stopped, durationSeconds, cut, output };
}

type StepSessionConfig = Pick<StepFile['build'], 'model' | 'effort' | 'limitSeconds'>;
type ReviewConfig = StepFile['reviews'][number];
type ScoutConfig = StepFile['scouts'][number];

interface ReviewOutcome extends PlayedSession {
  config: ReviewConfig;
  verdict: ReturnType<typeof verdictOf>;
}

/** Une revue : sa session, puis son verdict écrit dans son fichier. */
async function review(
  deps: StepDependencies,
  outputs: StepOutputs,
  config: ReviewConfig,
  brief: string,
  pre: string,
  acceptance: readonly string[],
  prior: readonly string[],
): Promise<ReviewOutcome> {
  const prefix = `${pre}review.${config.name}`;
  const session = await play(
    deps,
    outputs,
    prefix,
    'review.json',
    config,
    ['--json-schema', verdictSchema()],
    brief,
  );
  const verdict = sessionSucceeded(session)
    ? verdictOf(session.measure.structuredOutput, acceptance, prior, deps.readSource)
    : invalid('la session n’a pas abouti');
  deps.writeFile(join(outputs.retained, `${prefix}.verdict.json`), json(verdict.file));
  return { config, verdict, ...session };
}

/**
 * Les sessions d'une phase, au plus `parallel` en même temps, démarrées dans l'ordre du fichier dès qu'une place se
 * libère. Toutes sont attendues, quoi qu'il arrive aux autres ; l'échec rendu est celui de la première en échec, dans
 * l'ordre du fichier.
 */
async function playBounded<Config, Outcome>(
  configs: readonly Config[],
  parallel: number,
  session: (config: Config, index: number) => Promise<Outcome>,
): Promise<Outcome[]> {
  // Les places prises : chacune se libère quand sa session a fini, qu'elle ait abouti ou non.
  const places = new Set<Promise<unknown>>();
  const started: Promise<PromiseSettledResult<Outcome>>[] = [];
  for (const [index, config] of configs.entries()) {
    if (places.size >= parallel) await Promise.race(places);
    const ended = Promise.allSettled([session(config, index)]).then(
      ([outcome]) => outcome as PromiseSettledResult<Outcome>,
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

interface ScoutOutcome extends PlayedSession {
  config: ScoutConfig;
  /** Le flux a abouti et le processus s'est terminé normalement avec le code 0. */
  completed: boolean;
  verified: Fact[];
  rejected: number;
  open: number;
}

/**
 * Un éclaireur : sa session, puis ses faits, que l'hôte vérifie en lisant les fichiers. Une session qui n'a pas abouti,
 * arrêtée à sa limite, sans sortie structurée ou à la sortie refusée par le schéma ne donne aucun fait.
 */
async function scout(
  deps: StepDependencies,
  outputs: StepOutputs,
  config: ScoutConfig,
  question: string,
): Promise<ScoutOutcome> {
  const prefix = `scout.${config.name}`;
  const session = await play(
    deps,
    outputs,
    prefix,
    'scout.json',
    config,
    ['--json-schema', factsJsonSchema()],
    question,
  );
  const completed = sessionSucceeded(session);
  const none = { config, ...session, completed, verified: [], rejected: 0, open: 0 };
  const writeInvalid = (why: string): ScoutOutcome => {
    deps.writeFile(join(outputs.retained, `${prefix}.facts.json`), json({ invalid: why }));
    return none;
  };
  if (!completed) return writeInvalid('la session n’a pas abouti');
  if (session.measure.structuredOutput === undefined) {
    return writeInvalid('la session n’a donné aucune sortie structurée');
  }
  const parsed = factsSchemaResult(session.measure.structuredOutput);
  if (typeof parsed === 'string') return writeInvalid(parsed);
  const { verified, rejected } = verifyFacts(parsed.facts, deps.readSource);
  deps.writeFile(
    join(outputs.retained, `${prefix}.facts.json`),
    json({ verified, rejected, open: parsed.open }),
  );
  return {
    config,
    ...session,
    completed,
    verified,
    rejected: rejected.length,
    open: parsed.open.length,
  };
}

/** Les faits de la sortie structurée, ou ce que le schéma en refuse. */
function factsSchemaResult(output: unknown): ReturnType<typeof parseFacts> | string {
  try {
    return parseFacts(output);
  } catch (error) {
    return issues(error as z.ZodError);
  }
}

/** Le verdict de la revue, ou ce qui l'invalide. */
function verdictOf(
  output: unknown,
  acceptance: readonly string[],
  prior: readonly string[],
  read: (path: string) => string | undefined,
): {
  file: unknown;
  verdict: 'accept' | 'request_changes' | 'invalid';
  blocks: boolean;
  findings: number;
  criteria: { id: string; status: 'met' | 'unmet' | 'not_established' }[];
} {
  if (output === undefined) return invalid('la session n’a donné aucune sortie structurée');
  let verdict: ReturnType<typeof parseReviewVerdict>;
  try {
    verdict = parseReviewVerdict(output);
  } catch (error) {
    return invalid(issues(error as z.ZodError));
  }
  // Un verdict qui ne rend pas exactement les critères de l'étape, ou qui cite une preuve absente, est invalide.
  const refused = criteriaRefusal(verdict, acceptance, read);
  if (refused !== undefined) return invalid(refused);
  // Après une promotion sur un verdict qui bloquait, il statue sur chaque constat de la passe d'avant (R5).
  const defect = priorFindingsDefect(verdict, prior);
  if (defect !== undefined) return invalid(defect);
  return {
    file: verdict,
    verdict: verdict.verdict,
    blocks: blocks(verdict),
    findings: verdict.findings.length,
    criteria: verdict.criteria.map(({ id, status }) => ({ id, status })),
  };
}
// Une déclaration, et non une fonction fléchée au niveau du module : un mutant statique rejoue toute la suite.
function invalid(why: string) {
  return { file: { invalid: why }, verdict: 'invalid' as const, blocks: true, findings: 0, criteria: [] };
}

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

/** Le brief de la construction : celui de l'étape, puis les faits vérifiés des éclaireurs, s'il y en a. */
const buildBrief = (brief: string, verified: readonly Fact[]): string =>
  verified.length === 0 ? brief : `${brief.trimEnd()}\n\n${renderFacts(verified)}`;

/** Ce qu'une session laisse à l'enregistrement : ses mesures, et ni son rapport ni sa sortie. */
function recorded(
  role: RecordedSession['role'],
  config: RecordedSession['config'],
  { measure: { completed, durationSeconds, costUsd, costByModel }, exitCode, stopped }: PlayedSession,
  name?: string,
): RecordedSession {
  return { role, name, config, completed, exitCode, stopped, durationSeconds, costUsd, costByModel };
}

/**
 * Les fichiers du lanceur dont l'étape dépend, par chemin relatif à `packages/sandbox` : le fichier de chaque outil
 * qu'elle emploie, avec le prompt et le profil qu'il nomme. Lus ici, avant toute session.
 */
export function launcherFiles(
  readLauncher: StepDependencies['readLauncher'],
  step: StepFile,
): Record<string, string> {
  const plans = passPlans(step);
  const tools: ToolFile[] = [
    'code.json',
    ...(plans.some(({ reviews }) => reviews.length > 0) ? (['review.json'] as const) : []),
    ...(step.scouts.length > 0 ? (['scout.json'] as const) : []),
  ];
  const files = new Map<string, string>();
  for (const toolFile of tools) {
    const text = readLauncher(toolFile);
    files.set(toolFile, text);
    const tool = parseTool(JSON.parse(text));
    for (const file of [tool.launcherPromptFile, `profiles/${tool.profile}.json`]) {
      files.set(file, readLauncher(file));
    }
  }
  // La table entre dans l'admission avec le lanceur : Step refait la route depuis cette copie gelée.
  if (step.routing) files.set('routing.json', readLauncher('routing.json'));
  if (plans.some(({ build }) => build.provider === 'openai')) {
    for (const asset of ['sbx/isolation.json', 'sbx/codex-guest.py']) files.set(asset, readLauncher(asset));
  }
  // Les contrôles tournent sous le profil `checker`, qu'aucun fichier d'outil ne nomme.
  const checker = 'profiles/checker.json';
  if (step.checks.length > 0) files.set(checker, readLauncher(checker));
  return Object.fromEntries([...files.keys()].sort().map((file) => [file, files.get(file) as string]));
}

/** Une passe à jouer : sa bande (étape routée), sa construction, ses revues, et si sa revue attend. */
interface PassPlan {
  band?: number;
  build: StepFile['build'];
  reviews: ReviewConfig[];
  waiting: boolean;
}

interface PassOutcome {
  plan: PassPlan;
  build: BuildOutcome;
  played: CheckReport[];
  outcomes: ReviewOutcome[];
  signal: PassSignal;
}

/**
 * Les passes d'une étape : une seule sans route, celle du fichier ; avec une route, une par barreau de l'échelle, chacune
 * avec sa revue indépendante, ou l'attente de cette revue.
 */
function passPlans(step: StepFile): PassPlan[] {
  if (!step.routing) return [{ build: step.build, reviews: step.reviews, waiting: false }];
  return step.routing.ladder.map(({ band, build, review }) => ({
    band,
    build,
    reviews: review.waiting
      ? []
      : [
          {
            name: 'independent',
            provider: review.provider,
            dimension: 'correctness' as const,
            model: review.model,
            effort: review.effort,
            limitSeconds: review.limitSeconds,
          },
        ],
    waiting: review.waiting,
  }));
}

/**
 * Les constats que la passe d'avant donne à la suivante. Une passe n'a de revue jouée que si sa construction et ses
 * contrôles ont passé ; elle n'est promue avec une revue que sur `changes_requested`, donc sur un verdict valide qui
 * bloque, le seul de sa passe (une passe routée a une revue). Sans passe d'avant, aucun.
 */
function previousFindings(previous: PassOutcome | undefined): ReviewVerdict['findings'] {
  return previous?.outcomes.flatMap(({ verdict }) => (verdict.file as ReviewVerdict).findings) ?? [];
}

/**
 * Une passe : la construction sur son brief, les contrôles un à un tant qu'ils passent, puis les revues sur le brief de
 * l'étape et les contrôles, sauf si la revue attend. Les fichiers d'une passe après la première portent `pass-<n>.`.
 */
async function playPass(
  deps: StepDependencies,
  outputs: StepOutputs,
  step: StepFile,
  plan: PassPlan,
  pre: string,
  passBrief: string,
  brief: string,
  context: { systemPrompt: string; worktree: string; maxBytes: number },
  prior: ReviewVerdict['findings'],
): Promise<PassOutcome> {
  deps.writeFile(join(outputs.retained, `${pre}build.brief.md`), passBrief);
  const stream = join(outputs.streams, `${pre}build.stream.jsonl`);
  deps.writeFile(stream, '');
  const build = await deps.builder.build({
    config: plan.build,
    ...context,
    brief: passBrief,
    onOutput: (chunk) => deps.appendFile(stream, chunk),
  });
  if (build.provider !== (plan.build.provider ?? 'anthropic')) throw Error('BUILDER_PROVIDER');
  const { report, structuredOutput: _structured, ...metrics } = build.measure;
  deps.writeFile(
    join(outputs.retained, `${pre}build.measure.json`),
    json({
      ...metrics,
      costUsd: build.provider === 'openai' ? null : metrics.costUsd,
      exitCode: build.exitCode,
      stopped: build.stopped,
    }),
  );
  deps.writeFile(join(outputs.retained, `${pre}build.report.md`), report);
  const built = sessionSucceeded(build);
  // Les contrôles, l'un après l'autre ; le premier qui ne passe pas met fin à la phase.
  const played: CheckReport[] = [];
  if (built) {
    for (const config of step.checks) {
      const checked = await playCheck(deps, outputs, config, pre);
      played.push(checked);
      if (!passed(checked)) break;
    }
  }
  const checked = played.every(passed);
  // Le brief de l'étape, puis les critères que le verdict couvre (R2), les contrôles joués, et après une promotion sur
  // un verdict qui bloquait, les constats de la passe d'avant sur lesquels la revue statue (R5).
  const previous = renderPriorFindings(prior, outputBound());
  const appended = [
    ...(step.acceptance ? [renderAcceptance(step.acceptance)] : []),
    ...(played.length > 0 ? [renderChecks(played, outputBound())] : []),
    ...(prior.length > 0 ? [previous.text] : []),
  ];
  const forReviews = appended.length === 0 ? brief : `${brief.trimEnd()}\n\n${appended.join('\n')}`;
  const reviewing = built && checked && !plan.waiting;
  if (reviewing) deps.writeFile(join(outputs.retained, `${pre}review.brief.md`), forReviews);
  const outcomes = reviewing
    ? await playBounded(plan.reviews, step.parallel, (config) =>
        review(deps, outputs, config, forReviews, pre, step.acceptance ?? [], previous.ids),
      )
    : [];
  const signal = passSignal({
    built,
    buildStopped: build.stopped,
    checked,
    waiting: plan.waiting,
    verdicts: outcomes.map(({ verdict }) => verdict),
  });
  return { plan, build, played, outcomes, signal };
}

/**
 * La route d'une étape routée, refaite depuis la table gelée du lanceur et les tickets du fichier : un `step.json` qui
 * n'en est pas la copie exacte (modèle, effort, limite, échelle, empreinte de la table) est refusé avant toute session.
 */
function verifyRoute(step: StepFile, launcher: Readonly<Record<string, string>>): void {
  const routing = step.routing;
  if (!routing) return;
  const text = launcher['routing.json']!;
  let expected: StepFile;
  try {
    expected = routedStep(
      {
        routing: { ticket: routing.ticket, providers: routing.providers },
        scouts: step.scouts.map(({ name }) => ({ name })),
        checks: step.checks,
        parallel: step.parallel,
      },
      parseRoutingTable(text),
      text,
      step.tickets,
    );
  } catch (error) {
    // La table gelée ne se lit pas, ou la route ne se dérive plus des tickets du fichier : le refus dit laquelle.
    throw new Refusal(
      `STEP_ROUTING_MISMATCH: ${error instanceof RoutingError ? error.code : 'ROUTING_TABLE_INVALID'}`,
    );
  }
  // Plan ajoute les critères approuvés à côté de la route : ils ne viennent pas de la table, l'admission les lie.
  const approved = parseStepFile({
    ...expected,
    ...(step.acceptance ? { acceptance: step.acceptance } : {}),
  });
  if (JSON.stringify(approved) !== JSON.stringify(step)) throw new Refusal('STEP_ROUTING_MISMATCH');
}

/** Une étape ; son code de sortie : 0, 1 (l'étape ne passe pas) ou 2 (refus, échec de l'outil). */
export async function runStep(deps: StepDependencies): Promise<number> {
  try {
    const { folder, step, raw, brief, questions } = readStep(deps);
    // Avant le nom de l'étape et avant toute session : une étape se lance de la racine de son worktree, ou se refuse.
    const worktree = deps.root();
    // `resolve` : le dossier `/x/demo/.` est le dossier `demo`.
    const name = basename(resolve(folder));
    if (!isStepName(name))
      throw new Refusal(`le nom de l'étape doit suivre ^[a-z][a-z0-9-]{0,31}$ : ${name}`);
    if (deps.steps.exists(name)) throw new Refusal(`l'étape ${name} a déjà un dossier dans steps/`);
    // Pris avant toute session, et les textes lus ici sont ceux que l'hôte publiera : jamais relus à la fin.
    const tree = deps.fingerprint();
    const launcher = launcherFiles(deps.readLauncher, step);
    verifyRoute(step, launcher);
    const startedAt = deps.date();
    const inputs = {
      'brief.md': brief,
      'step.json': raw,
      ...Object.fromEntries(
        step.scouts.map(({ name: scout }, index) => [`scout.${scout}.md`, questions[index] as string]),
      ),
    };
    let admission_sha256: string;
    try {
      admission_sha256 = deps.admit({ name, worktree, tree, inputs, step, launcher });
    } catch {
      throw new Refusal('STEP_ADMISSION_REQUIRED');
    }
    deps.steps.prepare();
    const outputs = deps.reserveOutputs(name, folder, worktree);
    const scoutOutcomes = await playBounded(step.scouts, step.parallel, (config, index) =>
      scout(deps, outputs, config, questions[index] as string),
    );
    const scouts = Object.fromEntries(
      scoutOutcomes.map(({ config, measure, completed, exitCode, verified, rejected, open }) => [
        config.name,
        {
          model: config.model,
          completed,
          exitCode,
          verified: verified.length,
          rejected,
          open,
          costUsd: measure.costUsd,
          costByModel: measure.costByModel,
        },
      ]),
    );
    const forBuild = buildBrief(
      brief,
      scoutOutcomes.flatMap(({ verified }) => verified),
    );
    const definition = parseTool(JSON.parse(launcher['code.json']!));
    const plans = passPlans(step);
    const passes: PassOutcome[] = [];
    for (const [index, plan] of plans.entries()) {
      const previous = passes.at(-1);
      const pre = index === 0 ? '' : `pass-${index + 1}.`;
      const prior = previousFindings(previous);
      const passBrief = previous
        ? `${forBuild.trimEnd()}\n\n${renderPromotion(
            { pass: index, model: previous.plan.build.model, signal: previous.signal },
            previous.played.filter((report) => !passed(report)),
            prior,
            outputBound(),
          )}`
        : forBuild;
      const outcome = await playPass(
        deps,
        outputs,
        step,
        plan,
        pre,
        passBrief,
        brief,
        {
          systemPrompt: launcher[definition.launcherPromptFile]!,
          worktree,
          maxBytes: definition.authProxy.policy.maxBodyBytes,
        },
        prior,
      );
      passes.push(outcome);
      // Une étape sans route n'a qu'une passe ; une étape routée monte d'une bande sur un signal objectif seulement.
      if (!promotes(outcome.signal)) break;
    }
    const last = passes.at(-1)!;
    const { build, played, outcomes } = last;
    const routed = step.routing !== undefined;
    const checks = Object.fromEntries(
      played.map((report) => [
        report.name,
        {
          exitCode: report.exitCode,
          stopped: report.stopped,
          durationSeconds: report.durationSeconds,
          passed: passed(report),
        },
      ]),
    );
    const reviews = Object.fromEntries(
      outcomes.map(({ config, verdict, exitCode, measure }) => [
        config.name,
        {
          model: config.model,
          verdict: verdict.verdict,
          exitCode,
          blocks: verdict.blocks,
          findings: verdict.findings,
          costUsd: measure.costUsd,
          costByModel: measure.costByModel,
        },
      ]),
    );
    const measures = [
      ...scoutOutcomes.map(({ measure }) => measure),
      ...passes.flatMap((pass) => [pass.build.measure, ...pass.outcomes.map(({ measure }) => measure)]),
    ];
    const numbered = <Entry extends object>(entry: Entry, index: number) =>
      routed ? { ...entry, pass: index + 1 } : entry;
    const record = buildRecord({
      step: name,
      admission_sha256,
      startedAt,
      tree,
      inputs,
      tickets: step.tickets,
      ...(step.routing
        ? {
            routing: {
              ticket: step.routing.ticket,
              points: step.routing.points,
              table_sha256: step.routing.table_sha256,
              start: step.routing.start,
              passes: passes.map(({ signal }, index) => {
                const { band, build } = step.routing!.ladder[index]!;
                return {
                  pass: index + 1,
                  band,
                  provider: build.provider,
                  model: build.model,
                  effort: build.effort,
                  signal,
                };
              }),
            },
          }
        : {}),
      launcher,
      sessions: [
        ...scoutOutcomes.map((scout) => recorded('scout', scout.config, scout, scout.config.name)),
        ...passes.flatMap(({ plan, build: played, outcomes: done }, index) => [
          numbered(
            {
              ...recorded('build', plan.build, played),
              provider: played.provider,
              ...(played.provider === 'openai'
                ? {
                    client: played.client,
                    usage: {
                      inputTokens: observedTokens(played.receipts, 'inputTokens'),
                      outputTokens: observedTokens(played.receipts, 'outputTokens'),
                    },
                    responses: played.receipts,
                  }
                : {}),
            },
            index,
          ),
          ...done.map((review) =>
            numbered(recorded('review', review.config, review, review.config.name), index),
          ),
        ]),
      ],
      checks: passes.flatMap(({ played: reports }, index) =>
        reports.map((report) =>
          numbered(
            {
              name: report.name,
              passed: passed(report),
              stopped: report.stopped,
              durationSeconds: report.durationSeconds,
            },
            index,
          ),
        ),
      ),
      reviews: passes.flatMap(({ outcomes: done }, index) =>
        done.map(({ config, verdict }) =>
          numbered(
            {
              name: config.name,
              verdict: verdict.verdict,
              findings: verdict.findings,
              ...(verdict.criteria.length > 0 ? { criteria: verdict.criteria } : {}),
            },
            index,
          ),
        ),
      ),
      outcome: stepOutcome(last.signal),
    });
    // Relu par son propre schéma : ce que la porte refuserait n'entre pas dans le worktree.
    deps.steps.publish(name, { ...inputs, 'record.json': json(stepRecordSchema().parse(record)) });
    const summary = {
      outcome: record.outcome,
      scouts,
      build: {
        completed: build.measure.completed,
        exitCode: build.exitCode,
        stopped: build.stopped,
        answers: build.measure.answers,
        turns: build.measure.turns,
        durationSeconds: build.measure.durationSeconds,
        costUsd: build.provider === 'openai' ? null : build.measure.costUsd,
        cacheReadPerAnswer: build.measure.cacheReadPerAnswer,
        costByModel: build.measure.costByModel,
      },
      checks,
      reviews,
      ...(record.routing ? { routing: record.routing } : {}),
      costUsd: passes.some((pass) => pass.build.provider === 'openai')
        ? null
        : measures.reduce((sum, measure) => sum + measure.costUsd, 0),
      costByModel: sumByModel(measures.map((measure) => measure.costByModel)),
      record: `steps/${name}/record.json`,
    };
    deps.stdout.write(`${JSON.stringify(summary)}\n`);
    return record.outcome === 'passed' ? 0 : 1;
  } catch (error) {
    if (error instanceof Refusal) {
      deps.stderr.write(`architect-os step: ${error.message}\n`);
      return 2;
    }
    return failureReporter(deps.stderr, 'step')(error);
  } finally {
    deps.dispose?.();
  }
}

/** Une session réelle : l'outil de code sur les flux, `dependencies(tool)` en donnant les dépendances. */
export function codeToolSession(
  dependencies: (tool: ToolFile) => CodeToolDependencies,
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

/**
 * Un contrôle réel, sur un `SandboxRunner` : le profil `checker` dans `cwd`, l'entrée fermée aussitôt, les deux sorties
 * mêlées dans l'ordre d'arrivée et gardées par leur fin (`outputTail`) ; rendu quand le processus a fini et que ses
 * sorties sont closes. La limite borne les deux : elle arrête le groupe et ferme les sorties, qu'un descendant sorti du
 * groupe (sa propre session) tiendrait ouvertes après la fin du processus. Le minuteur est annulé quand tout a fini
 * avant elle.
 */
export function sandboxCheck(
  runner: SandboxRunner,
  cwd: string,
  schedule: (fire: () => void, ms: number) => () => void = timer,
): StepCheck {
  return async (command, limitSeconds) => {
    const sandbox = await runner.start({ profile: 'checker', cwd, command });
    sandbox.stdin.end();
    const tail = outputTail(outputBound());
    sandbox.stdout.on('data', tail.push);
    sandbox.stderr.on('data', tail.push);
    let stopped = false;
    const cancel = schedule(() => {
      stopped = true;
      void sandbox.stop();
      sandbox.stdout.destroy();
      sandbox.stderr.destroy();
    }, limitSeconds * 1000);
    // `exited` peut précéder la fin des tubes : la fin de la sortie est ce qu'on garde. Une sortie fermée par la limite
    // finit en erreur, ce que `allSettled` prend pour une fin.
    const [exit] = await Promise.all([
      sandbox.exited,
      Promise.allSettled([finished(sandbox.stdout), finished(sandbox.stderr)]),
    ]);
    cancel();
    return { exitCode: exit.code, stopped, ...tail.result() };
  };
}

/** Les dépendances de l'outil de code d'un fichier de description, pour le processus. */
export const toolDependencies =
  (proc: CodeProcess) =>
  (tool: ToolFile): CodeToolDependencies =>
    processDependencies(proc, isatty, tool);

/**
 * La lecture d'un fichier du worktree où l'étape tourne : le chemin est résolu depuis `cwd`, et rien n'est lu si le
 * chemin réel du fichier (liens suivis) n'est pas un fichier ordinaire sous le chemin réel de `cwd`.
 */
/**
 * Au plus 1 Mio par fichier cité : un fait d'éclaireur ou une preuve de critère (R2) cite une ligne de code, et un
 * fichier plus grand, que le constructeur a pu écrire, ne coûte pas sa taille à l'hôte à chaque citation.
 */
export const SOURCE_MAX_BYTES = 1_048_576;

const sourceReader =
  (cwd: string) =>
  (path: string): string | undefined => {
    try {
      const real = realpathSync(resolve(cwd, path));
      const stats = statSync(real);
      if (real.startsWith(realpathSync(cwd) + sep) && stats.isFile() && stats.size <= SOURCE_MAX_BYTES)
        return readFileSync(real, 'utf8');
    } catch {
      // Absent, ou illisible pour ce processus : ce n'est pas un fichier du worktree à citer.
    }
    return undefined;
  };

/**
 * Le texte d'un fichier du dossier de l'étape. Ce que l'hôte publie et hache est ce texte : un fichier qui n'est pas de
 * l'UTF-8 valide ne se relirait pas octet pour octet, il est refusé avant toute session. Une marque d'ordre des octets
 * en tête est gardée : elle fait partie du fichier.
 */
function readText(path: string): string {
  const bytes = readFileSync(path);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Refusal(`${basename(path)} n'est pas de l'UTF-8 valide`);
  }
}

/**
 * La racine du worktree lié qui contient `cwd`, si `cwd` en est la racine ; sinon un refus. `resolveWorktree` lève sa
 * `SandboxError` telle quelle quand `cwd` n'est dans aucun worktree lié.
 */
function rootOf(cwd: string): string {
  const { worktree } = resolveWorktree(cwd);
  if (worktree !== realpathSync(resolve(cwd)))
    throw new Refusal(`une étape se lance depuis la racine de son worktree : ${cwd} n'est pas ${worktree}`);
  return worktree;
}

/** Les dépendances réelles : les fichiers du disque, les sessions sous srt, les flux du processus. */
export function stepDependencies(proc: CodeProcess, buildSubscription = buildSbxStep): StepDependencies {
  const cwd = proc.env['INIT_CWD'] ?? proc.cwd();
  const root = (): string => rootOf(cwd);
  const readLauncher = (file: string) => readFileSync(join(PKG, file), 'utf8');
  let snapshot: ReturnType<typeof freezeStepLauncher> | undefined;
  function admittedRoot() {
    if (!snapshot) throw new Refusal('STEP_ADMISSION_REQUIRED');
    return snapshot.dir;
  }
  const launch = codeToolSession((tool) => processDependencies(proc, isatty, tool, admittedRoot()));
  return {
    folderArguments: proc.argv.slice(2),
    readFile: (path) => (existsSync(path) && statSync(path).isFile() ? readText(path) : undefined),
    readSource: sourceReader(cwd),
    reserveOutputs: (name, intake, worktree) => reserveStepOutputs(proc.env, name, intake, worktree),
    writeFile: (path, content) => writeFileSync(path, content, { flag: 'wx', mode: 0o600 }),
    appendFile: (path, content) => {
      const descriptor = openSync(path, constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW);
      try {
        appendFileSync(descriptor, content);
      } finally {
        closeSync(descriptor);
      }
    },
    session: launch,
    builder: {
      build: (request) =>
        request.config.provider === 'openai'
          ? buildSubscription(request, admittedRoot(), PKG, proc.env.ARCHITECT_OS_RUNTIME_ROOT!)
          : new ClaudeBuilder(launch).build(request),
    },
    check: (...args) =>
      sandboxCheck(new SrtSandboxRunner(srtOptions(proc, {}, admittedRoot())), cwd)(...args),
    now: () => Date.now(),
    date: () => new Date(),
    root,
    fingerprint: () => fingerprintTree(root()),
    readLauncher,
    admit: (subject) => {
      const receipt = readStepAdmission(proc.env.ARCHITECT_OS_STEP_EVIDENCE, root());
      const digest = requireStepAdmission(receipt, subject);
      snapshot = freezeStepLauncher(subject.launcher, root());
      return digest;
    },
    dispose: () => snapshot?.dispose(),
    steps: stepsFolder(root),
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}
