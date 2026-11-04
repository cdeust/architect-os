import { label, type MutantRecord, type MutationReport } from './mutation.js';
import type { CucumberRun } from './run.js';
import type { ReadFailure, Violation } from './violation.js';

// Rule 7, second half: the verdicts of the mutation tool are not trusted, they are replayed. `test-gate replay` puts
// each mutant in the tree itself, runs the scenarios the tool named with cucumber-js directly (none of the tool's
// runner or instrumentation), and compares. A detection also needs a control run: the same scenarios pass cleanly on
// the original, so a broken test command (it fails on the original and the mutant alike) never confirms one.

/** What the replay expects of a mutant, from the status the tool gave it. */
export interface Expectation {
  /**
   * true: its scenarios pass cleanly on it. false, it is detected: they pass cleanly on the original (the control)
   * and not on it, whatever the way (a failed step, a crash that leaves no report, a run past its limit).
   */
  readonly survives: boolean;
}

const DETECTED: Expectation = { survives: false };
const SURVIVES: Expectation = { survives: true };

/**
 * Killed, Timeout and RuntimeError are all detections (Stryker's cucumber runner reports a step that throws anything
 * but an assertion as RuntimeError); Survived and Ignored (a claim of equivalence) survive.
 */
const EXPECTATIONS: ReadonlyMap<string, Expectation> = new Map([
  ['Killed', DETECTED],
  ['RuntimeError', DETECTED],
  ['Timeout', DETECTED],
  ['Survived', SURVIVES],
  ['Ignored', SURVIVES],
]);

/** The expectation of a status, undefined for one the replay does not check. */
export function expectationOf(status: string): Expectation | undefined {
  return EXPECTATIONS.get(status);
}

/** The statuses the replay checks. NoCoverage names no scenario; CompileError and Pending are red (rule 5). */
export function replayable(status: string): boolean {
  return EXPECTATIONS.has(status);
}

export interface ReplayCase {
  readonly file: string;
  readonly mutant: MutantRecord;
  readonly expectation: Expectation;
  /** `<feature>:<line>`, distinct. */
  readonly tests: readonly string[];
  /**
   * Of a Killed mutant, the scenarios replayed when its named killers pass: the tool names the first killer it saw,
   * which may pass in a fresh process while another covering scenario kills. Empty for any other status.
   */
  readonly fallback: readonly string[];
  /** The file as the report carries it, and with the mutant applied. */
  readonly source: string;
  readonly mutated: string;
  /** Why the case cannot be replayed (an unknown test id, no scenario), or null. */
  readonly problem: string | null;
}

/** Offset in `source` of a report position (line and column from one). */
function offsetOf(source: string, line: number, column: number): number {
  const lines = source.split('\n');
  return lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) + column - 1;
}

/** The file with the mutant applied: the text between start and end (exclusive) replaced. */
export function mutatedSource(source: string, mutant: MutantRecord): string {
  const start = offsetOf(source, mutant.startLine, mutant.startColumn);
  const end = offsetOf(source, mutant.endLine, mutant.endColumn);
  return `${source.slice(0, start)}${mutant.replacement}${source.slice(end)}`;
}

/**
 * The scenarios the tool ran for a mutant: the covering ones, or all of them for a static mutant (the tool runs them
 * all) and for an Ignored one (it runs none: the claim of equivalence is checked against the whole suite).
 */
function coveringIds(mutant: MutantRecord, all: readonly string[]): readonly string[] {
  return mutant.status === 'Ignored' || mutant.static ? all : mutant.coveredBy;
}

/** The replay cases of the selected mutants of a report whose status is replayable, in report order. */
export function replayCases(
  report: MutationReport,
  selected: (file: string, mutant: MutantRecord) => boolean,
): ReplayCase[] {
  const cases: ReplayCase[] = [];
  const locations = (ids: readonly string[]) => [...new Set(ids.map((id) => report.tests.get(id) as string))];
  for (const [file, { source, mutants }] of report.files) {
    for (const mutant of mutants) {
      const expectation = expectationOf(mutant.status);
      if (expectation === undefined || !selected(file, mutant)) continue;
      const covering = coveringIds(mutant, [...report.tests.keys()]);
      const killed = mutant.status === 'Killed';
      const ids = killed ? mutant.killedBy : covering;
      const fallback = killed ? covering : [];
      // With an unknown id the case has a problem and is never run: its scenarios are not read.
      const unknown = [...new Set([...ids, ...fallback])].filter((id) => !report.tests.has(id));
      const tests = locations(ids);
      const problem =
        unknown.length > 0
          ? `test(s) inconnu(s) du rapport : ${unknown.join(', ')}`
          : tests.length === 0
            ? `${mutant.status} sans scénario nommé par l'outil`
            : null;
      cases.push({
        file,
        mutant,
        expectation,
        tests,
        fallback: locations(fallback),
        source,
        mutated: mutatedSource(source, mutant),
        problem,
      });
    }
  }
  return cases;
}

/** One cucumber-js run of a replay. */
export interface RunResult {
  readonly run: CucumberRun | ReadFailure;
  /** The run was stopped at its time limit. */
  readonly timedOut: boolean;
}

