import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { PassThrough } from 'node:stream';
import type { CodeProcess, CodeToolDependencies } from '../../src/code-tool.js';
import { SandboxError } from '../../src/port.js';
import {
  codeToolSession,
  runStep,
  stepDependencies,
  toolDependencies,
  type StepDependencies,
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
}
interface Step {
  folder: string;
  calls: Call[];
  behaviours: Record<'code.json' | 'review.json', Behaviour>;
  stdout: string;
  stderr: string;
  code?: number;
}
const step = (world: SandboxWorld) => stored<Step>(world, 'step');
const fixture = (name: string) => readFileSync(join(PKG, 'fixtures', name), 'utf8');

Given('a step folder', function () {
  const folder = mkdtempSync(join(tmpdir(), 'aos-step-'));
  this.cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  this.state['step'] = {
    folder,
    calls: [],
    behaviours: { 'code.json': {}, 'review.json': {} },
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

const STEP_JSON = (review: boolean) =>
  JSON.stringify({
    build: { model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 2400 },
    ...(review ? { review: { model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 } } : {}),
  });

Given('the step folder holds a step.json with a build and {string}', function (review: string) {
  writeFileSync(join(step(this).folder, 'step.json'), STEP_JSON(review === 'a review'));
  writeFileSync(join(step(this).folder, 'brief.md'), 'Build the thing.\n');
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

When('I run the step with the arguments {string}', async function (args: string) {
  const s = step(this);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (chunk: Buffer) => (s.stdout += chunk.toString()));
  stderr.on('data', (chunk: Buffer) => (s.stderr += chunk.toString()));
  const deps: StepDependencies = {
    folderArguments: args === '' ? [] : args.split(' ').map((arg) => arg.replace('<folder>', s.folder)),
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    writeFile: (path, content) => writeFileSync(path, content),
    appendFile: (path, content) => writeFileSync(path, content, { flag: 'a' }),
    session: async (tool, argv, brief, limitSeconds, onOutput) => {
      s.calls.push({ tool, argv, brief, limitSeconds });
      const behaviour = s.behaviours[tool];
      if (behaviour.failure) throw behaviour.failure;
      const text = behaviour.fixture === undefined ? '' : fixture(behaviour.fixture);
      // In two chunks, as a stream arrives.
      onOutput(Buffer.from(text.slice(0, 10)));
      onOutput(Buffer.from(text.slice(10)));
      return { exitCode: 0, stopped: behaviour.stopped ?? false };
    },
    stdout,
    stderr,
  };
  s.code = await runStep(deps);
  await new Promise((resolve) => setImmediate(resolve));
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

Then('the step file {string} is the fixture {string}', function (name: string, file: string) {
  assert.equal(readFileSync(join(step(this).folder, name), 'utf8'), fixture(file));
});

Then('the step file {string} is:', function (name: string, content: string) {
  assert.equal(readFileSync(join(step(this).folder, name), 'utf8'), `${content}\n`);
});

Then('the step file {string} is exactly {string}', function (name: string, content: string) {
  assert.equal(readFileSync(join(step(this).folder, name), 'utf8'), content);
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
