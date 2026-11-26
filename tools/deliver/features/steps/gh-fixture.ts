import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CiJob, CiRun } from '../../src/domain/ports.js';
import { GhForge } from '../../src/infrastructure/gh-forge.js';
import { DESTINATION, TRIAL, hostOf, temporaryDirectory, type ForgeFixture } from './fixtures.js';
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
  /**
   * The answer to the call named by `kind` (`runs` of a commit, `jobs` or `rerun` of a run, `refs` of a branch, `pulls`
   * of a head to the destination, `open` for every new pull request).
   */
  answers(kind: string, subject: string, answer: Answer): void;
  /** The arguments the client received, one line per call, in order. */
  asked(): string[];
  /** The names of the environment the client received, sorted and joined by a space, one line per call, in order. */
  environments(): string[];
  /** The calls that asked for a new pull request, as `asked` gives them. */
  created(): string[];
  /** The arguments of the first call that asked for a new pull request, one per line, as the client received them. */
  createdArguments(): string[];
}

const keys: Record<string, (subject: string) => string> = {
  runs: (hash) => `repos/${REPO}/actions/runs?head_sha=${hash}&per_page=100`,
  jobs: (id) => `repos/${REPO}/actions/runs/${id}/jobs?per_page=100`,
  run: (id) => `repos/${REPO}/actions/runs/${id}`,
  attempt: (subject) => {
    const [run, attempt] = subject.split('/');
    return `--paginate --slurp repos/${REPO}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`;
  },
  rerun: (id) => `--method POST repos/${REPO}/actions/runs/${id}/rerun-failed-jobs`,
  refs: (branch) => `repos/${REPO}/git/matching-refs/heads/${branch}`,
  pulls: (head) =>
    `repos/${REPO}/pulls?head=${encodeURIComponent(`${REPO.split('/')[0]}:${head}`)}&base=${DESTINATION}&state=open&per_page=100`,
  open: () => `--method POST repos/${REPO}/pulls`,
};

export function keyOf(kind: string, subject: string): string {
  const key = keys[kind];
  if (key === undefined) throw new Error(`no kind of call named ${kind}`);
  return key(subject);
}

const runsText = (workflow: string, hash: string, id: number, status: string): string =>
  JSON.stringify({
    workflow_runs: [{ id, name: workflow, head_sha: hash, event: 'push', head_branch: TRIAL, status }],
  });

/** A pull request as the forge gives it. */
export const pullText = (number: number, head: string, sha: string, draft = false) => ({
  number,
  html_url: `https://github.com/${REPO}/pull/${number}`,
  state: 'open',
  draft,
  head: { ref: head, sha },
  base: { ref: DESTINATION },
});

const jobText = (job: CiJob) => ({
  name: job.name,
  conclusion: job.conclusion === 'other' ? 'timed_out' : job.conclusion,
  runner_name: job.hadRunner ? 'runner-1' : null,
  steps: job.failedStep
    ? [{ conclusion: 'success' }, { conclusion: 'failure' }]
    : [{ conclusion: 'success' }],
});

/**
 * `workflow` is the display name the runs of this forge carry. The scenarios of the port ask for `gate`, their own
 * name; the command reads its name from the committed descriptive file and gives it here.
 */
