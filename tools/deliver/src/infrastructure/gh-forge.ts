import { z } from 'zod';
import type { CiJob, CiRun, Forge, RuleSuite } from '../domain/ports.js';
import { runToEnd } from './host-process.js';

// The schemas are built when a call needs them, inside functions: a schema at module level is evaluated once, when the
// file is loaded, and the mutation run would replay the whole suite for each of its mutants.

/** The identifier of a run, before it enters a path. */
function idSchema() {
  return z.number().int().positive();
}

function runsSchema() {
  return z.object({
    workflow_runs: z.array(
      z.object({ id: idSchema(), name: z.string(), head_sha: z.string(), status: z.string() }),
    ),
  });
}

function jobsSchema() {
  return z.object({
    jobs: z.array(
      z.object({
        name: z.string(),
        conclusion: z.string().nullable(),
        runner_name: z.string().nullable(),
        steps: z.array(z.object({ conclusion: z.string().nullable() })).optional(),
      }),
    ),
  });
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
 * `cwd`. `repository` is `owner/name`. What a call prints is parsed and checked by a schema that keeps the fields named
 * here; nothing it prints is returned whole or put in an error: a failure throws one fixed message per method, with the
 * exit code when there is one.
 */
export class GhForge implements Forge {
  constructor(
    private readonly repository: string,
    private readonly program: string,
    private readonly prefix: readonly string[],
    private readonly cwd: string,
  ) {}

  run(hash: string, workflow: string): CiRun | undefined {
    const { workflow_runs } = this.read(
      'runs',
      [`repos/${this.repository}/actions/runs?head_sha=${hash}&per_page=100`],
      runsSchema(),
    );
    const mine = workflow_runs.filter((run) => run.name === workflow && run.head_sha === hash);
    // The first run of the commit is the one of its trial branch: the smallest id.
    const first = mine.sort((a, b) => a.id - b.id)[0];
    if (first === undefined) return undefined;
    const { jobs } = this.read(
      'jobs',
      [`repos/${this.repository}/actions/runs/${first.id}/jobs?per_page=100`],
      jobsSchema(),
    );
    return {
      id: first.id,
      completed: first.status === 'completed',
      jobs: jobs.map((job) => ({
        name: job.name,
        conclusion: conclusionOf(job.conclusion),
        hadRunner: job.runner_name !== null && job.runner_name !== '',
        failedStep: job.steps?.some((step) => step.conclusion === 'failure') === true,
      })),
    };
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
    const finished = runToEnd(this.program, [...this.prefix, 'api', ...args], this.cwd, {});
    if (finished === undefined) throw new Error(failure(method));
    if (finished.status !== 0) throw new Error(failure(method, finished.status));
    return finished;
  }
}

/** The one message of a method; the exit code is the only thing of the program it holds. */
function failure(method: string, code?: number): string {
  return `the forge did not answer: ${method}${code === undefined ? '' : ` (exit code ${code})`}`;
}
