import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { PassThrough } from 'node:stream';
import type { CodeProcess, CodeToolDependencies } from '../../src/code-tool.js';
import { SandboxError } from '../../src/port.js';
import { factsJsonSchema } from '../../src/scout-facts.js';
import {
  codeToolSession,
  runStep,
  stepDependencies,
  toolDependencies,
  type StepDependencies,
  type ToolFile,
} from '../../src/step-tool.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';

interface Call {
  tool: string;
  argv: readonly string[];
  brief: string;
  limitSeconds: number;
}
interface Behaviour {
  fixture?: string;
  stopped?: boolean;
  failure?: Error;
  /** The session does not return until the scenario ends it. */
  held?: boolean;
  /** A check: what it returns, and how long it lasts on the clock of the step. */
  exitCode?: number | null;
  output?: string;
  cut?: boolean;
  durationMs?: number;
}
/** A promise the scenario resolves itself: no delay, no timer. */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
/** What one phase of sessions (the scouts, the reviews) shows: the sessions differ by the order in which they start (1 is the first). */
interface Phase {
  behaviours: Map<number, Behaviour>;
  started: Map<number, Deferred>;
  ended: Map<number, Deferred>;
  running: number;
  maxRunning: number;
  runningWhenStarted: number[];
}
type Phased = 'scout.json' | 'review.json';
const newPhase = (): Phase => ({
  behaviours: new Map(),
  started: new Map(),
  ended: new Map(),
  running: 0,
  maxRunning: 0,
  runningWhenStarted: [],
});
interface Step {
  folder: string;
  calls: Call[];
  behaviours: Record<ToolFile, Behaviour>;
  phases: Record<Phased, Phase>;
  /** The checks, which the step plays one at a time: they differ by the order in which they start (1 is the first). */
  checks: Phase;
  checkCalls: { command: readonly string[]; limitSeconds: number }[];
  /** The clock of the step, in milliseconds: only a check moves it. */
  clock: number;
  /** The files of the worktree the step runs in, as `readSource` gives them. */
  source: Map<string, string>;
  finished: boolean;
  run?: Promise<void>;
  stdout: string;
  stderr: string;
  code?: number;
}
const gate = (gates: Map<number, Deferred>, n: number): Deferred => {
  const known = gates.get(n);
  if (known !== undefined) return known;
  const created = deferred();
  gates.set(n, created);
  return created;
};
/** One turn of the event loop, so that what a wrong implementation would start by now has started. */
const turn = () => new Promise((resolve) => setImmediate(resolve));
const step = (world: SandboxWorld) => stored<Step>(world, 'step');
const fixture = (name: string) => readFileSync(join(PKG, 'fixtures', name), 'utf8');

Given('a step folder', function () {
  const folder = mkdtempSync(join(tmpdir(), 'aos-step-'));
  this.cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  this.state['step'] = {
    folder,
    calls: [],
    behaviours: { 'code.json': {}, 'review.json': {}, 'scout.json': {} },
    phases: { 'scout.json': newPhase(), 'review.json': newPhase() },
    checks: newPhase(),
    checkCalls: [],
    clock: 0,
    source: new Map(),
    finished: false,
    stdout: '',
    stderr: '',
  } satisfies Step;
});

Given(
  'the step folder holds the file {string} with the content {string}',
  function (name: string, content: string) {
    writeFileSync(join(step(this).folder, name), content);
  },
);

Given('the step folder holds the file {string}:', function (name: string, content: string) {
  writeFileSync(join(step(this).folder, name), content);
});

interface ReviewRow {
  name: string;
  model: string;
}
const writeStep = (
  s: Step,
  reviews: readonly ReviewRow[],
  parallel?: number,
  scouts: readonly ReviewRow[] = [],
  checks: readonly string[] = [],
) => {
  writeFileSync(
    join(s.folder, 'step.json'),
    JSON.stringify({
      build: { model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 2400 },
      ...(scouts.length > 0
        ? { scouts: scouts.map((scout) => ({ ...scout, effort: 'low', limitSeconds: 300 })) }
        : {}),
      ...(checks.length > 0
        ? {
            checks: checks.map((name) => ({ name, command: ['npm', 'run', name], limitSeconds: 120 })),
          }
        : {}),
      ...(reviews.length > 0
        ? { reviews: reviews.map((review) => ({ ...review, effort: 'high', limitSeconds: 900 })) }
        : {}),
      ...(parallel === undefined ? {} : { parallel }),
    }),
  );
  writeFileSync(join(s.folder, 'brief.md'), 'Build the thing.\n');
};

