import assert from 'node:assert/strict';
import { ciState } from '../../src/domain/ci.js';
import { planPublication, type Plan } from '../../src/domain/plan.js';
import type { CiJob, CiRun } from '../../src/domain/ports.js';
import { trialBranch } from '../../src/domain/trial.js';
import { Then, When } from './support.js';

/** A step argument cannot hold a line break as itself. */
const lineBreaks = (text: string): string => text.replaceAll('\\n', '\n');

const REQUIRED = (): string[] => ['gate-linux', 'gate-macos'];

/** `gate-linux=success/runner, gate-macos=cancelled/norunner/failed-step`: name, conclusion (or null), runner, step. */
function parseJobs(text: string): CiJob[] {
  if (text === '') return [];
  return text.split(', ').map((spec) => {
    const [name, rest] = spec.split('=') as [string, string];
    const [conclusion, runner, step] = rest.split('/') as [string, string, string | undefined];
    return {
      name,
      conclusion: conclusion === 'null' ? null : (conclusion as CiJob['conclusion']),
      hadRunner: runner === 'runner',
      failedStep: step !== undefined,
      ...(step === undefined || step === 'failed-step' ? {} : { firstStepFailure: step }),
    };
  });
}

function parseRun(kind: string, jobs: string): CiRun | undefined {
  if (kind === 'none') return undefined;
  return { id: 7, completed: kind === 'completed', jobs: parseJobs(jobs) };
}

Then('the trial branch for the name {string} is {string}', function (name: string, branch: string) {
  assert.equal(trialBranch('sentinel/gate-1a-', lineBreaks(name)), branch);
});

Then('the trial branch for the name {string} is refused', function (name: string) {
  assert.equal(trialBranch('sentinel/gate-1a-', lineBreaks(name)), undefined);
});

Then(
  'the CI state of the {string} run with the jobs {string} is {string}',
  function (kind: string, jobs: string, state: string) {
    assert.equal(ciState(parseRun(kind, jobs), REQUIRED()), state);
  },
);

Then(
  'the CI state of the {string} run with the jobs {string} and the required jobs {string} is {string}',
  function (kind: string, jobs: string, required: string, state: string) {
    assert.equal(ciState(parseRun(kind, jobs), required.split(', ')), state);
  },
);

Then(
  'the completed gate with producers {string} and jobs {string} is {string}',
  function (producerNames: string, jobs: string, state: string) {
    assert.equal(
      ciState(parseRun('completed', jobs), ['linux', 'macos'], {
        linux: { producers: producerNames.split(', '), admissionStep: 'Require all producers' },
      }),
      state,
    );
  },
);

/** `feat/gate-1a=p0, main=p0`. */
const remotes = (text: string): { branch: string; head: string }[] =>
  text.split(', ').map((spec) => {
    const [branch, head] = spec.split('=') as [string, string];
    return { branch, head };
  });

When(
  'the publication of {string} is planned over the remotes {string}',
  function (hash: string, text: string) {
    this.state['plan'] = planPublication(hash, remotes(text));
  },
);

Then(
  'the plan is the parent {string} and the branches {string}',
  function (parent: string, branches: string) {
    assert.deepEqual(this.state['plan'], { ok: true, parent, publish: branches.split(', ') } satisfies Plan);
  },
);

Then('the plan is refused as {string}', function (reason: string) {
  assert.deepEqual(this.state['plan'], { ok: false, reason });
});
