import { measureSession } from '../../src/measure.js';
import { ClaudeBuilder, type Builder } from '../../src/builder.js';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os, { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { mock } from 'node:test';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import {
  processDependencies,
  srtOptions,
  type CodeProcess,
  type CodeToolDependencies,
} from '../../src/code-tool.js';
import { SandboxError } from '../../src/port.js';
import {
  freezeStepLauncher,
  requireStepAdmission,
  stepAdmissionAuthority,
} from '../../src/step-admission.js';
import { admittedFixture } from './admission-fixture.js';
import { factsJsonSchema } from '../../src/scout-facts.js';
import { stepRecordSchema } from '../../src/step-record.js';
import { stepsFolder } from '../../src/steps-folder.js';
import { repoOf } from './runner.js';
import { parseRoutedPolicy, parseStepFile, routedStep } from '../../src/step-file.js';
import { parseRoutingTable } from '../../src/routing.js';
import type { BuildRequest } from '../../src/builder.js';
import type { TreeFingerprint } from '../../src/tree-fingerprint.js';
import {
  codeToolSession,
  launcherFiles,
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
  nativeExit?: number;
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
  fixtureBuilder?: Builder;
  /** The routing table the launcher holds, when it is not the committed one. */
  launcherRouting?: string;
  /** What the build session of each pass does, by its rank (1 is the first pass). */
  buildPasses: Map<number, Behaviour>;
  /** The role whose specimen the admission evidence lacks. */
  droppedSpecimen?: string;
  /** Builds for OpenAI are answered by a native receipt, Claude builds by the code tool. */
  openaiBuilds?: boolean;
  refusedAdmission?: string;
  acceptedAdmission?: string;
  folder: string;
  outputs: { retained: string; streams: string };
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
  /** What the step published, by step name, and the names that already have a folder in `steps/`. */
  published: Map<string, Record<string, string>>;
  taken: Set<string>;
  /** The count of sessions started when the folder steps/ was prepared, once per call. */
  prepared: number[];
  /** The error the root of the worktree throws, when the step is not launched from it. */
  rootRefusal?: Error;
  /** The fingerprint of the worktree, or the error its computation throws, and how many times it was asked. */
  fingerprint: TreeFingerprint | Error;
  fingerprints: number;
  date: Date;
  publication?: Error;
  /** The files of the launcher that the step cannot read. */
  missing: Set<string>;
  /** The files that the build session rewrites in the step folder while it runs. */
  rewrites: { file: string; content: string }[];
  finished: boolean;
  run?: Promise<void>;
  stdout: string;
  stderr: string;
  code?: number;
}
/**
 * A builder for a routed Step whose ladder crosses providers: an OpenAI build returns a native receipt of its model and
 * counts as a build call, so that the behaviour of each pass is found by its rank; a Claude build goes to the code tool.
 */
const mixedBuilder = (s: Step, claude: Builder): Builder => ({
  build: async (request: BuildRequest) => {
    if (request.config.provider !== 'openai') return claude.build(request);
    const { model, effort, limitSeconds } = request.config;
    s.calls.push({
      tool: 'code.json',
      argv: ['--model', model, '--effort', effort],
      brief: request.brief,
      limitSeconds,
    });
    const own = s.buildPasses.get(s.calls.filter((call) => call.tool === 'code.json').length) ?? {};
    const exitCode = own.nativeExit ?? 0;
    const stopped = own.stopped ?? false;
    const completed = exitCode === 0 && !stopped;
    return {
      provider: 'openai',
      exitCode,
      stopped,
      measure: { ...measureSession(''), completed, inputTokens: 4, outputTokens: 3 },
      client: { version: 'codex-cli 0.170.0', sha256: 'd'.repeat(64) },
      receipts: [
        {
          model,
          request: 1,
          terminal: completed ? 'completed' : 'interrupted',
          inputTokens: 4,
          outputTokens: 3,
        },
      ],
    };
  },
});
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

const newStepFolder = (world: SandboxWorld, name: string) => {
  const parent = mkdtempSync(join(tmpdir(), 'aos-step-'));
  world.cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const folder = join(parent, name);
  mkdirSync(folder);
  world.state['step'] = {
    folder,
    outputs: { retained: join(parent, 'retained-output'), streams: join(parent, 'raw-streams') },
    calls: [],
    behaviours: { 'code.json': {}, 'review.json': {}, 'scout.json': {} },
    buildPasses: new Map(),
    phases: { 'scout.json': newPhase(), 'review.json': newPhase() },
    checks: newPhase(),
    checkCalls: [],
    clock: 0,
    source: new Map(),
    published: new Map(),
    taken: new Set(),
    prepared: [],
    fingerprint: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true },
    fingerprints: 0,
    date: new Date('2026-11-18T09:30:00.000Z'),
    rewrites: [],
    missing: new Set(),
    finished: false,
    stdout: '',
    stderr: '',
  } satisfies Step;
};