Given('the step folder holds a step.json with a build and {string}', function (review: string) {
  writeStep(step(this), review === 'a review' ? [{ name: 'correctness', model: 'claude-opus-5-5' }] : []);
});

const rows = (text: string): ReviewRow[] =>
  text.split(' ').map((pair) => ({ name: pair.split('=')[0]!, model: pair.split('=')[1]! }));

Given('the step folder holds a step.json with a build and the reviews {string}', function (text: string) {
  writeStep(step(this), rows(text));
});

Given(
  'the step folder holds a step.json with a build, the reviews {string} and the parallel {int}',
  function (text: string, parallel: number) {
    writeStep(step(this), rows(text), parallel);
  },
);

const behaviour = (s: Step, phase: Phased, n: number): Behaviour => {
  const known = s.phases[phase].behaviours.get(n);
  if (known !== undefined) return known;
  const created: Behaviour = {};
  s.phases[phase].behaviours.set(n, created);
  return created;
};

Given('the review session {int} writes the fixture {string}', function (n: number, name: string) {
  behaviour(step(this), 'review.json', n).fixture = name;
});

Given('the review session {int} is held until I end it', function (n: number) {
  behaviour(step(this), 'review.json', n).held = true;
});

Given(
  'the review session {int} fails with the sandbox error {string} {string}',
  function (n: number, code: string, message: string) {
    behaviour(step(this), 'review.json', n).failure = new SandboxError(
      code as 'ISOLATION_UNAVAILABLE',
      message,
    );
  },
);

Given('the scout session {int} writes the fixture {string}', function (n: number, name: string) {
  behaviour(step(this), 'scout.json', n).fixture = name;
});

Given('the scout session {int} is held until I end it', function (n: number) {
  behaviour(step(this), 'scout.json', n).held = true;
});

Given('the scout session {int} is stopped by its limit', function (n: number) {
  behaviour(step(this), 'scout.json', n).stopped = true;
});

Given(
  'the scout session {int} fails with the sandbox error {string} {string}',
  function (n: number, code: string, message: string) {
    behaviour(step(this), 'scout.json', n).failure = new SandboxError(
      code as 'ISOLATION_UNAVAILABLE',
      message,
    );
  },
);

Given('the scout session writes the fixture {string}', function (name: string) {
  step(this).behaviours['scout.json'].fixture = name;
});

Given('the step folder holds a step.json with a build and the scouts {string}', function (text: string) {
  writeStep(step(this), [], undefined, rows(text));
});

Given(
  'the step folder holds a step.json with a build, the scouts {string} and the reviews {string}',
  function (scouts: string, reviews: string) {
    writeStep(step(this), rows(reviews), undefined, rows(scouts));
  },
);

Given(
  'the step folder holds a step.json with a build, the scouts {string} and the parallel {int}',
  function (text: string, parallel: number) {
    writeStep(step(this), [], parallel, rows(text));
  },
);

Given('the step folder holds a step.json with a build and the checks {string}', function (names: string) {
  writeStep(step(this), [], undefined, [], names.split(' '));
});

Given(
  'the step folder holds a step.json with a build, the checks {string} and the reviews {string}',
  function (names: string, reviews: string) {
    writeStep(step(this), rows(reviews), undefined, [], names.split(' '));
  },
);

Given(
  'the step folder holds a step.json with a build, the scouts {string}, the checks {string} and the reviews {string}',
  function (scouts: string, names: string, reviews: string) {
    writeStep(step(this), rows(reviews), undefined, rows(scouts), names.split(' '));
  },
);

const checkBehaviour = (s: Step, n: number): Behaviour => {
  const known = s.checks.behaviours.get(n);
  if (known !== undefined) return known;
  const created: Behaviour = {};
  s.checks.behaviours.set(n, created);
  return created;
};

Given('the check {int} ends with the exit code {int}', function (n: number, code: number) {
  checkBehaviour(step(this), n).exitCode = code;
});

Given('the check {int} ends on a signal, with no exit code', function (n: number) {
  checkBehaviour(step(this), n).exitCode = null;
});

Given('the check {int} is stopped by its limit', function (n: number) {
  const own = checkBehaviour(step(this), n);
  own.exitCode = null;
  own.stopped = true;
});

