import { z } from 'zod';
import { effectiveJobs } from '../domain/attempts.js';
import type { CiJob, CiRun, Forge, RuleSuite } from '../domain/ports.js';
import { closedEnvironment, runToEnd, type HostEnvironment } from './host-process.js';

// The schemas are built when a call needs them, inside functions: a schema at module level is evaluated once, when the
// file is loaded, and the mutation run would replay the whole suite for each of its mutants.

/** The identifier of a run, before it enters a path. */
function idSchema() {
  return z.number().int().positive();
}

function runsSchema() {
  return z.object({
    workflow_runs: z.array(
      z.object({
        id: idSchema(),
        name: z.string(),
        head_sha: z.string(),
        status: z.string(),
        run_attempt: idSchema().optional(),
      }),
    ),
  });
}

function jobSchema() {
  return z.object({
    name: z.string(),
    conclusion: z.string().nullable(),
    runner_name: z.string().nullable(),
    steps: z.array(z.object({ name: z.string().optional(), conclusion: z.string().nullable() })).optional(),
  });
}

type ForgeJob = z.infer<ReturnType<typeof jobSchema>>;

/** GitHub may include an automatic setup and completion around the workflow steps. */
function firstStepFailure(steps: ForgeJob['steps']): string | undefined {
  if (steps === undefined) return undefined;
  const first = steps[0]?.name === 'Set up job' && steps[0].conclusion === 'success' ? 1 : 0;
  const step = steps[first];
  if (step?.conclusion !== 'failure' || !step.name) return undefined;
  const rest = steps.slice(first + 1);
  return rest.every(
    (later, i) =>
      later.conclusion === 'skipped' ||
      (i === rest.length - 1 && later.name === 'Complete job' && later.conclusion === 'success'),
  )
    ? step.name
    : undefined;
}

function ruleSuitesSchema() {
  return z.array(z.object({ after_sha: z.string(), result: z.string() }));
}

function conclusionOf(value: string | null): CiJob['conclusion'] {
  switch (value) {
    case 'success':
    case 'failure':
    case 'cancelled':
    case 'skipped':
    case null:
      return value;
    default:
      return 'other';
  }
}

/**
 * `Forge` over the GitHub client: every call is `<program> <prefix…> api <arguments>`, started without a shell in
 * `cwd`, with the closed environment of `host`. `repository` is `owner/name`. What a call prints is parsed and checked by a schema that keeps the fields named
 * here; nothing it prints is returned whole or put in an error: a failure throws one fixed message per method, with the
 * exit code when there is one.
 */
export class GhForge implements Forge {
  constructor(
    private readonly repository: string,
    private readonly program: string,
    private readonly prefix: readonly string[],
    private readonly cwd: string,
    private readonly host: HostEnvironment,
  ) {}

  run(hash: string, workflow: string, jobNames?: readonly string[] | 'all'): CiRun | undefined {
    const { workflow_runs } = this.read(
      'runs',
      [`repos/${this.repository}/actions/runs?head_sha=${hash}&per_page=100`],
      runsSchema(),
    );
    const mine = workflow_runs.filter((run) => run.name === workflow && run.head_sha === hash);
    // The first run of the commit is the one of its trial branch: the smallest id.
    const first = mine.sort((a, b) => a.id - b.id)[0];
    if (first === undefined) return undefined;
    const runPath = `repos/${this.repository}/actions/runs/${first.id}`;
    // Delivery requires a numbered result before it can let a red run consume a rerun.
    const version =
      first.status === 'completed' && first.run_attempt === undefined && jobNames !== undefined
        ? this.read(
            'run',
            [runPath],
            z.object({
              id: z.literal(first.id),
              head_sha: z.literal(hash),
              status: z.string(),
              run_attempt: idSchema(),
            }),
          )
        : first;
    const jobs =
      version.run_attempt !== undefined && version.status === 'completed'
        ? this.effectiveJobs(runPath, version.run_attempt, jobNames === 'all' ? undefined : jobNames)
        : this.read('jobs', [`${runPath}/jobs?per_page=100`], z.object({ jobs: z.array(jobSchema()) })).jobs;
    return {
      id: version.id,
      completed: version.status === 'completed',
      ...(version.run_attempt === undefined ? {} : { attempt: version.run_attempt }),
      jobs: jobs.map((job) => {
        const steps = job.steps;
        const firstFailure = firstStepFailure(steps);
        return {
          name: job.name,
          conclusion: conclusionOf(job.conclusion),
          hadRunner:
            Boolean(job.runner_name) ||
            Boolean(
              steps?.some((step) => step.name && step.conclusion !== null && step.conclusion !== 'skipped'),
            ),
          failedStep: Boolean(steps?.some((step) => step.conclusion === 'failure')),
          ...(firstFailure === undefined ? {} : { firstStepFailure: firstFailure }),
        };
      }),
    };
  }