const PASSED = 'PASSED';
const FAILED = 'FAILED';

/**
 * Why a run of `expected` scenarios is not a clean pass, or null when it is one: every scenario ran once, every
 * step and run hook PASSED, before its limit. `failed`: the run is complete and every scenario that did not pass has
 * a FAILED step, an assertion or a throw; `broken`: anything else (a limit, no report, a missing scenario, a hook, an
 * undefined step), which a broken environment produces as well as a mutant.
 */
function unclean(
  result: RunResult,
  expected: number,
): { readonly failed: boolean; readonly why: string } | null {
  const broken = (why: string) => ({ failed: false, why });
  if (result.timedOut) return broken('délai dépassé');
  if ('failure' in result.run) return broken(result.run.failure);
  const hook = result.run.runHooks.find((h) => h.status !== PASSED);
  if (hook !== undefined) return broken(`${hook.name} : ${hook.status}`);
  const failing: string[] = [];
  let failed = true;
  for (const pickle of result.run.pickles) {
    if (pickle.attempts.length !== 1) return broken(`${pickle.id} : ${pickle.attempts.length} tentatives`);
    const step = pickle.attempts.flatMap((attempt) => attempt.steps).find((s) => s.status !== PASSED);
    if (step === undefined) continue;
    failing.push(`${pickle.id} : ${step.status}`);
    failed &&= step.status === FAILED;
  }
  const ran = result.run.pickles.length;
  if (ran !== expected) return broken(`${ran} scénario(s) exécuté(s) sur ${expected}`);
  return failing.length === 0 ? null : { failed, why: failing.join(', ') };
}

/** The judgement of one replay. */
export interface Judgement {
  /** null: the replay confirms the tool. */
  readonly divergence: string | null;
  /** A detection whose control passed and whose scenarios all passed cleanly on the mutant: the fallback decides. */
  readonly retry: boolean;
  /**
   * A detection confirmed by a broken run rather than a FAILED step: it stands only if a fresh control, run right
   * after, passes cleanly (recheckDivergence), so a broken environment never confirms a mutant.
   */
  readonly recheck: boolean;
}

/**
 * The replay of a case without `problem` over `scenarios` scenarios: `control` is the run on the original, null for a
 * survivor, which needs none.
 */
export function judgeReplay(
  replay: ReplayCase,
  scenarios: number,
  control: RunResult | null,
  mutant: RunResult,
): Judgement {
  const status = replay.mutant.status;
  const verdict = (divergence: string | null, retry = false, recheck = false) => ({
    divergence,
    retry,
    recheck,
  });
  if (control !== null) {
    const original = unclean(control, scenarios);
    if (original !== null) return verdict(`témoin : ${original.why}`);
  }
  const run = unclean(mutant, scenarios);
  if (replay.expectation.survives) {
    return verdict(run === null ? null : `${status} selon l'outil, mais sur le mutant : ${run.why}`);
  }
  if (run === null) return verdict(`${status} selon l'outil, les scénarios passent sur le mutant`, true);
  return verdict(null, false, !run.failed);
}

/** The divergence a fresh control run after a broken detection makes, or null when it passes cleanly. */
export function recheckDivergence(fresh: RunResult, scenarios: number): string | null {
  const why = unclean(fresh, scenarios)?.why;
  return why === undefined ? null : `témoin après coup : ${why}`;
}

/** One line of the replay record. */
export interface ReplayEntry {
  readonly file: string;
  readonly id: string;
  readonly status: string;
  /** null: the replay confirms the tool. */
  readonly divergence: string | null;
}

/** reports/mutation/replay.json: bound to the mutation report it replays by the SHA-256 of its text. */
export interface ReplayRecord {
  readonly report: string;
  readonly mutants: readonly ReplayEntry[];
}

/**
 * Rule 7 on the replay record: every `required` mutant whose status is replayable was replayed against this very
 * report, and the replay confirmed it. `record` is null when the file is absent.
 */
export function replayViolations(
  required: readonly { readonly file: string; readonly mutant: MutantRecord }[],
  record: ReplayRecord | ReadFailure | null,
  reportHash: string,
): Violation[] {
  const due = required.filter(({ mutant }) => replayable(mutant.status));
  if (due.length === 0) return [];
  const add = (text: string): Violation => ({ rule: 7, text });
  if (record === null) return [add('rejeu des verdicts absent')];
  if ('failure' in record) return [add(`rejeu des verdicts illisible : ${record.failure}`)];
  if (record.report !== reportHash) return [add('le rejeu porte sur un autre rapport de mutation')];
  const entries = new Map(record.mutants.map((entry) => [`${entry.file} ${entry.id}`, entry]));
  const violations: Violation[] = [];
  for (const { file, mutant } of due) {
    const entry = entries.get(`${file} ${mutant.id}`);
    if (entry === undefined) violations.push(add(`${label(file, mutant)} : non rejoué`));
    else if (entry.divergence !== null) violations.push(add(`${label(file, mutant)} : ${entry.divergence}`));
  }
  return violations;
}
