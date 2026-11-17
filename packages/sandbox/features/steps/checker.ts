// Steps of features/sandbox/checker.feature: the check of a step (`sandboxCheck`) on the real srt adapter.
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sandbox, SandboxRunner } from '../../src/port.js';
import type { CheckOutcome } from '../../src/step-checks.js';
import { sandboxCheck } from '../../src/step-tool.js';
import { Then, When, stored, type SandboxWorld } from './helpers.js';

/** A limit far beyond the scenario: only the scenario fires it. */
const LIMIT_SECONDS = 600;

/**
 * Plays the real check over the scenario's runner. `fireWhen` receives the started sandbox and the limit, and decides
 * when the limit fires; without it, the limit never fires.
 */
async function play(
  world: SandboxWorld,
  command: readonly string[],
  fireWhen?: (sandbox: Sandbox, fire: () => void) => void,
): Promise<void> {
  const real = stored<SandboxRunner>(world, 'runner');
  let fire = () => {};
  const observed: SandboxRunner = {
    start: async (request) => {
      const sandbox = await real.start(request);
      fireWhen?.(sandbox, () => fire());
      return sandbox;
    },
  };
  const check = sandboxCheck(observed, stored<string>(world, 'cwd'), (limit) => {
    fire = limit;
    return () => void (fire = () => {});
  });
  world.state['checkOutcome'] = await check(command, LIMIT_SECONDS);
}

const outcome = (world: SandboxWorld) => stored<CheckOutcome>(world, 'checkOutcome');

When('the check of a step runs {string} in the worktree', async function (command: string) {
  await play(this, command.split(' '));
});

When(
  'the check of a step runs {string} in the worktree, its limit fired once it printed {string}',
  async function (command: string, printed: string) {
    await play(this, command.split(' '), (sandbox, fire) => {
      let seen = '';
      sandbox.stdout.on('data', (chunk: Buffer) => {
        seen += String(chunk);
        if (seen.includes(printed)) fire();
      });
    });
  },
);

When(
  'the check of a step runs a command that exits with code 0 and leaves a detached descendant holding its outputs, its limit fired once the command has exited',
  async function () {
    // The descendant is its own session: the kill of the group at the end of the process does not reach it (T-06b), and
    // it holds the two pipes it inherited. It lives as long as the file `keep` of the worktree, two minutes at most:
    // the scenario removes the file, and so does the removal of the repository. The host never acts on a pid a sandbox
    // printed.
    const keep = join(stored<string>(this, 'cwd'), 'keep');
    writeFileSync(keep, '');
    this.cleanups.push(() => rmSync(keep, { force: true }));
    const wait = 'i=0; while [ -e keep ] && [ $i -lt 600 ]; do sleep 0.2; i=$((i+1)); done';
    const script =
      `require('child_process').spawn('sh',['-c',${JSON.stringify(wait)}],{detached:true,stdio:'inherit'}).unref();` +
      "console.log('started')";
    await play(this, ['node', '-e', script], (sandbox, fire) => void sandbox.exited.then(fire));
  },
);

Then(
  'the check of the step gave the output {string}, the exit code {int}, stopped {string}',
  function (output: string, code: number, stopped: string) {
    const result = outcome(this);
    assert.deepEqual(
      { output: result.output.trim(), exitCode: result.exitCode, stopped: result.stopped, cut: result.cut },
      { output, exitCode: code, stopped: stopped === 'true', cut: false },
    );
  },
);

Then('the check of the step did not exit with code 0', function () {
  assert.notEqual(outcome(this).exitCode, 0);
});

Then('the check of the step was stopped, with the output {string}', function (output: string) {
  const result = outcome(this);
  assert.deepEqual({ output: result.output.trim(), stopped: result.stopped }, { output, stopped: true });
});
