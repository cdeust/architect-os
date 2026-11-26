// What a run of the workflow says of the required jobs.
import type { DeliverConfig, JobDependency } from './config.js';
import type { CiJob, CiRun } from './ports.js';

export type CiState = 'missing' | 'waiting' | 'green' | 'no-runner' | 'failed';

/**
 * GitHub returns one job per lane and suffix. Check the complete names: a suffix may
 * end in another suffix, and a suffix may start with a digit of the lane number.
 */
function plannedProducers(
  jobs: readonly CiJob[],
  family: JobDependency['plannedProducers'],
): string[] | undefined {
  if (family === undefined) return [];
  const names = jobs.map(({ name }) => name).filter((name) => name.startsWith(family.prefix));
  const count = names.length / family.suffixes.length;
  if (!Number.isInteger(count)) return undefined;
  const unmatched = new Set(names);
  for (let lane = 1; lane <= count; lane++) {
    for (const suffix of family.suffixes) {
      if (!unmatched.delete(family.prefix + lane + suffix)) return undefined;
    }
  }
  return names;
}

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
      const planned = plannedProducers(run.jobs, group.plannedProducers);
      if (planned === undefined) return 'failed';
      // A green aggregate judged at least the lane of the canary: a run that shows none is not the gate.
      if (group.plannedProducers !== undefined && planned.length === 0 && job.conclusion === 'success')
        return 'failed';
      let producerDidNotSucceed = false;
      for (const producer of [...group.producers, ...planned]) {
        const upstream = uniqueJob(producer);
        if (upstream === undefined || upstream.failedStep) return 'failed';
        producerDidNotSucceed ||= upstream.conclusion !== 'success';
        jobs.push(upstream);
      }
      if (job.conclusion === 'success' && (producerDidNotSucceed || job.failedStep)) return 'failed';
      if (
        producerDidNotSucceed &&
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
