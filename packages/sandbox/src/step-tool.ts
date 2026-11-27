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
import { ClaudeBuilder, type Builder, type StepSession, type ToolFile } from './builder.js';
import { measureSession, type SessionMeasure } from './measure.js';
import { claimLine, claimsBlock, parseClaims, renderClaims, type GivenClaim } from './build-claims.js';
import {
  blocks,
  claimsRefusal,
  criteriaRefusal,
  parseReviewVerdict,
  renderAcceptance,
  ReviewVerdictSchema,
} from './review-verdict.js';
import { factsJsonSchema, parseFacts, renderFacts, verifyFacts, type Fact } from './scout-facts.js';
import { SrtSandboxRunner } from './srt-runner.js';
import type { SandboxRunner } from './port.js';
import { outputTail, passed, renderChecks, type CheckOutcome, type CheckReport } from './step-checks.js';
import { parseStepFile, type StepFile } from './step-file.js';
import {
  observedTokens,
  buildRecord,
  isStepName,
  sha256,
  stepRecordSchema,
  type RecordedSession,
} from './step-record.js';
import { fileStepStore } from './step-store-file.js';
import {
  artifactFile,
  StepStoreError,
  type StepArtifactKind,
  type StepRecorder,
  type StepStore,
} from './step-store.js';
import { findCredential } from './credential-shapes.js';
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
  /** Crée un fichier des flux bruts, qui ne sont pas de l'état de l'étape. */
  readonly writeFile: (path: string, content: string) => void;
  readonly appendFile: (path: string, content: Uint8Array) => void;
  /** L'état retenu de l'étape : tout ce qu'elle garde passe par lui (docs/design/orchestration-fable-5-2.md, §15, A). */
  readonly store: StepStore;
  /** Le répertoire des flux bruts d'une étape réservée dans `store`. */
  readonly streams: (name: string) => string;
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
  // Un texte de l'étape qui porte une forme de secret est refusé avant toute session : aucune ne sera payée pour une
  // étape que le port refuserait de garder (docs/design/orchestration-fable-5-2.md, §15, A).
  const texts: [string, string][] = [
    ['step.json', raw],
    ['brief.md', brief],
    ...step.scouts.map(({ name }, index): [string, string] => [
      `scout.${name}.md`,
      questions[index] as string,
    ]),
  ];
  for (const [file, text] of texts) {
    const shape = findCredential(text);
    if (shape !== undefined) throw new Refusal(`STEP_INPUT_CREDENTIAL: ${file} contient la forme ${shape}`);
  }
  return { folder, step, raw, brief, questions };
}

type PlayedSession = Awaited<ReturnType<StepSession>> & { measure: SessionMeasure };

/** Où une étape écrit : son état par le port, ses flux bruts dans leur répertoire. */
interface StepOutputs {
  state: StepRecorder;
  streams: string;
}

/**
 * Garde un artefact par le port. Un artefact que le port refuse (taille, forme de secret, schéma) n'est pas perdu : son
 * texte est écrit, tel quel, dans un fichier privé des flux bruts du run, `<fichier>.refused`, puis le refus remonte et
 * l'étape s'arrête en 2 sans rien publier. Une erreur du système de fichiers n'est pas un refus du port : elle remonte
 * seule.
 */
function retain(
  deps: StepDependencies,
  outputs: StepOutputs,
  kind: StepArtifactKind,
  name: string | undefined,
  text: string,
): void {
  try {
    outputs.state.record(kind, name, text);
  } catch (error) {
    if (error instanceof StepStoreError)
      deps.writeFile(join(outputs.streams, `${artifactFile(kind, name)}.refused`), text);
    throw error;
  }
}

/** Le résultat structuré ne peut servir qu'après la réussite du processus et du flux. */
function sessionSucceeded(session: PlayedSession): boolean {
  return passed(session) && session.measure.completed;
}

