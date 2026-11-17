import type { CiRun, Forge, RuleSuite } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/** The answer at a turn: the last one is repeated once the list is spent. */
function answer<T>(answers: readonly T[] | undefined, turn: number): T | undefined {
  return answers?.[Math.min(turn, answers.length - 1)];
}

/** The turn of this call for a key, then the next. */
function turn(turns: Map<string, number>, key: string): number {
  const current = turns.get(key) ?? 0;
  turns.set(key, current + 1);
  return current;
}

/**
 * `Forge` answering from lists, one answer per call, by commit (runs) and by branch and commit (evaluations). Once a
 * run is replayed, the next answer for its commit is that run, not completed, whatever the list says.
 */
export class InMemoryForge implements Forge {
  private readonly runs = new Map<string, (CiRun | undefined)[]>();
  private readonly suites = new Map<string, (RuleSuite | undefined)[]>();
  private readonly runTurns = new Map<string, number>();
  private readonly suiteTurns = new Map<string, number>();
  private readonly given = new Map<string, CiRun>();
  private readonly replayed = new Map<string, CiRun>();

  /**
   * With `remote` (the branches of an in-memory `Repository`), an evaluation exists only for a push that left the
   * branch at that commit; without it, whatever the scenario evaluated.
   */
  constructor(
    private readonly journal: Journal,
    private readonly remote?: ReadonlyMap<string, string>,
  ) {}

  /** What `run` answers for a commit, in turn. */
  script(hash: string, runs: (CiRun | undefined)[]): void {
    this.runs.set(hash, runs);
  }

  /** What `ruleSuite` answers for a branch and a commit, in turn. */
  evaluate(branch: string, hash: string, suites: (RuleSuite | undefined)[]): void {
    this.suites.set(`${branch} ${hash}`, suites);
  }

  run(hash: string, workflow: string): CiRun | undefined {
    this.journal.record('ci', hash, workflow);
    const replayed = this.replayed.get(hash);
    if (replayed !== undefined) {
      this.replayed.delete(hash);
      return replayed;
    }
    const run = answer(this.runs.get(hash), turn(this.runTurns, hash));
    if (run !== undefined) this.given.set(hash, run);
    return run;
  }

  rerunFailed(id: number): void {
    this.journal.record('rerun', id);
    for (const [hash, run] of this.given) {
      if (run.id === id) this.replayed.set(hash, { id, completed: false, jobs: [] });
    }
  }

  ruleSuite(branch: string, hash: string): RuleSuite | undefined {
    this.journal.record('ruleSuite', branch, hash);
    if (this.remote !== undefined && this.remote.get(branch) !== hash) return undefined;
    const key = `${branch} ${hash}`;
    return answer(this.suites.get(key), turn(this.suiteTurns, key));
  }
}
