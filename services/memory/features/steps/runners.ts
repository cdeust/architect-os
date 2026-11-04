import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { Sandbox, SandboxExit, SandboxRequest, SandboxRunner } from '@architect-os/sandbox';
import type { ContainerRunner } from '../../src/domain/ports.js';
import { SandboxContainerRunner } from '../../src/infrastructure/sandbox-container-runner.js';
import { InProcessContainerRunner } from '../../src/infrastructure/in-process-runner.js';
import {
  Given,
  Then,
  When,
  assertMatches,
  attempt,
  refusedWith,
  required,
  slot,
  type Attempt,
  type MemoryWorld,
} from './helpers.js';

const LIMITS = { max_turns: 1, max_budget_usd: 0.1 };

/** What the scripted port does: print, then exit; or never finish; or refuse to start. */
type Script =
  | { readonly kind: 'print'; readonly stdout: string; readonly stderr: string; readonly exitCode: number }
  | { readonly kind: 'hang' }
  | { readonly kind: 'refuse'; readonly message: string };

/** A fake SandboxRunner port: records the request, stdin and stops; plays its script on its streams. */
class ScriptedPort implements SandboxRunner {
  request: SandboxRequest | undefined;
  stdin = '';
  stopped = false;

  constructor(private readonly script: Script) {}

  async start(request: SandboxRequest): Promise<Sandbox> {
    if (this.script.kind === 'refuse') throw new Error(this.script.message);
    this.request = request;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdin.on('data', (chunk: Buffer) => (this.stdin += chunk.toString('utf8')));
    let finish: (exit: SandboxExit) => void = () => undefined;
    const exited = new Promise<SandboxExit>((done) => (finish = done));
    const script = this.script;
    if (script.kind === 'print') {
      stdin.on('end', () => {
        stdout.end(script.stdout);
        stderr.end(script.stderr);
        finish({ code: script.exitCode, signal: null });
      });
    }
    return {
      stdin,
      stdout,
      stderr,
      exited,
      stop: async () => {
        this.stopped = true;
        stdout.destroy();
        stderr.destroy();
        finish({ code: null, signal: 'SIGKILL' });
        return exited;
      },
    };
  }
}

const sandboxRunner = (port: ScriptedPort, maxOutputBytes = 1_000_000) =>
  new SandboxContainerRunner(port, { profile: 'memory-worker', cwd: '/work', maxOutputBytes });

class RunnerScenario {
  runner: ContainerRunner | undefined;
  port: ScriptedPort | undefined;
  outcome: Attempt | undefined;
}

const scenario = (world: MemoryWorld) => slot(world, 'runners', () => new RunnerScenario());

// --- the ContainerRunner contract: one adapter per Examples row ---

Given(
  'the {string} container runner whose worker prints {string} and exits with {int}',
  function (adapter: string, stdout: string, exitCode: number) {
    const s = scenario(this);
    if (adapter === 'in-process') {
      s.runner = new InProcessContainerRunner(async () => ({ stdout, exitCode }));
    } else if (adapter === 'sandbox (fake port)') {
      s.port = new ScriptedPort({ kind: 'print', stdout, stderr: '', exitCode });
      s.runner = sandboxRunner(s.port);
    } else {
      assert.fail(`unknown ContainerRunner adapter: ${adapter}`);
    }
  },
);

Given('the {string} container runner whose worker never finishes', function (adapter: string) {
  const s = scenario(this);
  if (adapter === 'in-process') {
    s.runner = new InProcessContainerRunner(() => new Promise(() => undefined));
  } else if (adapter === 'sandbox (fake port)') {
    s.port = new ScriptedPort({ kind: 'hang' });
    s.runner = sandboxRunner(s.port);
  } else {
    assert.fail(`unknown ContainerRunner adapter: ${adapter}`);
  }
});

Given(
  'the sandbox container runner whose worker writes {int} bytes on {word}, bounded at {int}',
  function (bytes: number, stream: string, bound: number) {
    const s = scenario(this);
    const text = 'x'.repeat(bytes);
    s.port = new ScriptedPort({
      kind: 'print',
      stdout: stream === 'stdout' ? text : '{}',
      stderr: stream === 'stderr' ? text : '',
      exitCode: 0,
    });
    s.runner = sandboxRunner(s.port, bound);
  },
);

Given('the sandbox container runner whose port refuses to start with {string}', function (message: string) {
  const s = scenario(this);
  s.port = new ScriptedPort({ kind: 'refuse', message });
  s.runner = sandboxRunner(s.port);
});

When(
  'the container runner runs a recall request with a timeout of {int} ms',
  async function (timeoutMs: number) {
    const s = scenario(this);
    const runner = required(s.runner, 'a container runner');
    s.outcome = await attempt(() =>
      runner.run({
        input: { run_id: 'r1', tool: 'recall', input: { query: 'q' }, limits: LIMITS },
        timeoutMs,
      }),
    );
  },
);

Then(
  'the container runner returned exit code {int} and stdout {string}',
  function (exitCode: number, stdout: string) {
    const { outcome } = scenario(this);
    assert.ok(outcome && !outcome.failed, 'the runner must have returned');
    assert.deepEqual(outcome.value, { exitCode, stdout });
  },
);

Then('the container runner exit code is {int}', function (exitCode: number) {
  const { outcome } = scenario(this);
  assert.ok(outcome && !outcome.failed, 'the runner must have returned');
  assert.equal((outcome.value as { exitCode: number }).exitCode, exitCode);
});

Then('the container runner is rejected with code {string}', function (code: string) {
  refusedWith(scenario(this).outcome, code);
});

// --- the sandbox adapter and its port ---

const port = (world: MemoryWorld) => required(scenario(world).port, 'a fake port');

Then(
  'the fake port was asked for the profile {string} in {string} with an empty argv',
  function (profile: string, cwd: string) {
    assert.deepEqual(port(this).request, { profile, cwd, command: [] });
  },
);

Then('the fake port received on stdin {string}', function (stdin: string) {
  assert.equal(port(this).stdin, stdin);
});

Then('the fake port was stopped', function () {
  assert.equal(port(this).stopped, true);
});

Then('the fake port was not stopped', function () {
  assert.equal(port(this).stopped, false);
});

Then('the container runner returned {int} bytes of stdout', function (bytes: number) {
  const { outcome } = scenario(this);
  assert.ok(outcome && !outcome.failed, 'the runner must have returned');
  assert.equal((outcome.value as { stdout: string }).stdout.length, bytes);
});