  /** The attempt-specific endpoint binds every row to its attempt, even when the row omits run_attempt. */
  private effectiveJobs(path: string, current: number, names?: readonly string[]): ForgeJob[] {
    return effectiveJobs(current, (attempt) => this.attemptJobs(path, attempt), names);
  }

  /** The jobs of one attempt, every page read; pages whose count or ids do not add up are refused. */
  private attemptJobs(path: string, attempt: number): ForgeJob[] {
    const pages = this.read(
      'jobs',
      ['--paginate', '--slurp', `${path}/attempts/${attempt}/jobs?per_page=100`],
      z
        .array(z.object({ total_count: z.number(), jobs: z.array(jobSchema().extend({ id: idSchema() })) }))
        .min(1),
    );
    const rows = pages.flatMap((page) => page.jobs);
    // Every page states the total for this attempt. Repeated IDs can hide an omitted execution at the same count.
    if (
      pages.some((page) => page.total_count !== rows.length) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      throw new Error(failure('jobs'));
    return rows;
  }

  rerunFailed(runId: number): void {
    if (!idSchema().safeParse(runId).success) throw new Error(failure('rerun'));
    this.start('rerun', [
      '--method',
      'POST',
      `repos/${this.repository}/actions/runs/${runId}/rerun-failed-jobs`,
    ]);
  }

  ruleSuite(branch: string, hash: string): RuleSuite | undefined {
    const ref = encodeURIComponent(`refs/heads/${branch}`);
    const suites = this.read(
      'rule suites',
      [`repos/${this.repository}/rulesets/rule-suites?ref=${ref}&per_page=100`],
      ruleSuitesSchema(),
    );
    const result = suites.find((suite) => suite.after_sha === hash)?.result;
    return result === 'pass' || result === 'fail' || result === 'bypass' ? result : undefined;
  }

  /** Runs `api <args>`; its output is read as JSON and checked by `schema`. */
  private read<T>(method: string, args: string[], schema: z.ZodType<T>): T {
    const { out } = this.start(method, args);
    let json: unknown;
    try {
      json = JSON.parse(out);
    } catch {
      // Not JSON: nothing was parsed, and the schema below refuses `undefined` with the message of the method.
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(failure(method));
    return parsed.data;
  }

  /** Runs `api <args>`; a program that did not run to its end or exited with a non-zero code throws. */
  private start(method: string, args: string[]): { out: string } {
    const finished = runToEnd(
      this.program,
      [...this.prefix, 'api', ...args],
      this.cwd,
      closedEnvironment(this.host, {}),
    );
    if (finished === undefined) throw new Error(failure(method));
    if (finished.status !== 0) throw new Error(failure(method, finished.status));
    return finished;
  }
}

/** The one message of a method; the exit code is the only thing of the program it holds. */
function failure(method: string, code?: number): string {
  return `the forge did not answer: ${method}${code === undefined ? '' : ` (exit code ${code})`}`;
}