Given('the check {int} prints {string}', function (n: number, output: string) {
  checkBehaviour(step(this), n).output = JSON.parse(`"${output}"`);
});

Given('the check {int} cuts its output', function (n: number) {
  checkBehaviour(step(this), n).cut = true;
});

Given('the check {int} lasts {int} milliseconds', function (n: number, ms: number) {
  checkBehaviour(step(this), n).durationMs = ms;
});

Given('the check {int} is held until I end it', function (n: number) {
  checkBehaviour(step(this), n).held = true;
});

Given(
  'the check {int} fails with the sandbox error {string} {string}',
  function (n: number, code: string, message: string) {
    checkBehaviour(step(this), n).failure = new SandboxError(code as 'ISOLATION_UNAVAILABLE', message);
  },
);

Given('the step folder holds the questions of the scouts {string}', function (names: string) {
  for (const name of names.split(' ')) {
    writeFileSync(join(step(this).folder, `scout.${name}.md`), `Question of ${name}.\n`);
  }
});

Given('the worktree of the step holds the file {string}:', function (path: string, content: string) {
  step(this).source.set(path, content);
});

Given('the build session writes the fixture {string}', function (name: string) {
  step(this).behaviours['code.json'].fixture = name;
});

Given('the review session writes the fixture {string}', function (name: string) {
  step(this).behaviours['review.json'].fixture = name;
});

Given('the build session is stopped by its limit', function () {
  step(this).behaviours['code.json'].stopped = true;
});

Given(
  'the build session fails with the sandbox error {string} {string}',
  function (code: string, message: string) {
    step(this).behaviours['code.json'].failure = new SandboxError(code as 'ISOLATION_UNAVAILABLE', message);
  },
);

Given('the build session fails with the plain error {string}', function (message: string) {
  step(this).behaviours['code.json'].failure = new Error(message);
});

const start = (s: Step, args: string): Promise<void> => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (chunk: Buffer) => (s.stdout += chunk.toString()));
  stderr.on('data', (chunk: Buffer) => (s.stderr += chunk.toString()));
  const deps: StepDependencies = {
    folderArguments: args === '' ? [] : args.split(' ').map((arg) => arg.replace('<folder>', s.folder)),
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    readSource: (path) => s.source.get(path),
    writeFile: (path, content) => writeFileSync(path, content),
    appendFile: (path, content) => writeFileSync(path, content, { flag: 'a' }),
    check: async (command, limitSeconds) => {
      s.checkCalls.push({ command, limitSeconds });
      const n = s.checkCalls.length;
      const own = s.checks.behaviours.get(n) ?? {};
      gate(s.checks.started, n).resolve();
      if (own.held) await gate(s.checks.ended, n).promise;
      if (own.failure) throw own.failure;
      s.clock += own.durationMs ?? 0;
      return {
        exitCode: own.exitCode === undefined ? 0 : own.exitCode,
        stopped: own.stopped ?? false,
        output: own.output ?? '',
        cut: own.cut ?? false,
      };
    },
    now: () => s.clock,
    session: async (tool, argv, brief, limitSeconds, onOutput) => {
      s.calls.push({ tool, argv, brief, limitSeconds });
      const phase = tool === 'code.json' ? undefined : s.phases[tool];
      const n = s.calls.filter((call) => call.tool === tool).length;
      const own = { ...s.behaviours[tool], ...phase?.behaviours.get(n) };
      if (phase !== undefined) {
        phase.runningWhenStarted.push(phase.running);
        phase.running++;
        phase.maxRunning = Math.max(phase.maxRunning, phase.running);
        gate(phase.started, n).resolve();
      }
      try {
        if (own.held) await gate((phase as Phase).ended, n).promise;
        if (own.failure) throw own.failure;
        const text = own.fixture === undefined ? '' : fixture(own.fixture);
        // In two chunks, as a stream arrives.
        onOutput(Buffer.from(text.slice(0, 10)));
        onOutput(Buffer.from(text.slice(10)));
        return { exitCode: 0, stopped: own.stopped ?? false };
      } finally {
        if (phase !== undefined) phase.running--;
      }
    },
    stdout,
    stderr,
  };
  s.run = runStep(deps).then((code) => {
    s.code = code;
    s.finished = true;
  });
  return s.run;
};

When('I run the step with the arguments {string}', async function (args: string) {
  await start(step(this), args);
  await turn();
});

