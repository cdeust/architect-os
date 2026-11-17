import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { DataTable } from '@cucumber/cucumber';
import {
  SandboxError,
  type Sandbox,
  type SandboxExit,
  type SandboxRequest,
  type SandboxRunner,
} from '../../src/port.js';
import { outputTail, passed, renderChecks, type CheckOutcome } from '../../src/step-checks.js';
import { sandboxCheck } from '../../src/step-tool.js';
import { Given, Then, When, stored } from './helpers.js';

/** One turn of the event loop, so that what has been written has reached the listeners. */
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** A text with JSON escapes (`é`, `\n`): a step writes in ASCII what it pushes. */
const unescape = (text: string): string => JSON.parse(`"${text}"`) as string;

// --- outputTail ---------------------------------------------------------------------------------------------

interface Tail {
  tail: ReturnType<typeof outputTail>;
  /** Everything pushed, which the scenario compares the result with. */
  all: Buffer[];
}
const tailOf = (world: Parameters<typeof stored>[0]) => stored<Tail>(world, 'tail');

Given('a tail of {int} bytes', function (bytes: number) {
  this.state['tail'] = { tail: outputTail(bytes), all: [] } satisfies Tail;
});

When('I push the text {string} to the tail', function (text: string) {
  const t = tailOf(this);
  const chunk = Buffer.from(unescape(text));
  t.all.push(chunk);
  t.tail.push(chunk);
});

When(
  'I push the text {string} to the tail from a buffer that I overwrite afterwards',
  function (text: string) {
    const t = tailOf(this);
    const chunk = Buffer.from(unescape(text));
    t.all.push(Buffer.from(chunk));
    t.tail.push(chunk);
    chunk.fill(0x7a);
  },
);

When('I push the numbered chunks from 1 to {int}', function (last: number) {
  const t = tailOf(this);
  for (let i = 1; i <= last; i++) {
    const chunk = Buffer.from(`${i};`);
    t.all.push(chunk);
    t.tail.push(chunk);
  }
});

Then('the tail gives {string}, cut {string}', function (output: string, cut: string) {
  assert.deepEqual(tailOf(this).tail.result(), { output: unescape(output), cut: cut === 'true' });
});

Then(
  'the tail gives the last {int} bytes of everything pushed, cut {string}',
  function (bytes: number, cut: string) {
    const t = tailOf(this);
    const whole = Buffer.concat(t.all);
    assert.ok(whole.length > 10 * bytes, 'the scenario must push far more than the bound');
    assert.deepEqual(t.tail.result(), {
      output: whole.subarray(whole.length - bytes).toString('utf8'),
      cut: cut === 'true',
    });
  },
);

// --- passed -------------------------------------------------------------------------------------------------

Then(
  'a check that ended with the exit code {string} and stopped {string} has passed {string}',
  function (code: string, stopped: string, expected: string) {
    assert.equal(
      passed({ exitCode: code === 'null' ? null : Number(code), stopped: stopped === 'true' }),
      expected === 'true',
    );
  },
);

// --- renderChecks -------------------------------------------------------------------------------------------

interface Reports {
  rows: Parameters<typeof renderChecks>[0];
  rendered?: string;
}

Given('the check reports:', function (table: DataTable) {
  this.state['reports'] = {
    rows: table.hashes().map((row) => ({
      name: row['name'] as string,
      command: JSON.parse(row['argv'] as string) as string[],
      exitCode: row['exit'] === 'null' ? null : Number(row['exit']),
      stopped: false,
      durationSeconds: Number(row['seconds']),
      cut: row['cut'] === 'true',
      output: (row['output'] as string).replaceAll('<LF>', '\n').replaceAll('<ESC>', '\u001b'),
    })),
  } satisfies Reports;
});

When('I render the checks with the bound {int}', function (bound: number) {
  const reports = stored<Reports>(this, 'reports');
  reports.rendered = renderChecks(reports.rows, bound);
});

Then('the rendered checks are:', function (block: string) {
  assert.equal(stored<Reports>(this, 'reports').rendered, `${block}\n`);
});

// --- the real check, over a fake runner --------------------------------------------------------------------

/** A runner written here: the in-memory adapter only echoes its input, and has no output, exit code or stop to order. */
class FakeRunner implements SandboxRunner {
  readonly requests: SandboxRequest[] = [];
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  stops = 0;
  /** A descendant that left the process group holds the outputs: a stop ends the process, not them. */
  heldOpen = false;
  scheduled: { fire: () => void; ms: number; cancelled: boolean }[] = [];
  private finish: (exit: SandboxExit) => void = () => {};
  private readonly exited = new Promise<SandboxExit>((done) => (this.finish = done));
  failure?: Error;

  async start(request: SandboxRequest): Promise<Sandbox> {
    if (this.failure) throw this.failure;
    this.requests.push(request);
    return {
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
      exited: this.exited,
      stop: async () => {
        this.stops++;
        if (!this.heldOpen) this.endOutputs();
        this.finish({ code: null, signal: 'SIGTERM' });
        return this.exited;
      },
    };
  }

  exit(exit: SandboxExit): void {
    this.finish(exit);
  }

  endOutputs(): void {
    this.stdout.end();
    this.stderr.end();
  }
}

interface Real {
  runner: FakeRunner;
  result?: Promise<CheckOutcome>;
  outcome?: CheckOutcome;
  failure?: unknown;
}
const real = (world: Parameters<typeof stored>[0]) => stored<Real>(world, 'realCheck');

