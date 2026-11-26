// What a run of the workflow says of the required jobs.
import type { DeliverConfig, JobDependency } from './config.js';
import type { CiJob, CiRun } from './ports.js';

export type CiState = 'missing' | 'waiting' | 'green' | 'no-runner' | 'failed';

/**
 * The jobs of a planned family the run must hold: for the lanes 1 to n it shows, one job per suffix. Undefined when
 * a job of the family has a name no plan gives (no lane number, a leading zero, a lane beyond a gap).
 */
function plannedProducers(
  jobs: readonly CiJob[],
  family: JobDependency['plannedProducers'],
): string[] | undefined {
  if (family === undefined) return [];
  const lanes = new Set<string>();
  for (const { name } of jobs) {
    if (!name.startsWith(family.prefix)) continue;
    const rest = name.slice(family.prefix.length);
    const suffix = family.suffixes.find((candidate) => rest.endsWith(candidate));
    if (suffix === undefined) return undefined;
    lanes.add(rest.slice(0, rest.length - suffix.length));
  }
  const names: string[] = [];
  for (let lane = 1; lane <= lanes.size; lane++) {
    if (!lanes.has(String(lane))) return undefined;
    for (const suffix of family.suffixes) names.push(family.prefix + lane + suffix);
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