When('I start the step with the arguments {string}', function (args: string) {
  void start(step(this), args);
});

When('I wait for the step to finish', async function () {
  await step(this).run;
  await turn();
});

When('I end the review session {int}', function (n: number) {
  gate(step(this).phases['review.json'].ended, n).resolve();
});

When('I wait for the review session {int} to start', async function (n: number) {
  await gate(step(this).phases['review.json'].started, n).promise;
  await turn();
});

When('I end the check {int}', function (n: number) {
  gate(step(this).checks.ended, n).resolve();
});

When('I wait for the check {int} to start', async function (n: number) {
  await gate(step(this).checks.started, n).promise;
  await turn();
});

When('I end the scout session {int}', function (n: number) {
  gate(step(this).phases['scout.json'].ended, n).resolve();
});

When('I wait for the scout session {int} to start', async function (n: number) {
  await gate(step(this).phases['scout.json'].started, n).promise;
  await turn();
});

Then('the checks started were {string}', function (commands: string) {
  assert.equal(
    step(this)
      .checkCalls.map((call) => call.command.join(' '))
      .join(', '),
    commands,
  );
});

Then('no check was started', function () {
  assert.deepEqual(step(this).checkCalls, []);
});

Then(
  'the check {int} was started with the argv {string} and the limit {int}',
  function (n: number, argv: string, limit: number) {
    const call = step(this).checkCalls[n - 1];
    assert.equal(call?.command.join(' '), argv);
    assert.equal(call.limitSeconds, limit);
  },
);

Then('the step is still running', function () {
  assert.equal(step(this).finished, false);
});

Then('the review sessions saw {string} review sessions running when they started', function (counts: string) {
  assert.equal(step(this).phases['review.json'].runningWhenStarted.join(' '), counts);
});

Then('at most {int} review sessions ran at the same time', function (count: number) {
  assert.equal(step(this).phases['review.json'].maxRunning, count);
});

Then('the scout sessions saw {string} scout sessions running when they started', function (counts: string) {
  assert.equal(step(this).phases['scout.json'].runningWhenStarted.join(' '), counts);
});

Then('at most {int} scout sessions ran at the same time', function (count: number) {
  assert.equal(step(this).phases['scout.json'].maxRunning, count);
});

Then('the scout sessions started with the models {string}', function (models: string) {
  const asked = step(this)
    .calls.filter((call) => call.tool === 'scout.json')
    .map((call) => call.argv[call.argv.indexOf('--model') + 1]);
  assert.equal(asked.join(' '), models);
});

Then('the review sessions started with the models {string}', function (models: string) {
  const asked = step(this)
    .calls.filter((call) => call.tool === 'review.json')
    .map((call) => call.argv[call.argv.indexOf('--model') + 1]);
  assert.equal(asked.join(' '), models);
});

const here = (s: Step, text: string) => text.replaceAll('<folder>', s.folder);

Then('the step exits with {int}', function (code: number) {
  assert.equal(step(this).code, code);
});

Then('the step stderr is {string}', function (text: string) {
  const s = step(this);
  assert.equal(s.stderr, `${here(s, text)}\n`);
});

Then('the step stderr is empty', function () {
  assert.equal(step(this).stderr, '');
});

Then('the step stdout is empty', function () {
  assert.equal(step(this).stdout, '');
});

Then('the step stdout is the line:', function (text: string) {
  assert.equal(step(this).stdout, `${text}\n`);
});

Then('no session was started', function () {
  assert.deepEqual(step(this).calls, []);
});

Then('the sessions started were {string}', function (tools: string) {
  assert.equal(
    step(this)
      .calls.map((call) => call.tool)
      .join(' '),
    tools,
  );
});

Then('the session {int} got exactly the brief:', function (n: number, brief: string) {
  assert.equal(step(this).calls[n - 1]?.brief, `${brief}\n`);
});

Then(
  'the session {int} got the brief {string} and the limit {int}',
  function (n: number, brief: string, limit: number) {
    const call = step(this).calls[n - 1];
    assert.equal(call?.brief, brief.replaceAll('\\n', '\n'));
    assert.equal(call.limitSeconds, limit);
  },
);

Then('the session {int} got exactly the arguments {string}', function (n: number, args: string) {
  assert.deepEqual(step(this).calls[n - 1]?.argv, args.split(' '));
});

