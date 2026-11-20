// What a run of the workflow says of the required jobs.
import type { DeliverConfig } from './config.js';
import type { CiJob, CiRun } from './ports.js';

export type CiState = 'missing' | 'waiting' | 'green' | 'no-runner' | 'failed';

/** A dependent job can run solely to report that GitHub never assigned its producer a runner. */
export function ciState(
  run: CiRun | undefined,
  requiredJobs: readonly string[],
  dependencies: DeliverConfig['jobDependencies'] = {},
): CiState {
  if (run === undefined) return 'missing';
  if (!run.completed) return 'waiting';
  const uniqueJob = (name: string): CiJob | undefined => {
    const matches = run.jobs.filter((job) => job.name === name);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const jobs: CiJob[] = [];
  for (const name of requiredJobs) {
    const job = uniqueJob(name);
    if (job === undefined) return 'failed';
    const group = Object.hasOwn(dependencies, name) ? dependencies[name] : undefined;
    if (group !== undefined) {
      let missingRunner = false;
      for (const producer of group.producers) {
        const upstream = uniqueJob(producer);
        if (upstream === undefined || upstream.failedStep) return 'failed';
        if (upstream.conclusion !== 'success') {
          if (upstream.hadRunner) return 'failed';
          missingRunner = true;
        }
        jobs.push(upstream);
      }
      if (job.conclusion === 'success' && (missingRunner || job.failedStep)) return 'failed';
      if (
        missingRunner &&
        job.hadRunner &&
        job.conclusion === 'failure' &&
        job.failedStep &&
        job.firstStepFailure === group.admissionStep
      )
        continue;
    }
    jobs.push(job);
  }
  if (jobs.every((job) => job.conclusion === 'success')) return 'green';
  return jobs.every((job) => !job.failedStep && (job.conclusion === 'success' || !job.hadRunner))
    ? 'no-runner'
    : 'failed';
}
