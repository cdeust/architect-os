import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, extname, join, normalize } from 'node:path';
import {
  judgeReplay,
  recheckDivergence,
  type ReplayCase,
  type ReplayEntry,
  type RunResult,
} from '../domain/replay.js';
import { parseCucumberReport } from './cucumber-report.js';
import type { Workspace } from './workspace.js';

const CUCUMBER = new URL('./replay-cucumber' + extname(fileURLToPath(import.meta.url)), import.meta.url).href;
const SELECTION_PREFIX = 'AOS_REPLAY_SELECTION: ';
const EXECUTION_PREFIX = 'AOS_REPLAY_EXECUTION: ';

/** The signal of a run stopped at its limit, and of its group once it is gone; nothing else sends it. */
const KILL = 'SIGKILL';

// A direct Cucumber fixture with the same witness measured higher discovery cost at 2 scenarios and lower
// cost at 24 and 96. Keep the extra processes off short selections.
const DISCOVERY_MIN_SCENARIOS = 24;

/**
 * The limit of a run with a control: three times the run on the original, plus ten seconds of start-up, in whole
 * milliseconds (spawn refuses a fractional `timeout`).
 */
export function detectLimit(controlMs: number): number {
  return Math.ceil(controlMs * 3) + 10_000;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface FailureWitness {
  readonly location: string;
  readonly pickle: string;
  readonly step: number;
  readonly name: string;
}

/** One timed run of cucumber-js. */
export interface Timed {
  readonly result: RunResult;
  readonly ms: number;
  readonly witness?: FailureWitness;
}

/** What the replay needs of cucumber-js. */
export interface Runner {
  run(tests: readonly string[], limitMs: number): Promise<Timed>;
  discover?(tests: readonly string[], limitMs: number): Promise<Timed>;
}

// Stryker's pinned Cucumber formatter names the scenario line or the exact Examples row.
function scenarioLocation(value: string): boolean {
  const match = /^([^:\\]+\.feature):([1-9][0-9]*)$/.exec(value);
  if (match === null) return false;
  const file = match[1] as string;
  return (
    file === normalize(file) &&
    !file.startsWith('/') &&
    !file.startsWith('../') &&
    !file.startsWith('-') &&
    !basename(file).startsWith('@') &&
    !/[*?{}()\[\]\u0000\r\n]/.test(file) &&
    Number.isSafeInteger(Number(match[2]))
  );
}

const gherkinStep = ({ name }: { name: string }) => name.startsWith('step « ');

/** Messages distinguish Gherkin steps from hooks. A candidate is useful only with a complete, admitted run. */
function failureWitness(
  result: RunResult,
  locations: readonly (string | null)[],
): FailureWitness | undefined {
  const { run } = result;
  if (
    result.timedOut ||
    result.incomplete ||
    result.selectionFailure ||
    'failure' in run ||
    run.runHooks.some(({ status }) => status !== 'PASSED')
  )
    return undefined;
  for (const [index, pickle] of run.pickles.entries()) {
    const attempt = pickle.attempts[0];
    const location = locations[index];
    if (
      !location ||
      pickle.attempts.length !== 1 ||
      attempt?.attempt !== 0 ||
      attempt.willBeRetried !== false
    )
      continue;
    if (attempt.steps.some(({ name, status }) => name.startsWith('hook ') && status !== 'PASSED')) continue;
    const failed = attempt.steps.findIndex(({ status }) => status !== 'PASSED');
    const outcome = attempt.steps[failed];
    if (outcome?.status !== 'FAILED' || !gherkinStep(outcome)) continue;
    const step = attempt.steps.slice(0, failed).filter(gherkinStep).length;
    return { location, pickle: pickle.id, step, name: outcome.name };
  }
  return undefined;
}

/**
 * Runs the pinned Cucumber API with explicit feature locations in `root`, sequentially (the
 * suite shares ports, files and PostgreSQL, as for Stryker's single worker), each run with its own report under `work`
 * (cucumber-js creates the directory). Each run leads its own process group, killed whole when the run ends or reaches
 * its limit: a scenario's own children (a nested cucumber-js, srt, PostgreSQL) never outlive it.
 */
export class CucumberRunner implements Runner {
  private runs = 0;
  // The selector is also a mutation target. Capture its original bytes before mutating the worktree.
  private readonly selector: Buffer;

  constructor(
    private readonly root: string,
    private readonly profile: string,
    private readonly work: string,
    selector = new URL(CUCUMBER),
  ) {
    this.selector = readFileSync(selector);
  }

  run(tests: readonly string[], limitMs: number): Promise<Timed> {
    return this.execute(tests, limitMs, false);
  }

  discover(tests: readonly string[], limitMs: number): Promise<Timed> {
    return this.execute(tests, Math.min(limitMs, detectLimit(0)), true);
  }

  private async execute(tests: readonly string[], limitMs: number, discover: boolean): Promise<Timed> {
    const expected = new Set(tests);
    if (expected.size === 0 || expected.size !== tests.length || !tests.every(scenarioLocation)) {
      const failure = 'sélection de scénarios de rejeu invalide';
      return { result: { run: { failure }, timedOut: false, selectionFailure: failure }, ms: 0 };
    }
    this.runs++;
    const report = join(this.work, `run-${this.runs}.ndjson`);
    const errors = join(this.work, `run-${this.runs}.err`);
    mkdirSync(this.work, { recursive: true });
    const selectorPath = join(this.work, 'selector.mts');
    writeFileSync(selectorPath, this.selector);
    const entry =
      'import * as cucumber from ' +
      JSON.stringify(import.meta.resolve('@cucumber/cucumber/api')) +
      ';' +
      'import { runReplayCucumber } from ' +
      JSON.stringify(pathToFileURL(selectorPath).href) +
      ';process.exitCode = await runReplayCucumber(process.argv.slice(1), process.stderr, cucumber, {}, ' +
      discover +
      ');';
    const args = ['--input-type=module', '--eval', entry, '--', this.profile, report, ...tests];
    const stderr = openSync(errors, 'w');
    const started = performance.now();
    // child_process.spawn options detached, stdio, timeout and killSignal: node_modules/@types/node/child_process.d.ts.
    // Standard output is ignored, never piped: an unread pipe that fills blocks the run. At `timeout`, Node kills the
    // child with `killSignal`; the group is killed once the child is gone, its own children with it.
    const child = spawn(process.execPath, args, {
      cwd: this.root,
      detached: true,
      stdio: ['ignore', 'ignore', stderr],
      timeout: limitMs,
      killSignal: KILL,
    });
    closeSync(stderr);
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }));
      },
    );
    try {
      process.kill(-(child.pid as number), KILL);
    } catch {
      // ESRCH: the group has ended. EPERM: the number now leads a group that is not ours, left alone.
    }
    const timedOut = signal === KILL;
    const ms = performance.now() - started;
    // Without a report, the first error line of its standard error says why (a stack frame names no error).
    const diagnostics = readFileSync(errors, 'utf8').split('\n');
    const execution = diagnostics
      .find((line) => line.startsWith(EXECUTION_PREFIX))
      ?.slice(EXECUTION_PREFIX.length);
    const why = execution ?? diagnostics.find((line) => line.includes('Error')) ?? 'aucun diagnostic';
    const refused =
      code === 2
        ? diagnostics.find((line) => line.startsWith(SELECTION_PREFIX))?.slice(SELECTION_PREFIX.length)
        : undefined;
    let selectionFailure = diagnostics.includes('AOS_REPLAY_PLAN_VALID')
      ? undefined
      : (refused ?? 'précontrôle Cucumber non confirmé');
    let runCompleted = false;
    let executed: readonly (string | null)[] = [];
    const observed = existsSync(report)
      ? parseCucumberReport(
          readFileSync(report, 'utf8'),
          () => true,
          false,
          (locations, completed) => {
            runCompleted = completed;
            executed = locations;
            const remaining = new Set<string | null>(expected);
            for (const location of locations) {
              if (!remaining.delete(location)) {
                selectionFailure = 'scénario de rejeu inattendu : ' + String(location);
                return;
              }
            }
            if (completed && remaining.size > 0) {
              selectionFailure = 'scénario de rejeu manquant : ' + [...remaining].join(', ');
            }
          },
        )
      : { failure: `cucumber-js n’a écrit aucun rapport : ${why}` };
    const run = execution === undefined ? observed : { failure: execution };
    const result: RunResult = {
      run,
      timedOut,
      ...(runCompleted ? {} : { incomplete: true }),
      ...(code === 0 ? {} : { badExit: true }),
      ...(selectionFailure === undefined ? {} : { selectionFailure }),
    };
    const witness =
      code === 1 && (discover || tests.length === 1) ? failureWitness(result, executed) : undefined;
    return { result, ms, ...(witness === undefined ? {} : { witness }) };
  }
}