Then(
  'the session {int} got the arguments {string} and then the draft-07 schema of the verdict',
  function (n: number, args: string) {
    const argv = step(this).calls[n - 1]?.argv ?? [];
    assert.deepEqual(argv.slice(0, -1), args.split(' '));
    const schema: unknown = JSON.parse(argv.at(-1) as string);
    const committed: unknown = JSON.parse(
      readFileSync(join(PKG, 'prompts', 'review-verdict.schema.json'), 'utf8'),
    );
    assert.deepEqual(schema, committed);
    assert.equal((schema as Record<string, unknown>)['$schema'], 'http://json-schema.org/draft-07/schema#');
  },
);

Then(
  'the session {int} got the arguments {string} and then the draft-07 schema of the facts',
  function (n: number, args: string) {
    const argv = step(this).calls[n - 1]?.argv ?? [];
    assert.deepEqual(argv.slice(0, -1), args.split(' '));
    const schema = JSON.parse(argv.at(-1) as string) as Record<string, any>;
    assert.equal(schema['$schema'], 'http://json-schema.org/draft-07/schema#');
    assert.deepEqual(schema, JSON.parse(factsJsonSchema()));
    assert.equal(schema['properties']['facts']['maxItems'], 40);
  },
);

Then('the step file {string} is the same as the step file {string}', function (name: string, other: string) {
  assert.equal(
    readFileSync(join(step(this).folder, name), 'utf8'),
    readFileSync(join(step(this).folder, other), 'utf8'),
  );
});

Then('the step file {string} is the brief of the session {int}', function (name: string, n: number) {
  assert.equal(readFileSync(join(step(this).folder, name), 'utf8'), step(this).calls[n - 1]?.brief);
});

Then('the step file {string} is the fixture {string}', function (name: string, file: string) {
  assert.equal(readFileSync(join(step(this).folder, name), 'utf8'), fixture(file));
});

Then('the step file {string} is:', function (name: string, content: string) {
  assert.equal(readFileSync(join(step(this).folder, name), 'utf8'), `${content}\n`);
});

Then('the step file {string} is exactly {string}', function (name: string, content: string) {
  assert.equal(readFileSync(join(step(this).folder, name), 'utf8'), content);
});

Given(
  'the step folder holds the file {string} with the escaped content {string}',
  function (name: string, content: string) {
    writeFileSync(join(step(this).folder, name), JSON.parse(`"${content}"`));
  },
);

Then('the step file {string} contains {string}', function (name: string, text: string) {
  assert.ok(readFileSync(join(step(this).folder, name), 'utf8').includes(text));
});

Then('the step file {string} does not contain {string}', function (name: string, text: string) {
  assert.ok(!readFileSync(join(step(this).folder, name), 'utf8').includes(text));
});

Then('the brief of the session {int} does not contain {string}', function (n: number, text: string) {
  assert.ok(!(step(this).calls[n - 1]?.brief ?? '').includes(text));
});

Then('the step folder has no file {string}', function (name: string) {
  assert.equal(existsSync(join(step(this).folder, name)), false);
});

// --- codeToolSession ----------------------------------------------------------------------------------------

interface Real {
  received?: CodeToolDependencies;
  stdin: string;
  output: string[];
  tool?: string;
  scheduled: { fire: () => void; ms: number }[];
  cancelled: number;
  fires: boolean;
  handScheduled: boolean;
  result?: { exitCode: number; stopped: boolean };
}
const real = (world: SandboxWorld) => stored<Real>(world, 'realSession');

Given('a step session over a fake code tool, whose limit is scheduled by hand', function () {
  this.state['realSession'] = {
    stdin: '',
    output: [],
    scheduled: [],
    cancelled: 0,
    fires: false,
    handScheduled: true,
  };
});

Given('a step session over a fake code tool, whose limit is the real timer, faked', function () {
  this.state['realSession'] = {
    stdin: '',
    output: [],
    scheduled: [],
    cancelled: 0,
    fires: false,
    handScheduled: false,
  };
  mock.timers.enable({ apis: ['setTimeout'] });
  this.cleanups.push(() => mock.timers.reset());
});

Given('the fake code tool fires the limit', function () {
  real(this).fires = true;
});

