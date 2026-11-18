import assert from 'node:assert/strict';
import { GhForge } from '../../src/infrastructure/gh-forge.js';
import { REPO, type GhForgeFixture } from './gh-fixture.js';
import { temporaryDirectory } from './fixtures.js';
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

Given(
  'the gh forge answers the {word} of {string} with the exit code {int} and the output {string}',
  function (kind: string, subject: string, code: number, output: string) {
    ghOf(this).answers(kind, subject, { exit: code, stdout: output });
  },
);

Given('the gh forge finds the run {int} of {string}', function (id: number, hash: string) {
  ghOf(this).answers('runs', hash, {
    stdout: JSON.stringify({
      workflow_runs: [{ id, name: 'gate', head_sha: hash, status: 'completed' }],
    }),
  });
});

Given('a delivery forge over the program {string}', function (program: string) {
  this.state['portForge'] = { forge: new GhForge(REPO, program, [], temporaryDirectory(this)) };
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

When('I ask the gh forge for the run', function () {
  attempt(this, () => ghOf(this).forge.run(COMMIT, 'gate'));
});

When('I ask the gh forge for the rule suite of {string}', function (branch: string) {
  attempt(this, () => ghOf(this).forge.ruleSuite(branch, COMMIT));
});

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
  assert.deepEqual(
    ghOf(this).asked(),
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