export function ghForge(world: DeliverWorld, workflow = 'gate'): GhForgeFixture {
  const file = join(temporaryDirectory(world), 'answers.json');
  const planned: Record<string, Answer> = {
    [`repos/${REPO}/actions/runs`]: { stdout: JSON.stringify({ workflow_runs: [] }) },
  };
  const write = (): void => writeFileSync(file, JSON.stringify(planned));
  write();
  const prefix = [FAKE_GH, file];
  const asked = (): string[] =>
    existsSync(`${file}.argv`)
      ? readFileSync(`${file}.argv`, 'utf8')
          .split('\n')
          .slice(0, -1)
          .map((line) => (JSON.parse(line) as string[]).join(' '))
      : [];
  /** The open pull requests, by head: what the list answers, and what the next creation adds to. */
  const pulls = new Map<string, ReturnType<typeof pullText>[]>();
  const listPulls = (head: string): void => {
    const open = pulls.get(head) ?? [];
    pulls.set(head, open);
    answers('pulls', head, { stdout: JSON.stringify(open) });
  };
  const environments = (): string[] =>
    existsSync(`${file}.env`) ? readFileSync(`${file}.env`, 'utf8').split('\n').slice(0, -1) : [];
  const answers: GhForgeFixture['answers'] = (kind, subject, answer) => {
    planned[keyOf(kind, subject)] = answer;
    write();
  };
  return {
    forge: new GhForge(REPO, process.execPath, prefix, process.cwd(), hostOf(world)),
    program: process.execPath,
    prefix,
    answers,
    asked,
    environments,
    hasRun(hash: string, run: CiRun) {
      const key = keyOf('runs', hash);
      answers('runs', hash, {
        stdout: runsText(workflow, hash, run.id, run.completed ? 'completed' : 'in_progress'),
      });
      answers('jobs', String(run.id), { stdout: JSON.stringify({ jobs: run.jobs.map(jobText) }) });
      answers('run', String(run.id), {
        stdout: JSON.stringify({
          id: run.id,
          head_sha: hash,
          status: run.completed ? 'completed' : 'in_progress',
          run_attempt: run.attempt ?? 1,
        }),
      });
      answers('attempt', String(run.id) + '/' + String(run.attempt ?? 1), {
        stdout: JSON.stringify([
          { total_count: run.jobs.length, jobs: run.jobs.map((job, i) => ({ ...jobText(job), id: i + 1 })) },
        ]),
      });
      // A rerun leaves the run not completed, and without jobs.
      answers('rerun', String(run.id), {
        stdout: '{}',
        then: {
          [key]: { stdout: runsText(workflow, hash, run.id, 'in_progress') },
          [keyOf('jobs', String(run.id))]: { stdout: JSON.stringify({ jobs: [] }) },
        },
      });
    },
    hasAttempts(hash: string, id: number, attempts: CiJob[][]) {
      // As GitHub lists a run: with its attempt number.
      answers('runs', hash, {
        stdout: JSON.stringify({
          workflow_runs: [
            {
              id,
              name: workflow,
              head_sha: hash,
              event: 'push',
              head_branch: TRIAL,
              status: 'completed',
              run_attempt: attempts.length,
            },
          ],
        }),
      });
      answers('run', String(id), {
        stdout: JSON.stringify({ id, head_sha: hash, status: 'completed', run_attempt: attempts.length }),
      });
      let next = 1;
      attempts.forEach((jobs, index) => {
        answers('attempt', `${id}/${index + 1}`, {
          stdout: JSON.stringify([
            { total_count: jobs.length, jobs: jobs.map((job) => ({ ...jobText(job), id: next++ })) },
          ]),
        });
      });
    },
    hasBranch(branch: string, hash: string) {
      answers('refs', branch, {
        stdout: JSON.stringify([{ ref: `refs/heads/${branch}`, object: { sha: hash } }]),
      });
      listPulls(branch);
      // A creation answers the next number, and lists it from then on.
      const created = pullText([...pulls.values()].flat().length + 1, branch, hash);
      answers('open', '', {
        stdout: JSON.stringify(created),
        then: {
          [keyOf('pulls', branch)]: { stdout: JSON.stringify([...(pulls.get(branch) ?? []), created]) },
        },
      });
    },
    lacksBranch(branch: string) {
      // A prefix that names other references only.
      answers('refs', branch, {
        stdout: JSON.stringify([{ ref: `refs/heads/${branch}-other`, object: { sha: '0'.repeat(40) } }]),
      });
    },
    hasDraft(head: string, hash: string) {
      this.hasBranch(head, hash);
      const number = [...pulls.values()].flat().length + 1;
      pulls.set(head, [...(pulls.get(head) ?? []), pullText(number, head, hash, true)]);
      listPulls(head);
    },
    refusesPullRequests() {
      answers('open', '', { exit: 1, stdout: 'MARKER-9c2e' });
    },
    created: () => asked().filter((line) => line.startsWith(`api ${keyOf('open', '')}`)),
    createdArguments: () => {
      const calls = existsSync(`${file}.argv`)
        ? readFileSync(`${file}.argv`, 'utf8')
            .split('\n')
            .slice(0, -1)
            .map((line) => JSON.parse(line) as string[])
        : [];
      return calls.find((argv) => argv.slice(1, 4).join(' ') === keyOf('open', '')) ?? [];
    },
    reruns: () =>
      asked()
        .filter((line) => line.startsWith('api --method POST'))
        .map((line) => `rerun ${/\/runs\/(\d+)\//.exec(line)?.[1]}`),
  };
}