When(
  'the step session runs {string} with the arguments {string} and the brief {string} and the limit of {int} seconds',
  async function (tool: string, args: string, brief: string, seconds: number) {
    const r = real(this);
    const base = {
      cwd: '/work',
      stderr: new PassThrough(),
      ...(r.handScheduled
        ? {
            schedule: (fire: () => void, ms: number) => {
              r.scheduled.push({ fire, ms });
              return () => void r.cancelled++;
            },
          }
        : {}),
    } as unknown as CodeToolDependencies;
    const session = codeToolSession(
      (file) => {
        r.tool = file;
        return base;
      },
      async (deps) => {
        r.received = deps;
        const chunks: string[] = [];
        for await (const chunk of deps.stdin) chunks.push(String(chunk));
        r.stdin = chunks.join('');
        deps.stdout.write('one');
        deps.stdout.write('two');
        const cancel = deps.schedule!(() => void r.output.push('stopped'), deps.limitMs!);
        if (r.fires) {
          if (r.handScheduled) r.scheduled[0]!.fire();
          else mock.timers.tick(deps.limitMs!);
        }
        cancel();
        // A cancelled timer does not fire.
        if (!r.handScheduled) mock.timers.tick(deps.limitMs!);
        return 7;
      },
    );
    r.result = await session(tool as 'code.json', args.split(' '), brief, seconds, (chunk) =>
      r.output.push(Buffer.from(chunk).toString()),
    );
  },
);

Then('the fake code tool got the tool file {string}', function (tool: string) {
  assert.equal(real(this).tool, tool);
});

Then(
  'the fake code tool ran piped in the base directory with the arguments {string}',
  function (args: string) {
    const { received } = real(this);
    assert.equal(received?.terminal, false);
    assert.equal(received.cwd, '/work');
    assert.deepEqual(received.argv, args.split(' '));
  },
);

Then(
  'the fake code tool read the brief {string} and the limit is {int} milliseconds',
  function (brief: string, ms: number) {
    assert.equal(real(this).stdin, brief);
    assert.equal(real(this).received?.limitMs, ms);
  },
);

Then('the step session output is {string}', function (output: string) {
  assert.equal(real(this).output.join(','), output);
});

Then(
  'the step session result is the exit code {int} and stopped {string}',
  function (code: number, stopped: string) {
    assert.deepEqual(real(this).result, { exitCode: code, stopped: stopped === 'true' });
  },
);

Then(
  'the hand-scheduled limit was for {int} milliseconds and was cancelled {int} time',
  function (ms: number, count: number) {
    const r = real(this);
    assert.deepEqual(
      r.scheduled.map((limit) => limit.ms),
      [ms],
    );
    assert.equal(r.cancelled, count);
  },
);

// --- stepDependencies ---------------------------------------------------------------------------------------

When('I build the step dependencies of a process with the arguments {string}', function (args: string) {
  const proc = {
    argv: args.split(' '),
    env: {},
    cwd: () => '/elsewhere',
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  } as unknown as CodeProcess;
  this.state['stepDeps'] = { deps: stepDependencies(proc), proc };
});

Then(
  'the step dependencies read the folder arguments {string} and the streams of the process',
  function (args: string) {
    const { deps, proc } = stored<{ deps: StepDependencies; proc: CodeProcess }>(this, 'stepDeps');
    assert.deepEqual(deps.folderArguments, args.split(' '));
    assert.equal(deps.stdout, proc.stdout);
    assert.equal(deps.stderr, proc.stderr);
  },
);

Then(
  'the step dependencies write, append and read files of a folder, and read a missing one as undefined',
  function () {
    const { deps } = stored<{ deps: StepDependencies }>(this, 'stepDeps');
    const folder = mkdtempSync(join(tmpdir(), 'aos-step-'));
    this.cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const file = join(folder, 'f.txt');
    deps.writeFile(file, 'ab');
    deps.appendFile(file, Buffer.from('cd'));
    assert.equal(deps.readFile(file), 'abcd');
    assert.equal(deps.readFile(join(folder, 'missing')), undefined);
    mkdirSync(join(folder, 'dir'));
    assert.equal(deps.readFile(join(folder, 'dir')), undefined);
  },
);

Then('the step dependencies session is a function', function () {
  const { deps } = stored<{ deps: StepDependencies }>(this, 'stepDeps');
  assert.equal(typeof deps.session, 'function');
});

Then('the step dependencies clock is the time of the host in milliseconds', function () {
  const { deps } = stored<{ deps: StepDependencies }>(this, 'stepDeps');
  const before = Date.now();
  const now = deps.now();
  assert.ok(now >= before && now <= Date.now());
});

