import assert from 'node:assert/strict';
import { ciState } from '../../src/domain/ci.js';
import { GhForge } from '../../src/infrastructure/gh-forge.js';
import { REPO, type GhForgeFixture } from './gh-fixture.js';
import { DESTINATION, TRIAL, hostOf, temporaryDirectory } from './fixtures.js';
import type { StreamProgressFixture } from './process-fixtures.js';
import { Given, Then, When, type DeliverWorld } from './support.js';

// The scenarios of the adapter of the forge alone (ports.feature, rule Forge) and of the stream progress.

const ghOf = (world: DeliverWorld): GhForgeFixture => world.state['portForge'] as GhForgeFixture;
/** The commit all the scenarios of the adapter alone ask for. */
const COMMIT = '0000000000000000000000000000000000000021';

Given(
  'the gh forge answers the {word} of {string} with {string}',
  function (kind: string, subject: string, output: string) {
    ghOf(this).answers(kind, subject, { stdout: output });
  },
);

Given('the gh client is ended by a signal when it is asked for a new pull request', function () {
  ghOf(this).answers('open', '', { signal: true });
});

Given(
  'the gh forge answers the {word} of {string} with the exit code {int} and the output {string}',
  function (kind: string, subject: string, code: number, output: string) {
    ghOf(this).answers(kind, subject, { exit: code, stdout: output });
  },
);

Given('the gh forge finds the run {int} of {string}', function (id: number, hash: string) {
  ghOf(this).answers('runs', hash, {
    stdout: JSON.stringify({
      workflow_runs: [
        { id, name: 'gate', head_sha: hash, event: 'push', head_branch: TRIAL, status: 'completed' },
      ],
    }),
  });
});

Given('a delivery forge over the program {string}', function (program: string) {
  this.state['portForge'] = { forge: new GhForge(REPO, program, [], temporaryDirectory(this), hostOf(this)) };
});

Then(
  'the effective jobs of the gh run for {string} have the state {string}',
  function (names: string, state: string) {
    const required = names.split(', ');
    const run = ghOf(this).forge.run(COMMIT, 'gate', TRIAL, required);
    assert.equal(ciState(run, required), state);
  },
);

Then('the gh run for {string} is:', function (names: string, text: string) {
  const run = ghOf(this).forge.run(COMMIT, 'gate', TRIAL, names.split(', '));
  assert.deepEqual(run, JSON.parse(text));
});

Then('the unfiltered gh run is:', function (text: string) {
  assert.deepEqual(ghOf(this).forge.run(COMMIT, 'gate', TRIAL), JSON.parse(text));
});

Then('the gh run reports the first failed user step as {string}', function (name: string) {
  const job = ghOf(this).forge.run(COMMIT, 'gate', TRIAL)?.jobs[0];
  assert.ok(job?.failedStep);
  assert.equal(job.firstStepFailure, name || undefined);
});

/** The error of the call, when it threw. */
const failureOf = (world: DeliverWorld): Error => world.state['portFailure'] as Error;

function attempt(world: DeliverWorld, call: () => unknown): void {
  try {
    call();
  } catch (error) {
    world.state['portFailure'] = error;
  }
}

When('I ask the gh forge for a delivery decision', function () {
  attempt(this, () => ghOf(this).forge.run(COMMIT, 'gate', TRIAL, ['linux']));
});

When('I ask the gh forge for the run', function () {
  attempt(this, () => ghOf(this).forge.run(COMMIT, 'gate', TRIAL));
});

When('I ask the gh forge for a pull request from {string}', function (head: string) {
  attempt(this, () => {
    this.state['ghPull'] = ghOf(this).forge.openPullRequest({
      head,
      base: DESTINATION,
      hash: COMMIT,
      title: 'Deliver the step step',
      body: 'line one\n@someone',
    });
  });
});

Then('the gh forge refused the pull request because {string}', function (reason: string) {
  assert.equal(this.state['portFailure'], undefined);
  assert.deepEqual(this.state['ghPull'], { ok: false, reason });
});

Then('the gh forge answered the pull request {string}', function (expected: string) {
  assert.equal(this.state['portFailure'], undefined);
  assert.deepEqual(this.state['ghPull'], JSON.parse(expected));
});

Then(
  'the gh client was asked for a new pull request with the arguments, each as JSON:',
  function (expected: string) {
    const argv = ghOf(this)
      .createdArguments()
      .map((argument) => JSON.stringify(argument));
    assert.deepEqual(
      argv,
      expected.split('\n').filter((line) => line !== ''),
    );
  },
);

When('I ask the gh forge to rerun the run {float}', function (id: number) {
  attempt(this, () => ghOf(this).forge.rerunFailed(id));
});

Then('the gh forge failed with {string}', function (message: string) {
  assert.equal(failureOf(this).message, message);
});

Then('the message of the gh forge failure holds nothing of {string}', function (marker: string) {
  assert.ok(!failureOf(this).message.includes(marker));
});

Then('the gh client was asked:', function (expected: string) {
  // A call whose argument holds a line break takes as many lines of the text.
  assert.deepEqual(
    ghOf(this).asked().join('\n').split('\n'),
    expected.split('\n').filter((line) => line !== ''),
  );
});

Then('the gh client was asked nothing', function () {
  assert.deepEqual(ghOf(this).asked(), []);
});

Then(
  'the stream of the delivery progress holds {int} lines, each ended by a line break',
  function (count: number) {
    const written = (this.state['portProgress'] as StreamProgressFixture).written();
    assert.ok(written.endsWith('\n'));
    assert.equal(written.split('\n').length, count + 1);
  },
);

Then('the gh client was asked for {word} new pull request', function (count: string) {
  assert.equal(ghOf(this).created().length, count === 'no' ? 0 : 1);
});