Given('a fake sandbox runner whose limit is scheduled by hand', function () {
  this.state['realCheck'] = { runner: new FakeRunner() } satisfies Real;
});

Given(
  'a fake sandbox runner whose outputs a descendant keeps open, its limit scheduled by hand',
  function () {
    const runner = new FakeRunner();
    runner.heldOpen = true;
    this.state['realCheck'] = { runner } satisfies Real;
  },
);

Then('both outputs of the fake sandbox are destroyed', function () {
  const { stdout, stderr } = real(this).runner;
  assert.deepEqual([stdout.destroyed, stderr.destroyed], [true, true]);
});

Given(
  'a fake sandbox runner that cannot start, with the sandbox error {string} {string}',
  function (code: string, message: string) {
    const runner = new FakeRunner();
    runner.failure = new SandboxError(code as 'ISOLATION_UNAVAILABLE', message);
    this.state['realCheck'] = { runner } satisfies Real;
  },
);

When(
  'I start the real check {string} in {string} with the limit of {int} seconds',
  async function (command: string, cwd: string, seconds: number) {
    const r = real(this);
    const check = sandboxCheck(r.runner, cwd, (fire, ms) => {
      const limit = { fire, ms, cancelled: false };
      r.runner.scheduled.push(limit);
      return () => void (limit.cancelled = true);
    });
    r.result = check(command.split(' '), seconds);
    // A refusal is kept for the Then step: nothing is left unhandled meanwhile.
    r.result.then(
      (outcome) => (r.outcome = outcome),
      (error: unknown) => (r.failure = error),
    );
    await turn();
  },
);

When('the fake sandbox writes {string} on its stdout', async function (text: string) {
  real(this).runner.stdout.write(text);
  await turn();
});

When('the fake sandbox writes {string} on its stderr', async function (text: string) {
  real(this).runner.stderr.write(text);
  await turn();
});

When(
  'the fake sandbox writes {int} times the text {string} on its stdout',
  async function (n: number, text: string) {
    real(this).runner.stdout.write(text.repeat(n));
    await turn();
  },
);

When(
  'the fake sandbox writes {int} times the text {string} on its stderr',
  async function (n: number, text: string) {
    real(this).runner.stderr.write(text.repeat(n));
    await turn();
  },
);

When('the fake sandbox exits with the code {int}', async function (code: number) {
  real(this).runner.exit({ code, signal: null });
  real(this).runner.endOutputs();
  await turn();
});

When('the fake sandbox exits on a signal', async function () {
  real(this).runner.exit({ code: null, signal: 'SIGKILL' });
  real(this).runner.endOutputs();
  await turn();
});

When('the fake sandbox exits with the code {int} while its outputs stay open', async function (code: number) {
  real(this).runner.exit({ code, signal: null });
  await turn();
});

When('the fake sandbox ends its outputs', async function () {
  real(this).runner.endOutputs();
  await turn();
});

When('the scheduled limit fires', async function () {
  // A timer that was cancelled does not fire.
  for (const limit of real(this).runner.scheduled) if (!limit.cancelled) limit.fire();
  await turn();
});

When('I wait for the real check', async function () {
  await real(this).result?.catch(() => undefined);
});

Then(
  'the fake sandbox was asked for the profile {string} in {string} with the argv {string}',
  function (profile: string, cwd: string, argv: string) {
    assert.deepEqual(real(this).runner.requests, [{ profile, cwd, command: argv.split(' ') }]);
  },
);

Then('the input of the fake sandbox is ended', function () {
  assert.equal(real(this).runner.stdin.writableEnded, true);
});

Then('the fake sandbox was stopped {int} times', function (count: number) {
  assert.equal(real(this).runner.stops, count);
});

Then(
  'the limit was scheduled for {int} milliseconds and cancelled {int} times',
  function (ms: number, cancelled: number) {
    const { scheduled } = real(this).runner;
    assert.deepEqual(
      scheduled.map((limit) => limit.ms),
      [ms],
    );
    assert.equal(scheduled.filter((limit) => limit.cancelled).length, cancelled);
  },
);

Then(
  'the real check gave {string}, exit code {int}, stopped {string}, cut {string}',
  function (output: string, code: number, stopped: string, cut: string) {
    assert.deepEqual(real(this).outcome, {
      exitCode: code,
      stopped: stopped === 'true',
      output,
      cut: cut === 'true',
    });
  },
);

Then(
  'the real check gave {string}, no exit code, stopped {string}, cut {string}',
  function (output: string, stopped: string, cut: string) {
    assert.deepEqual(real(this).outcome, {
      exitCode: null,
      stopped: stopped === 'true',
      output,
      cut: cut === 'true',
    });
  },
);

Then(
  'the real check gave an output of {int} bytes, exit code {int}, stopped {string}, cut {string}',
  function (bytes: number, code: number, stopped: string, cut: string) {
    const outcome = real(this).outcome as CheckOutcome;
    assert.equal(outcome.output, 'x'.repeat(bytes));
    assert.deepEqual(
      [outcome.exitCode, outcome.stopped, outcome.cut],
      [code, stopped === 'true', cut === 'true'],
    );
  },
);

Then('the real check is refused with {string}', function (message: string) {
  const failure = real(this).failure;
  assert.ok(failure instanceof SandboxError);
  assert.equal(failure.message, message);
});