/** Joue une session et conserve ses mesures avec l'issue observée par le lanceur. */
async function play(
  deps: StepDependencies,
  outputs: StepOutputs,
  session: { role: 'scout' | 'review'; name: string },
  tool: ToolFile,
  config: StepSessionConfig,
  extra: readonly string[],
  brief: string,
): Promise<PlayedSession> {
  const streamFile = join(outputs.streams, `${session.role}.${session.name}.stream.jsonl`);
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
  retain(deps, outputs, `${session.role}.measure`, session.name, json({ ...measure, exitCode, stopped }));
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
): Promise<CheckReport> {
  const before = deps.now();
  const outcome = await deps.check(config.command, config.limitSeconds);
  const durationSeconds = Math.round((deps.now() - before) / 1000);
  const { exitCode, stopped, cut, output } = outcome;
  retain(
    deps,
    outputs,
    'check',
    config.name,
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
  expected: Expected,
): Promise<ReviewOutcome> {
  const session = await play(
    deps,
    outputs,
    { role: 'review', name: config.name },
    'review.json',
    config,
    ['--json-schema', verdictSchema()],
    brief,
  );
  const verdict = sessionSucceeded(session)
    ? verdictOf(session.measure.structuredOutput, expected, deps.readSource)
    : invalid('la session n’a pas abouti');
  retain(deps, outputs, 'review.verdict', config.name, json(verdict.file));
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
  const session = await play(
    deps,
    outputs,
    { role: 'scout', name: config.name },
    'scout.json',
    config,
    ['--json-schema', factsJsonSchema()],
    question,
  );
  const completed = sessionSucceeded(session);
  const none = { config, ...session, completed, verified: [], rejected: 0, open: 0 };
  const writeInvalid = (why: string): ScoutOutcome => {
    retain(deps, outputs, 'scout.facts', config.name, json({ invalid: why }));
    return none;
  };
  if (!completed) return writeInvalid('la session n’a pas abouti');
  if (session.measure.structuredOutput === undefined) {
    return writeInvalid('la session n’a donné aucune sortie structurée');
  }
  const parsed = factsSchemaResult(session.measure.structuredOutput);
  if (typeof parsed === 'string') return writeInvalid(parsed);
  const { verified, rejected } = verifyFacts(parsed.facts, deps.readSource);
  retain(deps, outputs, 'scout.facts', config.name, json({ verified, rejected, open: parsed.open }));
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

/** Ce que chaque verdict doit couvrir : les critères de l'étape, et les écarts que la construction a déclarés. */
interface Expected {
  readonly acceptance: readonly string[];
  readonly claims: readonly string[];
}

/** Le verdict de la revue, ou ce qui l'invalide. */
function verdictOf(
  output: unknown,
  expected: Expected,
  read: (path: string) => string | undefined,
): {
  file: unknown;
  verdict: 'accept' | 'request_changes' | 'invalid';
  blocks: boolean;
  findings: number;
  criteria: { id: string; status: 'met' | 'unmet' | 'not_established' }[];
  claims: { id: string; status: 'verified' | 'refuted' | 'not_checked' }[];
} {
  if (output === undefined) return invalid('la session n’a donné aucune sortie structurée');
  let verdict: ReturnType<typeof parseReviewVerdict>;
  try {
    verdict = parseReviewVerdict(output);
  } catch (error) {
    return invalid(issues(error as z.ZodError));
  }
  // Un verdict qui ne rend pas exactement les critères de l'étape, ou qui cite une preuve absente, est invalide.
  const refused =
    criteriaRefusal(verdict, expected.acceptance, read) ?? claimsRefusal(verdict, expected.claims, read);
  if (refused !== undefined) return invalid(refused);
  return {
    file: verdict,
    verdict: verdict.verdict,
    blocks: blocks(verdict),
    findings: verdict.findings.length,
    criteria: verdict.criteria.map(({ id, status }) => ({ id, status })),
    claims: verdict.claims.map(({ id, status }) => ({ id, status })),
  };
}
// Une déclaration, et non une fonction fléchée au niveau du module : un mutant statique rejoue toute la suite.
function invalid(why: string) {
  return {
    file: { invalid: why },
    verdict: 'invalid' as const,
    blocks: true,
    findings: 0,
    criteria: [],
    claims: [],
  };
}

/** Les écarts déclarés dans le rapport de la construction : aucun bloc, un bloc refusé, ou les revendications validées. */
type Claims =
  { state: 'absent' } | { state: 'invalid'; reason: string } | { state: 'valid'; claims: GivenClaim[] };

function claimsOf(report: string): Claims {
  const block = claimsBlock(report);
  if (block.state !== 'found') return block;
  try {
    return { state: 'valid', claims: parseClaims(block.raw) };
  } catch (error) {
    return { state: 'invalid', reason: issues(error as z.ZodError) };
  }
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
  const tools: ToolFile[] = [
    'code.json',
    ...(step.reviews.length > 0 ? (['review.json'] as const) : []),
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
  if (step.build.provider === 'openai') {
    for (const asset of ['sbx/isolation.json', 'sbx/codex-guest.py']) files.set(asset, readLauncher(asset));
  }
  // Les contrôles tournent sous le profil `checker`, qu'aucun fichier d'outil ne nomme.
  const checker = 'profiles/checker.json';
  if (step.checks.length > 0) files.set(checker, readLauncher(checker));
  return Object.fromEntries([...files.keys()].sort().map((file) => [file, files.get(file) as string]));
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
    const state = deps.store.reserve(name, { intake: folder, worktree });
    const outputs: StepOutputs = { state, streams: deps.streams(name) };
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
    retain(deps, outputs, 'build.brief', undefined, forBuild);
    const definition = parseTool(JSON.parse(launcher['code.json']!));
    const stream = join(outputs.streams, 'build.stream.jsonl');
    deps.writeFile(stream, '');
    const build = await deps.builder.build({
      config: step.build,
      systemPrompt: launcher[definition.launcherPromptFile]!,
      worktree,
      brief: forBuild,
      maxBytes: definition.authProxy.policy.maxBodyBytes,
      onOutput: (chunk) => deps.appendFile(stream, chunk),
    });
    if (build.provider !== (step.build.provider ?? 'anthropic')) throw Error('BUILDER_PROVIDER');
    const { report, structuredOutput: _structured, ...metrics } = build.measure;
    retain(
      deps,
      outputs,
      'build.measure',
      undefined,
      json({
        ...metrics,
        costUsd: build.provider === 'openai' ? null : metrics.costUsd,
        exitCode: build.exitCode,
        stopped: build.stopped,
      }),
    );
    retain(deps, outputs, 'build.report', undefined, report);
    const built = sessionSucceeded(build);
    // Le rapport d'une session qui n'a pas abouti ne donne rien ; un bloc invalide ne donne aucune revendication.
    const claims: Claims = built ? claimsOf(report) : { state: 'absent' };
    if (claims.state !== 'absent')
      retain(
        deps,
        outputs,
        'build.claims',
        undefined,
        json(claims.state === 'invalid' ? { invalid: claims.reason } : { claims: claims.claims }),
      );
    const given = claims.state === 'valid' ? claims.claims : [];
    // Des écarts déclarés qu'aucune revue ne vérifierait : l'étape ne passe pas, et le dit.
    const unreviewed = given.length > 0 && step.reviews.length === 0;
    // Les contrôles, l'un après l'autre ; le premier qui ne passe pas met fin à la phase.
    const played: CheckReport[] = [];
    if (built) {
      for (const config of step.checks) {
        const report = await playCheck(deps, outputs, config);
        played.push(report);
        if (!passed(report)) break;
      }
    }
    const checked = played.every(passed);
    const appended = [
      ...(step.acceptance ? [renderAcceptance(step.acceptance)] : []),
      ...(given.length > 0 ? [renderClaims(given)] : []),
      ...(played.length > 0 ? [renderChecks(played, outputBound())] : []),
    ];
    const forReviews = appended.length === 0 ? brief : `${brief.trimEnd()}\n\n${appended.join('\n')}`;
    if (built && checked) retain(deps, outputs, 'review.brief', undefined, forReviews);
    const outcomes =
      built && checked
        ? await playBounded(step.reviews, step.parallel, (config) =>
            review(deps, outputs, config, forReviews, {
              acceptance: step.acceptance ?? [],
              claims: given.map(({ id }) => id),
            }),
          )
        : [];
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
      build.measure,
      ...outcomes.map(({ measure }) => measure),
    ];
    const record = buildRecord({
      step: name,
      admission_sha256,
      startedAt,
      tree,
      inputs,
      tickets: step.tickets,
      // Ni le texte ni la raison d'un refus : l'identifiant de chaque revendication et l'empreinte de la ligne citée.
      ...(claims.state === 'absent'
        ? {}
        : {
            claims: {
              valid: claims.state === 'valid',
              given: given.map((claim) => ({ id: claim.id, sha256: sha256(claimLine(claim)) })),
            },
          }),
      launcher,
      sessions: [
        ...scoutOutcomes.map((scout) => recorded('scout', scout.config, scout, scout.config.name)),
        {
          ...recorded('build', step.build, build),
          provider: build.provider,
          ...(build.provider === 'openai'
            ? {
                client: build.client,
                usage: {
                  inputTokens: observedTokens(build.receipts, 'inputTokens'),
                  outputTokens: observedTokens(build.receipts, 'outputTokens'),
                },
                responses: build.receipts,
              }
            : {}),
        },
        ...outcomes.map((review) => recorded('review', review.config, review, review.config.name)),
      ],
      checks: played.map((report) => ({
        name: report.name,
        passed: passed(report),
        stopped: report.stopped,
        durationSeconds: report.durationSeconds,
      })),
      reviews: outcomes.map(({ config, verdict }) => ({
        name: config.name,
        verdict: verdict.verdict,
        findings: verdict.findings,
        ...(verdict.criteria.length > 0 ? { criteria: verdict.criteria } : {}),
        ...(verdict.claims.length > 0 ? { claims: verdict.claims } : {}),
      })),
      outcome:
        built && checked && !unreviewed && !outcomes.some(({ verdict }) => verdict.blocks)
          ? 'passed'
          : 'refused',
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
      costUsd:
        build.provider === 'openai' ? null : measures.reduce((sum, measure) => sum + measure.costUsd, 0),
      costByModel: sumByModel(measures.map((measure) => measure.costByModel)),
      record: `steps/${name}/record.json`,
      ...(unreviewed ? { refusal: 'STEP_CLAIMS_UNREVIEWED' } : {}),
    };
    if (unreviewed) deps.stderr.write('architect-os step: STEP_CLAIMS_UNREVIEWED\n');
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
  const store = fileStepStore(proc.env);
  return {
    folderArguments: proc.argv.slice(2),
    readFile: (path) => (existsSync(path) && statSync(path).isFile() ? readText(path) : undefined),
    readSource: sourceReader(cwd),
    store,
    streams: (name) => store.streams(name),
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