/**
 * Replays each case in the working tree: the control on the original first (cached per set of scenarios), then the
 * mutant written over the file and the file written back, whatever happens. A file that differs from the text of the
 * report (another tree, or a replay interrupted before it wrote it back) is a divergence, never mutated. When the named
 * killers of a Killed mutant pass on it, its fallback scenarios decide; a detection by a broken run needs a fresh
 * control after it (Judgement.recheck). `limitMs` bounds the controls and the runs
 * without a control; a run with a control is bounded by detectLimit.
 */
export interface ReplayOptions {
  readonly discoverRuntimeErrors?: boolean;
  readonly onTiming?: (entry: ReplayEntry, elapsedMs: number) => void;
}

export async function replayAll(
  cases: readonly ReplayCase[],
  workspace: Workspace,
  runner: Runner,
  limitMs: number,
  options: ReplayOptions = {},
): Promise<ReplayEntry[]> {
  const controls = new Map<string, Timed>();
  const control = async (tests: readonly string[]) => {
    const key = JSON.stringify(tests);
    const cached = controls.get(key) ?? (await runner.run(tests, limitMs));
    controls.set(key, cached);
    return cached;
  };
  const entries: ReplayEntry[] = [];
  for (const replay of cases) {
    const started = performance.now();
    const entry = (divergence: string | null) => {
      const completed = { file: replay.file, id: replay.mutant.id, status: replay.mutant.status, divergence };
      entries.push(completed);
      options.onTiming?.(completed, performance.now() - started);
    };
    if (replay.problem !== null) {
      entry(replay.problem);
      continue;
    }
    if (workspace.read(replay.file) !== replay.source) {
      entry('le fichier du dépôt diffère de celui du rapport de mutation');
      continue;
    }
    const runMutant = async (run: () => Promise<Timed>) => {
      workspace.write(replay.file, replay.mutated);
      try {
        return await run();
      } finally {
        workspace.write(replay.file, replay.source);
      }
    };
    if (
      options.discoverRuntimeErrors === true &&
      replay.mutant.status === 'RuntimeError' &&
      replay.tests.length >= DISCOVERY_MIN_SCENARIOS &&
      runner.discover !== undefined
    ) {
      const discover = runner.discover.bind(runner);
      const candidate = (await runMutant(() => discover(replay.tests, limitMs))).witness;
      if (candidate !== undefined && replay.tests.includes(candidate.location)) {
        const only = [candidate.location];
        const original = await runner.run(only, limitMs);
        const reproduced = await runMutant(() => runner.run(only, detectLimit(original.ms)));
        const verdict = judgeReplay(replay, only.length, original.result, reproduced.result);
        const found = reproduced.witness;
        const originalPickle = 'failure' in original.result.run ? undefined : original.result.run.pickles[0];
        const originalStep = originalPickle?.attempts[0]?.steps.filter(gherkinStep)[candidate.step];
        if (
          verdict.divergence === null &&
          !verdict.recheck &&
          found?.location === candidate.location &&
          found.pickle === candidate.pickle &&
          found.step === candidate.step &&
          found.name === candidate.name &&
          originalPickle?.id === candidate.pickle &&
          originalStep?.name === candidate.name &&
          originalStep.status === 'PASSED'
        ) {
          entry(null);
          continue;
        }
      }
    }
    // A run with a control is bounded by it: a mutant that hangs costs three times the control, not `limitMs`.
    const attempt = async (tests: readonly string[]) => {
      const witness = replay.expectation.survives ? null : await control(tests);
      const limit = witness === null ? limitMs : detectLimit(witness.ms);
      const run = await runMutant(() => runner.run(tests, limit));
      const judgement = judgeReplay(replay, tests.length, witness?.result ?? null, run.result);
      if (!judgement.recheck) return judgement;
      const fresh = await runner.run(tests, limitMs);
      return { ...judgement, divergence: recheckDivergence(fresh.result, tests.length) };
    };
    const named = await attempt(replay.tests);
    entry(
      named.retry && replay.fallback.length > 0
        ? (await attempt(replay.fallback)).divergence
        : named.divergence,
    );
  }
  return entries;
}
