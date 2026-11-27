import { effectiveJobs } from '../domain/attempts.js';
import type { CiJob, CiRun, Forge, PullRequestRequest, PullRequestResult } from '../domain/ports.js';
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

/** A pull request of the forge: its head follows the branch, as on the forge. */
interface Pull {
  number: number;
  head: string;
  base: string;
  draft: boolean;
}

/**
 * `Forge` answering from lists, one answer per call, by the push of a commit to a branch (runs). Once a run is
 * replayed, the next answer for its push is that run, not completed, whatever the list says. Its pull requests are
 * kept, numbered from 1; their heads are the branches of `remote`.
 */
export class InMemoryForge implements Forge {
  private readonly runs = new Map<string, (CiRun | undefined)[]>();
  private readonly runTurns = new Map<string, number>();
  private readonly given = new Map<string, CiRun>();
  private readonly replayed = new Map<string, CiRun>();
  private readonly attempts = new Map<string, { id: number; attempts: readonly (readonly CiJob[])[] }>();
  readonly pulls: Pull[] = [];
  /** What `openPullRequest` was asked, in order. */
  readonly requests: PullRequestRequest[] = [];
  /** Fault injection: the forge refuses to open a pull request, or answers that the destination holds the commit. */
  refusing: false | 'refused' | 'merged' = false;
  /** Fault injection: the forge shows the head at another commit for that many more reads, as GitHub does after a push. */
  staleReads = 0;

  /**
   * `repository` (`owner/name`) is in the address of each pull request. `remote` is where the forge sees each branch:
   * the branches of an in-memory `Repository`, or a map of its own.
   */
  constructor(
    private readonly journal: Journal,
    private readonly repository: string,
    readonly remote: Map<string, string> = new Map(),
  ) {}

  /** What `run` answers for the push of a commit to a branch, in turn. */
  script(hash: string, branch: string, runs: (CiRun | undefined)[]): void {
    this.runs.set(`${hash} ${branch}`, runs);
  }

  /**
   * A completed run of `attempts.length` attempts, the jobs each attempt executed, first attempt first. Asked with job
   * names, `run` gives the effective jobs of that run, as the forge reads them attempt by attempt.
   */
  scriptAttempts(hash: string, branch: string, id: number, attempts: readonly (readonly CiJob[])[]): void {
    this.attempts.set(`${hash} ${branch}`, { id, attempts });
  }

  /** A pull request someone opened as a draft, from `head` to `base`. */
  openDraft(head: string, base: string): void {
    this.pulls.push({ number: this.pulls.length + 1, head, base, draft: true });
  }

  run(
    hash: string,
    workflow: string,
    branch: string,
    jobNames?: readonly string[] | 'all',
  ): CiRun | undefined {
    this.journal.record('ci', hash, workflow, branch);
    const push = `${hash} ${branch}`;
    const recorded = this.attempts.get(push);
    if (recorded !== undefined) {
      const current = recorded.attempts.length;
      const jobsOf = (attempt: number): CiJob[] => recorded.attempts.slice(attempt - 1, attempt).flat();
      // GitHub lists a completed run with its attempt number, and the forge then reads every attempt: without job
      // names, as with 'all', every effective job.
      return {
        id: recorded.id,
        completed: true,
        attempt: current,
        jobs: effectiveJobs(current, jobsOf, Array.isArray(jobNames) ? jobNames : undefined),
      };
    }
    const replayed = this.replayed.get(push);
    if (replayed !== undefined) {
      this.replayed.delete(push);
      return replayed;
    }
    const run = answer(this.runs.get(push), turn(this.runTurns, push));
    if (run !== undefined) this.given.set(push, run);
    return run;
  }

  rerunFailed(id: number): void {
    this.journal.record('rerun', id);
    for (const [push, run] of this.given) {
      if (run.id === id) this.replayed.set(push, { id, completed: false, jobs: [] });
    }
  }

  openPullRequest(request: PullRequestRequest): PullRequestResult {
    const { head, base, hash } = request;
    this.journal.record('pullRequest', head, base, hash);
    this.requests.push(request);
    const at = this.remote.get(head);
    if (at === undefined) return { ok: false, reason: 'la forge ne voit pas la branche de travail' };
    if (at !== hash || this.staleReads > 0) {
      this.staleReads = Math.max(0, this.staleReads - 1);
      return { ok: false, reason: "la tête de la branche de travail n'est pas le commit livré" };
    }
    const open = this.pulls.find((pull) => pull.head === head && pull.base === base);
    if (open?.draft === true) {
      return { ok: false, reason: 'une pull request en brouillon est ouverte pour cette tête' };
    }
    if (open !== undefined) return { ok: true, number: open.number, url: this.address(open), created: false };
    if (this.refusing === 'refused') return { ok: false, reason: 'la forge a refusé la pull request' };
    if (this.refusing === 'merged')
      return { ok: false, reason: 'la destination contient déjà le commit livré' };
    const pull: Pull = { number: this.pulls.length + 1, head, base, draft: false };
    this.pulls.push(pull);
    return { ok: true, number: pull.number, url: this.address(pull), created: true };
  }

  private address(pull: Pull): string {
    return `https://github.com/${this.repository}/pull/${pull.number}`;
  }
}