Given('a step folder', function () {
  newStepFolder(this, 'demo');
});

Given('a step folder named {string}', function (name: string) {
  newStepFolder(this, name);
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
  writeStep(step(this), review === 'a review' ? [{ name: 'quality', model: 'claude-opus-5-5' }] : []);
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

Given('the build session exits with {int}', function (code: number) {
  step(this).behaviours['code.json'].nativeExit = code;
});

Given('the scout session {int} exits with {int}', function (n: number, code: number) {
  behaviour(step(this), 'scout.json', n).nativeExit = code;
});

Given('the review session {int} exits with {int}', function (n: number, code: number) {
  behaviour(step(this), 'review.json', n).nativeExit = code;
});

Given('the review session {int} is stopped by its limit', function (n: number) {
  behaviour(step(this), 'review.json', n).stopped = true;
});

/** The files of the launcher as the scenarios see them: the three tool files as committed, the others fixed. */
const launcherFile =
  (s: Step) =>
  (file: string): string => {
    if (s.missing.has(file)) throw new Error(`missing launcher file ${file}`);
    if (file === 'routing.json') return s.launcherRouting ?? readFileSync(join(PKG, file), 'utf8');
    return /^(code|review|scout)\.json$/.test(file) ? readFileSync(join(PKG, file), 'utf8') : `fixed:${file}`;
  };

Given('the step has {string} admission evidence', function (reason: string) {
  step(this).refusedAdmission = reason;
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
    reserveOutputs: () => {
      mkdirSync(s.outputs.retained);
      mkdirSync(s.outputs.streams);
      return s.outputs;
    },
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
    date: () => s.date,
    root: () => {
      if (s.rootRefusal !== undefined) throw s.rootRefusal;
      return '/the/worktree';
    },
    fingerprint: () => {
      s.fingerprints++;
      if (s.fingerprint instanceof Error) throw s.fingerprint;
      return s.fingerprint;
    },
    readLauncher: launcherFile(s),
    admit: (subject) => {
      const evidence = admittedFixture(subject);
      if (s.refusedAdmission === 'missing') return requireStepAdmission(undefined, subject);
      if (s.refusedAdmission === 'missing approval') {
        const { approval: _approval, ...payload } = evidence.payload;
        return requireStepAdmission({ ...evidence, payload }, subject);
      }
      if (s.droppedSpecimen !== undefined) {
        evidence.payload.specimens = evidence.payload.specimens.filter(
          ({ role }) => role !== s.droppedSpecimen,
        );
        evidence.approved_sha256 = createHash('sha256')
          .update(JSON.stringify(evidence.payload))
          .digest('hex');
      }
      if (s.refusedAdmission === 'stale') evidence.payload.inputs_sha256['brief.md'] = 'a'.repeat(64);
      if (s.refusedAdmission === 'failed specimen') {
        evidence.payload.specimens[0]!.results[0]!.observed = { verdict: 'refuse', findings: [] };
        evidence.approved_sha256 = createHash('sha256')
          .update(JSON.stringify(evidence.payload))
          .digest('hex');
      }
      s.acceptedAdmission = requireStepAdmission(evidence, subject);
      return s.acceptedAdmission;
    },
    steps: {
      prepare: () => void s.prepared.push(s.calls.length),
      exists: (name) => s.taken.has(name),
      publish: (name, files) => {
        if (s.publication !== undefined) throw s.publication;
        s.published.set(name, { ...files });
      },
    },
    builder:
      s.fixtureBuilder ??
      (s.openaiBuilds
        ? mixedBuilder(s, new ClaudeBuilder((...args) => deps.session(...args)))
        : new ClaudeBuilder((...args) => deps.session(...args))),
    session: async (tool, argv, brief, limitSeconds, onOutput) => {
      s.calls.push({ tool, argv, brief, limitSeconds });
      const phase = tool === 'code.json' ? undefined : s.phases[tool];
      const n = s.calls.filter((call) => call.tool === tool).length;
      const own = {
        ...s.behaviours[tool],
        ...phase?.behaviours.get(n),
        ...(tool === 'code.json' ? s.buildPasses.get(n) : {}),
      };
      if (phase !== undefined) {
        phase.runningWhenStarted.push(phase.running);
        phase.running++;
        phase.maxRunning = Math.max(phase.maxRunning, phase.running);
        gate(phase.started, n).resolve();
      }
      try {
        if (own.held) await gate((phase as Phase).ended, n).promise;
        if (own.failure) throw own.failure;
        if (tool === 'code.json') {
          for (const { file, content } of s.rewrites) writeFileSync(join(s.folder, file), content);
        }
        const text = own.fixture === undefined ? '' : fixture(own.fixture);
        // In two chunks, as a stream arrives.
        onOutput(Buffer.from(text.slice(0, 10)));
        onOutput(Buffer.from(text.slice(10)));
        return { exitCode: own.nativeExit ?? 0, stopped: own.stopped ?? false };
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

async function awaitPhaseStart(s: Step, phase: Phase, n: number): Promise<void> {
  assert.ok(s.run);
  const started = await Promise.race([
    gate(phase.started, n).promise.then(() => true),
    s.run.then(() => false),
  ]);
  assert.ok(started, 'Step finished before the expected phase started: ' + s.stderr);
  await turn();
}

When('I wait for the review session {int} to start', async function (n: number) {
  const s = step(this);
  await awaitPhaseStart(s, s.phases['review.json'], n);
});

When('I end the check {int}', function (n: number) {
  gate(step(this).checks.ended, n).resolve();
});

When('I wait for the check {int} to start', async function (n: number) {
  const s = step(this);
  await awaitPhaseStart(s, s.checks, n);
});

When('I end the scout session {int}', function (n: number) {
  gate(step(this).phases['scout.json'].ended, n).resolve();
});

When('I wait for the scout session {int} to start', async function (n: number) {
  const s = step(this);
  await awaitPhaseStart(s, s.phases['scout.json'], n);
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

function stepFile(s: Step, name: string): string {
  if (name === 'brief.md') return join(s.folder, name);
  return join(name.endsWith('.stream.jsonl') ? s.outputs.streams : s.outputs.retained, name);
}

Then('the approved Step intake still matches the Plan manifest byte for byte', function () {
  const { folder } = step(this);
  const { files_sha256: expected } = stored<{ files_sha256: Record<string, string> }>(this, 'planManifest');
  assert.deepEqual(readdirSync(folder).sort(), Object.keys(expected).sort());
  for (const [file, digest] of Object.entries(expected)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join(folder, file)))
        .digest('hex'),
      digest,
    );
  }
});

Then('the step file {string} is the same as the step file {string}', function (name: string, other: string) {
  assert.equal(
    readFileSync(stepFile(step(this), name), 'utf8'),
    readFileSync(stepFile(step(this), other), 'utf8'),
  );
});

Then('the step file {string} is the brief of the session {int}', function (name: string, n: number) {
  assert.equal(readFileSync(stepFile(step(this), name), 'utf8'), step(this).calls[n - 1]?.brief);
});

Then('the step file {string} is the fixture {string}', function (name: string, file: string) {
  assert.equal(readFileSync(stepFile(step(this), name), 'utf8'), fixture(file));
});

Then('the step file {string} is:', function (name: string, content: string) {
  assert.equal(readFileSync(stepFile(step(this), name), 'utf8'), `${content}\n`);
});

Then('the step file {string} is exactly {string}', function (name: string, content: string) {
  assert.equal(readFileSync(stepFile(step(this), name), 'utf8'), content);
});

Then('the retained measure {string} includes:', function (name: string, fields: string) {
  const measure = JSON.parse(readFileSync(stepFile(step(this), name), 'utf8')) as Record<string, unknown>;
  for (const [key, expected] of Object.entries(JSON.parse(fields) as Record<string, unknown>)) {
    assert.deepEqual(measure[key], expected, key);
  }
});

Then(
  'the step summary lists outcome {string} and the session {string} includes:',
  function (outcome: string, path: string, fields: string) {
    const summary = JSON.parse(step(this).stdout);
    assert.equal(summary.outcome, outcome);
    const session = path.split('.').reduce((entry, key) => entry[key], summary);
    for (const [key, expected] of Object.entries(JSON.parse(fields))) {
      assert.deepEqual(session[key], expected, key);
    }
  },
);

Given(
  'the step folder holds the file {string} with the escaped content {string}',
  function (name: string, content: string) {
    writeFileSync(join(step(this).folder, name), JSON.parse(`"${content}"`));
  },
);

Then('the step file {string} contains {string}', function (name: string, text: string) {
  assert.ok(readFileSync(stepFile(step(this), name), 'utf8').includes(text));
});

Then('the step file {string} does not contain {string}', function (name: string, text: string) {
  assert.ok(!readFileSync(stepFile(step(this), name), 'utf8').includes(text));
});

Then('the brief of the session {int} does not contain {string}', function (n: number, text: string) {
  assert.ok(!(step(this).calls[n - 1]?.brief ?? '').includes(text));
});

Then('the step folder has no file {string}', function (name: string) {
  assert.equal(existsSync(stepFile(step(this), name)), false);
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
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.throws(() => deps.writeFile(file, 'replace'), { code: 'EEXIST' });
    assert.throws(() => deps.appendFile(join(folder, 'missing'), Buffer.from('x')), { code: 'ENOENT' });
    symlinkSync(file, join(folder, 'link'));
    assert.throws(() => deps.appendFile(join(folder, 'link'), Buffer.from('x')), { code: 'ELOOP' });
    const descriptors = readdirSync('/dev/fd');
    deps.appendFile(file, Buffer.from('cd'));
    assert.deepEqual(readdirSync('/dev/fd'), descriptors);
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

Then('the check port refuses to start a process without admitted launcher bytes', function () {
  const { deps } = stored<{ deps: StepDependencies }>(this, 'stepDeps');
  assert.throws(() => deps.check(['true'], 1), { message: 'STEP_ADMISSION_REQUIRED' });
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

Given('the step uses the materialized Plan folder', function () {
  const s = step(this);
  s.folder = stored<string>(this, 'planFolder');
});

Then('the Step record binds the two approved input files', function () {
  const expected = stored<{ step: string; files_sha256: Record<string, string> }>(this, 'planManifest');
  const archive = step(this).published.get(expected.step);
  assert.ok(archive);
  const record = stepRecordSchema().parse(JSON.parse(archive['record.json']!));
  assert.deepEqual(record.inputs, expected.files_sha256);
  assert.equal(record.admission_sha256, step(this).acceptedAdmission);
});

Then('the Step record preserves the approved tickets and builder model', function () {
  const expected = stored<{ step: string }>(this, 'planManifest');
  const state = step(this);
  const archive = state.published.get(expected.step);
  assert.ok(archive);
  const record = stepRecordSchema().parse(JSON.parse(archive['record.json']!));
  const approved = JSON.parse(readFileSync(join(state.folder, 'step.json'), 'utf8'));
  assert.deepEqual(Object(record).tickets, approved.tickets);
  assert.equal(record.sessions[0]?.model, 'operator-build');
});

Then('native launch reads the frozen launcher even after the original changes', function () {
  const target = mkdtempSync(join(tmpdir(), 'aos-freeze-target-'));
  const original = {
    'code.json': readFileSync(join(PKG, 'code.json'), 'utf8'),
    'prompts/build.md': 'Reviewed system prompt',
    'profiles/builder.json': 'Reviewed profile bytes',
  };
  const frozen = freezeStepLauncher(original, target);
  try {
    original['prompts/build.md'] = 'Modified system prompt';
    original['profiles/builder.json'] = 'Modified profile bytes';
    const native = processDependencies(process, () => false, 'code.json', frozen.dir);
    assert.equal(readFileSync(native.systemPrompt(), 'utf8'), 'Reviewed system prompt');
    const options = srtOptions(process, {}, frozen.dir);
    assert.equal(readFileSync(join(options.profilesDir, 'builder.json'), 'utf8'), 'Reviewed profile bytes');
    const manifest = join(PKG, '..', '..', 'package.json');
    assert.deepEqual(options.trusted, [PKG, frozen.dir, manifest, stepAdmissionAuthority()]);
    assert.deepEqual(srtOptions(process, {}).trusted, [PKG, manifest]);
    assert.equal(options.frozenLauncher, frozen.dir);
    assert.equal(srtOptions(process, {}).frozenLauncher, undefined);
  } finally {
    frozen.dispose();
    rmSync(target, { recursive: true });
  }
});

Then('the standalone code entry writes only its required Step diagnostic', async function () {
  const before = process.exitCode;
  let err = '';
  const write = mock.method(process.stderr, 'write', (chunk: string) => {
    err += chunk;
    return true;
  });
  try {
    await import('../../src/code.js');
    assert.equal(process.exitCode, 2);
    assert.equal(err, 'architect-os code: STEP_ADMISSION_REQUIRED. Start the approved Step instead.\n');
  } finally {
    write.mock.restore();
    process.exitCode = before;
  }
});

Then('an isolated Step host binds its fixture receipt and releases the snapshot', async function () {
  const { worktree } = repoOf(this);
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'step-host-fixture-')));
  this.cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const user = os.userInfo();
  const info = mock.method(os, 'userInfo', () => ({ ...user, homedir: home }));
  syncBuiltinESMExports();
  try {
    const authority = stepAdmissionAuthority();
    mkdirSync(authority, { recursive: true, mode: 0o700 });
    const receipt = join(authority, 'fixture.json');
    const proc = {
      ...process,
      env: { ...process.env, INIT_CWD: worktree, ARCHITECT_OS_STEP_EVIDENCE: receipt },
      cwd: () => worktree,
      argv: [],
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      stdin: new PassThrough(),
    };
    let notified = '',
      called = 0,
      receiptSnapshot = '';
    proc.stderr.on('data', (chunk) => {
      notified += chunk.toString();
    });
    const deps = stepDependencies(proc, async (build, snapshot, launcher, runtime) => {
      called++;
      assert.equal(build.brief, 'fixture task');
      assert.equal(launcher, PKG);
      assert.equal(runtime, process.env.ARCHITECT_OS_RUNTIME_ROOT);
      receiptSnapshot = snapshot;
      return {
        provider: 'openai',
        exitCode: 1,
        stopped: true,
        client: { version: 'fixture', sha256: 'd'.repeat(64) },
        measure: measureSession(''),
        receipts: [],
      };
    });
    const input = {
      config: {
        provider: 'openai' as const,
        model: 'gpt-6.2-sol' as const,
        effort: 'medium' as const,
        limitSeconds: 1,
      },
      worktree,
      brief: 'fixture task',
      systemPrompt: 'fixture',
      maxBytes: 255,
      onOutput: () => {},
    };

    const request = () => deps.session('never-launch.json' as ToolFile, [], '', 1, () => {});
    await assert.rejects(request, { message: 'STEP_ADMISSION_REQUIRED' });
    deps.dispose!();
    const step = parseStepFile({ build: { model: 'fixture', effort: 'low', limitSeconds: 1 }, reviews: [] });
    const subject = {
      name: 'fixture',
      worktree,
      step,
      tree: deps.fingerprint(),
      inputs: { 'brief.md': 'Fixture only.', 'step.json': JSON.stringify(step) },
      launcher: launcherFiles(deps.readLauncher, step),
    };
    const witness = admittedFixture(subject);
    writeFileSync(receipt, JSON.stringify(witness), { mode: 0o600 });
    const original = new Set(readdirSync(tmpdir()));
    assert.equal(deps.admit(subject), witness.approved_sha256);
    let frozen: string | undefined;
    try {
      await assert.rejects(request, (error: NodeJS.ErrnoException) => {
        assert.equal(error.code, 'ENOENT');
        frozen = dirname(error.path!);
        assert.equal(dirname(frozen), realpathSync(tmpdir()));
        assert.ok(!original.has(frozen.split('/').at(-1)!));
        assert.equal(readFileSync(join(frozen, 'code.json'), 'utf8'), subject.launcher['code.json']);
        return true;
      });
      assert.equal((await deps.builder.build(input)).provider, 'openai');
      assert.equal(called, 1);
      assert.equal(receiptSnapshot, frozen);
      assert.equal(notified, '');
      // This session has a checked launcher with a deliberately absent Claude tool file.
      const code = join(frozen!, 'code.json');
      fs.unlinkSync(code);
      await assert.rejects(
        deps.builder.build({ ...input, config: { model: 'fixture', effort: 'low', limitSeconds: 1 } }),
        (e: NodeJS.ErrnoException) => e.code === 'ENOENT' && e.path === code,
      );
      assert.equal(called, 1);
    } finally {
      deps.dispose!();
    }
    assert.ok(frozen);
    assert.equal(existsSync(frozen), false);
    let released = 0;
    await runStep({
      ...deps,
      folderArguments: [],
      dispose: () => {
        released++;
      },
    });
    assert.equal(released, 1);
  } finally {
    info.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('the production Step orchestrates the subscription fixture {string}', async function (kind: string) {
  newStepFolder(this, 'native');
  const s = step(this),
    model = 'gpt-6.2-astra',
    sha256 = 'd'.repeat(64);
  const config = { provider: 'openai', model, effort: 'high', limitSeconds: 90 };
  writeFileSync(
    join(s.folder, 'step.json'),
    JSON.stringify({
      build: config,
      checks: [{ name: 'patch', command: ['test', '-f', 'patch'], limitSeconds: 17 }],
      reviews: [{ name: 'correctness', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 30 }],
    }),
  );
  writeFileSync(join(s.folder, 'brief.md'), 'work');
  s.behaviours['review.json'] = { fixture: 'review-accept-proposal.jsonl' };
  const receipts = [{ model, request: 1, terminal: 'completed', inputTokens: 4, outputTokens: 3 }] as const;
  s.fixtureBuilder = {
    build: async (r) => {
      assert.deepEqual(r.config, config);
      assert.equal(r.worktree, '/the/worktree');
      assert.equal(r.brief, 'work');
      assert.equal(r.systemPrompt, 'fixed:prompts/build.md');
      assert.equal(r.maxBytes, 67108864);
      r.onOutput(Buffer.from('receipt'));
      return {
        provider: kind === 'mismatched provider' ? 'anthropic' : 'openai',
        exitCode: 0,
        stopped: false,
        measure: { ...measureSession(''), completed: true, inputTokens: 4, outputTokens: 3 },
        client: { version: 'codex-cli 0.170.0', sha256 },
        receipts,
      };
    },
  };
  await start(s, '<folder>');
  assert.equal(readFileSync(join(s.outputs.streams, 'build.stream.jsonl'), 'utf8'), 'receipt');
  if (kind === 'mismatched provider') {
    assert.notEqual(s.code, 0);
    assert.match(s.stderr, /BUILDER_PROVIDER/);
    assert.deepEqual(s.checkCalls, []);
    assert.equal(s.published.size, 0);
    return;
  }
  assert.equal(s.code, 0, s.stderr);
  const record = JSON.parse(s.published.get('native')!['record.json']!);
  assert.deepEqual(record.sessions[0], {
    role: 'build',
    provider: 'openai',
    client: { version: 'codex-cli 0.170.0', sha256 },
    usage: { inputTokens: 4, outputTokens: 3 },
    responses: receipts,
    model,
    effort: 'high',
    completed: true,
    exitCode: 0,
    stopped: false,
    durationSeconds: 0,
    costUsd: null,
    costByModel: {},
  });
  assert.deepEqual(
    Object.keys(record.launcher)
      .filter((k) => k.startsWith('sbx/'))
      .sort(),
    ['sbx/codex-guest.py', 'sbx/isolation.json'],
  );
  assert.deepEqual(s.checkCalls, [{ command: ['test', '-f', 'patch'], limitSeconds: 17 }]);
  assert.equal(JSON.parse(s.stdout).costUsd, null);
  assert.equal(JSON.parse(s.stdout).build.costUsd, null);
  assert.equal(
    JSON.parse(readFileSync(join(s.outputs.retained, 'build.measure.json'), 'utf8')).costUsd,
    null,
  );
});

// Routed Steps (docs/design/orchestration-fable-5-2.md, §13): step.json is what Plan writes from the launcher table.
const launcherRoutingText = (s: Step) => s.launcherRouting ?? readFileSync(join(PKG, 'routing.json'), 'utf8');

Given(
  'the step folder holds a routed step.json for a ticket of {int} points, with the checks {string} and the providers {string}',
  function (points: number, checks: string, providers: string) {
    const s = step(this);
    const text = launcherRoutingText(s);
    const policy = parseRoutedPolicy({
      routing: { providers: providers.split(' ') },
      checks:
        checks === ''
          ? []
          : checks.split(' ').map((name) => ({ name, command: ['npm', 'run', name], limitSeconds: 120 })),
    });
    const tickets = [{ id: 'TICKET-001', story_points: points, depends_on: [], acceptance_ids: ['AC-1'] }];
    writeFileSync(
      join(s.folder, 'step.json'),
      JSON.stringify(routedStep(policy, parseRoutingTable(text), text, tickets)),
    );
    writeFileSync(join(s.folder, 'brief.md'), 'Build the thing.\n');
  },
);

Given(
  'the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from {int} and {int} points',
  function (first: number, second: number) {
    const s = step(this);
    const table = JSON.parse(launcherRoutingText(s));
    table.roles.review.bands[0].candidates = [
      { provider: 'google', limitSeconds: 1500 },
      { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 1500 },
    ];
    for (const band of table.roles.build.bands)
      if (band.fromPoints === first || band.fromPoints === second)
        band.candidates = [{ provider: 'openai', model: 'gpt-6.2-sol', effort: 'high', limitSeconds: 7200 }];
    s.launcherRouting = JSON.stringify(table);
    s.openaiBuilds = true;
  },
);

Given(
  'the launcher routing table sends reviews to Gemini, then Opus, and builds on Sol alone from {int} points',
  function (points: number) {
    const s = step(this);
    const table = JSON.parse(launcherRoutingText(s));
    table.roles.review.bands[0].candidates = [
      { provider: 'google', limitSeconds: 1500 },
      { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 1500 },
    ];
    for (const band of table.roles.build.bands)
      if (band.fromPoints === points)
        band.candidates = [{ provider: 'openai', model: 'gpt-6.2-sol', effort: 'high', limitSeconds: 7200 }];
    s.launcherRouting = JSON.stringify(table);
    s.openaiBuilds = true;
  },
);

Given('the routed step.json is tampered with: {}', function (change: string) {
  const s = step(this);
  const file = join(s.folder, 'step.json');
  const routed = JSON.parse(readFileSync(file, 'utf8'));
  switch (change) {
    case 'a stronger first builder':
      routed.build = { ...routed.build, model: 'claude-opus-5-5', effort: 'high' };
      break;
    case 'a longer first build':
      routed.build.limitSeconds += 1;
      break;
    case 'a ladder without its last band':
      routed.routing.ladder.pop();
      break;
    case 'a review outside the ladder':
      routed.reviews = [{ name: 'quality', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 }];
      break;
    case 'the digest of another table':
      routed.routing.table_sha256 = 'e'.repeat(64);
      break;
    case 'a ticket estimated higher than its route':
      routed.tickets[0].story_points = 13;
      break;
    case 'a Google review marked as a session':
      routed.routing.ladder[0].review.waiting = false;
      break;
    case 'another admitted provider':
      routed.routing.providers = ['openai'];
      break;
    default:
      throw new Error(`unknown change ${change}`);
  }
  writeFileSync(file, JSON.stringify(routed));
});

When('the launcher routing table changed after Plan read it', function () {
  const s = step(this);
  const table = JSON.parse(launcherRoutingText(s));
  table.roles.build.bands[1].candidates[0].limitSeconds = 4801;
  s.launcherRouting = JSON.stringify(table);
});

Given('the build session of pass {int} is stopped by its limit', function (n: number) {
  step(this).buildPasses.set(n, { ...step(this).buildPasses.get(n), stopped: true });
});

Given('the build session of pass {int} exits with {int}', function (n: number, code: number) {
  step(this).buildPasses.set(n, { ...step(this).buildPasses.get(n), nativeExit: code });
});

Given('the build session of pass {int} writes the fixture {string}', function (n: number, name: string) {
  step(this).buildPasses.set(n, { ...step(this).buildPasses.get(n), fixture: name });
});

Given('the admission evidence lacks the specimen of {string}', function (role: string) {
  step(this).droppedSpecimen = role;
});

const builds = (s: Step) => s.calls.filter((call) => call.tool === 'code.json');

Then('the build sessions started with the models {string}', function (models: string) {
  assert.equal(
    builds(step(this))
      .map(({ argv }) => argv[argv.indexOf('--model') + 1])
      .join(' '),
    models,
  );
});

Then('the brief of build pass {int} contains {string}', function (n: number, text: string) {
  const brief = builds(step(this))[n - 1]?.brief;
  assert.ok(brief?.includes(text.replaceAll('\\n', '\n')), brief ?? '');
});

Then('the brief of build pass {int} is the brief of the step', function (n: number) {
  assert.equal(builds(step(this))[n - 1]?.brief, 'Build the thing.\n');
});

Then('the step stderr begins with {string}', function (text: string) {
  assert.ok(step(this).stderr.startsWith(text), step(this).stderr);
});

Then(
  'the published record routing serves {string} at {int} points from the committed table, starting on {string}',
  function (ticket: string, points: number, start: string) {
    const published = step(this).published.get('demo');
    assert.ok(published);
    const { routing } = JSON.parse(published['record.json']!);
    const table = createHash('sha256')
      .update(readFileSync(join(PKG, 'routing.json'), 'utf8'))
      .digest('hex');
    assert.deepEqual(
      { ticket: routing.ticket, points: routing.points, table: routing.table_sha256, start: routing.start },
      { ticket, points, table, start },
    );
  },
);

Then('the brief of review session {int} contains {string}', function (n: number, text: string) {
  const brief = step(this).calls.filter((call) => call.tool === 'review.json')[n - 1]?.brief;
  assert.ok(brief?.includes(text), brief ?? '');
});

Then('the brief of review session {int} does not contain {string}', function (n: number, text: string) {
  const brief = step(this).calls.filter((call) => call.tool === 'review.json')[n - 1]?.brief;
  assert.ok(brief !== undefined && !brief.includes(text), brief ?? '');
});

Then('the retained verdict {string} is invalid because {string}', function (file: string, why: string) {
  const verdict = JSON.parse(readFileSync(join(step(this).outputs.retained, file), 'utf8'));
  assert.deepEqual(verdict, { invalid: why });
});