When(
  'I build the step dependencies of a process whose INIT_CWD is a folder that is not a worktree',
  function () {
    const folder = mkdtempSync(join(tmpdir(), 'aos-step-'));
    this.cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const proc = {
      argv: ['node', 'step.ts', '/a/b'],
      env: { INIT_CWD: folder },
      cwd: () => '/elsewhere',
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    } as unknown as CodeProcess;
    this.state['stepDeps'] = { deps: stepDependencies(proc), proc };
  },
);

Then(
  'the real check of the step dependencies is refused by the real runner, before any process',
  async function () {
    const { deps } = stored<{ deps: StepDependencies }>(this, 'stepDeps');
    // The real runner loads the profile `checker` first (a wrong name is PROFILE_INVALID), then makes its folder (refused
    // as ISOLATION_UNAVAILABLE where the temporary directory is too long for a Unix socket), then resolves the folder
    // INIT_CWD names: a folder that is no worktree is NOT_A_WORKTREE, while `/elsewhere`, the cwd of the process, does not
    // exist and would be a plain ENOENT. Either refusal is a SandboxError, before any process.
    await assert.rejects(
      () => deps.check(['true'], 1),
      (error: unknown) =>
        error instanceof SandboxError && ['NOT_A_WORKTREE', 'ISOLATION_UNAVAILABLE'].includes(error.code),
    );
  },
);
Then(
  'the tool dependencies of a process for {string} describe the tool {string} in {string}',
  function (file: string, profile: string, cwd: string) {
    const proc = {
      argv: ['node', 'step.ts'],
      env: { INIT_CWD: cwd },
      cwd: () => '/elsewhere',
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    } as unknown as CodeProcess;
    const deps = toolDependencies(proc)(file as 'code.json');
    assert.equal(deps.tool.profile, profile);
    assert.equal(deps.cwd, cwd);
  },
);

// --- readSource, the real one ---------------------------------------------------------------------------------

Given('a worktree folder with a file, a directory, a link inside and links outside', function () {
  const root = mkdtempSync(join(tmpdir(), 'aos-source-'));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree');
  mkdirSync(join(worktree, 'src'), { recursive: true });
  writeFileSync(join(worktree, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'outside.txt'), 'secret\n');
  mkdirSync(join(root, 'outside-dir'));
  writeFileSync(join(root, 'outside-dir', 'b.txt'), 'secret\n');
  // A sibling whose name begins with the name of the worktree is not inside it.
  mkdirSync(join(root, 'worktree-sibling'));
  writeFileSync(join(root, 'worktree-sibling', 's.txt'), 'secret\n');
  symlinkSync('src/a.ts', join(worktree, 'link-in.ts'));
  symlinkSync(join(root, 'outside.txt'), join(worktree, 'link-out.txt'));
  symlinkSync(join(root, 'outside-dir'), join(worktree, 'link-out-dir'));
  symlinkSync('missing.txt', join(worktree, 'link-dangling.txt'));
  // A file this process may not read is not a source.
  writeFileSync(join(worktree, 'locked.txt'), 'secret\n');
  chmodSync(join(worktree, 'locked.txt'), 0o000);
  // The worktree reached through a link: its real path is what a file is compared with.
  symlinkSync(worktree, join(root, 'worktree-link'));
  this.state['worktree'] = worktree;
});

When(
  'I build the step dependencies of a process running in that worktree, which it names by {string}',
  function (how: string) {
    const worktree = stored<string>(this, 'worktree');
    const proc = {
      argv: ['node', 'step.ts', '/a/b'],
      env: how === 'INIT_CWD' ? { INIT_CWD: worktree } : {},
      cwd: () =>
        how === 'INIT_CWD'
          ? '/elsewhere'
          : how === 'a link'
            ? join(worktree, '..', 'worktree-link')
            : worktree,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    } as unknown as CodeProcess;
    this.state['stepDeps'] = { deps: stepDependencies(proc), proc };
  },
);

Then('the step dependencies read the source {string} as {string}', function (path: string, text: string) {
  const { deps } = stored<{ deps: StepDependencies }>(this, 'stepDeps');
  assert.equal(deps.readSource(path), text.replaceAll('\\n', '\n'));
});

Then('the step dependencies read the source {string} as undefined', function (path: string) {
  const { deps } = stored<{ deps: StepDependencies }>(this, 'stepDeps');
  assert.equal(deps.readSource(path), undefined);
});
