// What a run of the workflow says of the required jobs.
import type { CiRun } from './ports.js';

export type CiState = 'missing' | 'waiting' | 'green' | 'no-runner' | 'failed';

/**
 * Decided in this order. Only a job GitHub never started is replayed without a person: a required job that is absent,
 * that has a failed step, or that was cancelled after it got a runner is `failed`.
 */
export function ciState(run: CiRun | undefined, requiredJobs: readonly string[]): CiState {
  if (run === undefined) return 'missing';
  if (!run.completed) return 'waiting';
  const jobs = requiredJobs.map((name) => run.jobs.find((job) => job.name === name));
  if (jobs.every((job) => job?.conclusion === 'success')) return 'green';
  const present = jobs.filter((job) => job !== undefined);
  const neverStarted =
    present.length === jobs.length &&
    present.every((job) => !job.failedStep && (job.conclusion === 'success' || !job.hadRunner));
  return neverStarted ? 'no-runner' : 'failed';
}
