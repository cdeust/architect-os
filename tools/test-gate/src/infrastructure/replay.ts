import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  judgeReplay,
  recheckDivergence,
  type ReplayCase,
  type ReplayEntry,
  type RunResult,
} from '../domain/replay.js';
import { parseCucumberReport } from './cucumber-report.js';
import type { Workspace } from './workspace.js';

// The cucumber-js CLI of the repository; its package.json `exports` hides `bin/`, its own package.json does not.
const CUCUMBER = join(
  dirname(createRequire(import.meta.url).resolve('@cucumber/cucumber/package.json')),
  'bin',
  'cucumber.js',
);

/** The signal of a run stopped at its limit, and of its group once it is gone; nothing else sends it. */
const KILL = 'SIGKILL';

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

/** One timed run of cucumber-js. */
export interface Timed {
  readonly result: RunResult;
  readonly ms: number;
}

/** What the replay needs of cucumber-js. */
export interface Runner {
  run(tests: readonly string[], limitMs: number): Promise<Timed>;
}

/**
 * Runs `cucumber-js --profile <profile> --format message:<file> <feature>:<line>...` in `root`, sequentially (the
 * suite shares ports, files and PostgreSQL, as for Stryker's single worker), each run with its own report under `work`
 * (cucumber-js creates the directory). Each run leads its own process group, killed whole when the run ends or reaches
 * its limit: a scenario's own children (a nested cucumber-js, srt, PostgreSQL) never outlive it.
 */
export class CucumberRunner implements Runner {
  private runs = 0;

  constructor(
    private readonly root: string,
    private readonly profile: string,
    private readonly work: string,
  ) {}

  async run(tests: readonly string[], limitMs: number): Promise<Timed> {
    this.runs++;
    const report = join(this.work, `run-${this.runs}.ndjson`);
    const errors = join(this.work, `run-${this.runs}.err`);
    mkdirSync(this.work, { recursive: true });
    const stderr = openSync(errors, 'w');
    const args = [CUCUMBER, '--profile', this.profile, '--format', `message:${report}`, ...tests];
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
    const signal = await new Promise((resolve) => child.on('close', (_code, closed) => resolve(closed)));
    try {
      process.kill(-(child.pid as number), KILL);
    } catch {
      // ESRCH: the group has ended. EPERM: the number now leads a group that is not ours, left alone.
    }
    const timedOut = signal === KILL;
    const ms = performance.now() - started;
    // Without a report, the first error line of its standard error says why (a stack frame names no error).
    const why = String(
      readFileSync(errors, 'utf8')
        .split('\n')
        .find((line) => line.includes('Error')),
    );
    const run = existsSync(report)
      ? parseCucumberReport(readFileSync(report, 'utf8'), () => true)
      : { failure: `cucumber-js n’a écrit aucun rapport : ${why}` };
    return { result: { run, timedOut }, ms };
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
export async function replayAll(
  cases: readonly ReplayCase[],
  workspace: Workspace,
  runner: Runner,
  limitMs: number,
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
    const entry = (divergence: string | null) =>
      entries.push({ file: replay.file, id: replay.mutant.id, status: replay.mutant.status, divergence });
    if (replay.problem !== null) {
      entry(replay.problem);
      continue;
    }
    if (workspace.read(replay.file) !== replay.source) {
      entry('le fichier du dépôt diffère de celui du rapport de mutation');
      continue;
    }
    // A run with a control is bounded by it: a mutant that hangs costs three times the control, not `limitMs`.
    const attempt = async (tests: readonly string[]) => {
      const witness = replay.expectation.survives ? null : await control(tests);
      const limit = witness === null ? limitMs : detectLimit(witness.ms);
      workspace.write(replay.file, replay.mutated);
      let judgement;
      try {
        const run = await runner.run(tests, limit);
        judgement = judgeReplay(replay, tests.length, witness?.result ?? null, run.result);
      } finally {
        workspace.write(replay.file, replay.source);
      }
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
