import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CiJob, CiRun, RuleSuite } from '../../src/domain/ports.js';
import { GhForge } from '../../src/infrastructure/gh-forge.js';
import { temporaryDirectory, type ForgeFixture } from './fixtures.js';
import { REPOSITORY, type DeliverWorld } from './support.js';

const FAKE_GH = `${REPOSITORY}tools/deliver/fixtures/fake-gh.mjs`;
export const REPO = 'cdeust/architect-os';

/** What the scripted client answers to one call (see `fixtures/fake-gh.mjs`). */
interface Answer {
  exit?: number;
  stdout?: string;
  then?: Record<string, Answer>;
}

/** The forge of the `gh` row: the real adapter over a scripted client that answers from a file this fixture writes. */
export interface GhForgeFixture extends ForgeFixture {
  forge: GhForge;
  /** The program and the argv prefix the adapter is started with. */
  program: string;
  prefix: string[];
  /** The answer to the call named by `kind` (`runs` of a commit, `jobs` or `rerun` of a run, `suites` of a branch). */
  answers(kind: string, subject: string, answer: Answer): void;
  /** The arguments the client received, one line per call, in order. */
  asked(): string[];
}

const keys: Record<string, (subject: string) => string> = {
  runs: (hash) => `repos/${REPO}/actions/runs?head_sha=${hash}&per_page=100`,
  jobs: (id) => `repos/${REPO}/actions/runs/${id}/jobs?per_page=100`,
  rerun: (id) => `--method POST repos/${REPO}/actions/runs/${id}/rerun-failed-jobs`,
  suites: (branch) =>
    `repos/${REPO}/rulesets/rule-suites?ref=${encodeURIComponent(`refs/heads/${branch}`)}&per_page=100`,
};

export function keyOf(kind: string, subject: string): string {
  const key = keys[kind];
  if (key === undefined) throw new Error(`no kind of call named ${kind}`);
  return key(subject);
}

const runsText = (hash: string, id: number, status: string): string =>
  JSON.stringify({ workflow_runs: [{ id, name: 'gate', head_sha: hash, status }] });

const jobText = (job: CiJob) => ({
  name: job.name,
  conclusion: job.conclusion === 'other' ? 'timed_out' : job.conclusion,
  runner_name: job.hadRunner ? 'runner-1' : null,
  steps: job.failedStep
    ? [{ conclusion: 'success' }, { conclusion: 'failure' }]
    : [{ conclusion: 'success' }],
});

export function ghForge(world: DeliverWorld): GhForgeFixture {
  const file = join(temporaryDirectory(world), 'answers.json');
  const planned: Record<string, Answer> = {
    [`repos/${REPO}/actions/runs`]: { stdout: JSON.stringify({ workflow_runs: [] }) },
    [`repos/${REPO}/rulesets/rule-suites`]: { stdout: '[]' },
  };
  const write = (): void => writeFileSync(file, JSON.stringify(planned));
  write();
  const prefix = [FAKE_GH, file];
  const asked = (): string[] =>
    existsSync(`${file}.argv`) ? readFileSync(`${file}.argv`, 'utf8').split('\n').slice(0, -1) : [];
  const answers: GhForgeFixture['answers'] = (kind, subject, answer) => {
    planned[keyOf(kind, subject)] = answer;
    write();
  };
  return {
    forge: new GhForge(REPO, process.execPath, prefix, process.cwd()),
    program: process.execPath,
    prefix,
    answers,
    asked,
    hasRun(hash: string, run: CiRun) {
      const key = keyOf('runs', hash);
      answers('runs', hash, { stdout: runsText(hash, run.id, run.completed ? 'completed' : 'in_progress') });
      answers('jobs', String(run.id), { stdout: JSON.stringify({ jobs: run.jobs.map(jobText) }) });
      // A rerun leaves the run not completed, and without jobs.
      answers('rerun', String(run.id), {
        stdout: '{}',
        then: {
          [key]: { stdout: runsText(hash, run.id, 'in_progress') },
          [keyOf('jobs', String(run.id))]: { stdout: JSON.stringify({ jobs: [] }) },
        },
      });
    },
    evaluated(branch: string, hash: string, suite: RuleSuite) {
      answers('suites', branch, { stdout: JSON.stringify([{ after_sha: hash, result: suite }]) });
    },
    reruns: () =>
      asked()
        .filter((line) => line.startsWith('api --method POST'))
        .map((line) => `rerun ${/\/runs\/(\d+)\//.exec(line)?.[1]}`),
  };
}
