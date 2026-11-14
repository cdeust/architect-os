import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { startAuthProxy, type AuthProxy, type AuthProxyOptions } from '../../src/auth-proxy.js';
import {
  failureReporter,
  processDependencies,
  reviewDependencies,
  runCodeTool,
  srtOptions,
  type CodeProcess,
  type CodeToolDependencies,
  type CodeToolRunner,
} from '../../src/code-tool.js';
import { InMemorySandboxRunner } from '../../src/in-memory.js';
import { SandboxError, type SandboxExit, type SandboxRequest } from '../../src/port.js';
import { SrtSandboxRunner } from '../../src/srt-runner.js';
import { loadTool } from '../../src/tool.js';
import { Given, PKG, ROOT, Then, When, stored, type SandboxWorld } from './helpers.js';
import { named } from './worktree.js';

/** What the fakes of one code tool session saw. */
interface Session {
  deps: CodeToolDependencies;
  events: string[];
  variables?: Readonly<Record<string, string>>;
  started?: SandboxRequest;
  inTerminal?: SandboxRequest;
  proxyOptions?: AuthProxyOptions;
  stdout: string;
  stderr: string;
  /** The system prompt file of the session. */
  prompt: string;
  outcome?: { code: number } | { error: unknown };
}
const session = (world: SandboxWorld) => stored<Session>(world, 'codeTool');

const tool = () => loadTool(join(PKG, 'code.json'));
const BUILD_PROMPT = join(PKG, 'prompts', 'build.md');

Given(
  'a code tool session with the session token {string} and the arguments {string}',
  function (token: string, args: string) {
    const events: string[] = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const s: Session = { events, stdout: '', stderr: '', prompt: BUILD_PROMPT, deps: undefined as never };
    stdout.on('data', (chunk: Buffer) => (s.stdout += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (s.stderr += chunk.toString()));
    const proxy: AuthProxy = {
      port: 4321,
      revoke: () => void events.push('revoke'),
      close: async () => void events.push('close'),
    };
    const memory = new InMemorySandboxRunner(['builder', 'reviewer']);
    const runner: CodeToolRunner = {
      start: async (request) => {
        s.started = request;
        const sandbox = await memory.start(request);
        // The in-memory adapter's streams are PassThroughs (src/in-memory.ts).
        (sandbox.stderr as PassThrough).write('sandbox stderr');
        return sandbox;
      },
      runInTerminal: async (request) => {
        s.inTerminal = request;
        return { code: 0, signal: null };
      },
    };
    s.deps = {
      tool: tool(),
      systemPrompt: () => s.prompt,
      credential: async () => ({ accessToken: 'host' }),
      startProxy: async (options) => {
        s.proxyOptions = options;
        events.push('start');
        return proxy;
      },
      runner: (variables) => {
        s.variables = variables;
        return runner;
      },
      sessionToken: () => token,
      cwd: '/work',
      argv: args.split(' '),
      terminal: false,
      stdin: new PassThrough(),
      stdout,
      stderr,
    };
    this.state['codeTool'] = s;
  },
);

const withRunner = (s: Session, change: (runner: CodeToolRunner) => CodeToolRunner) => {
  const factory = s.deps.runner;
  s.deps = { ...s.deps, runner: (variables) => change(factory(variables)) };
};

Given('the session has a terminal, where the sandbox exits by a signal', function () {
  const s = session(this);
  s.deps = { ...s.deps, terminal: true };
  withRunner(s, (runner) => ({
    ...runner,
    runInTerminal: async (request): Promise<SandboxExit> => {
      s.inTerminal = request;
      return { code: null, signal: 'SIGTERM' };
    },
  }));
});

Given('the piped sandbox exits by a signal', function () {
  const s = session(this);
  withRunner(s, (runner) => ({
    ...runner,
    start: async (request) => {
      const sandbox = await runner.start(request);
      await sandbox.stop();
      return sandbox;
    },
  }));
});

Given('the runner fails with {string}', function (message: string) {
  const s = session(this);
  withRunner(s, (runner) => ({
    ...runner,
    start: async () => {
      throw new Error(message);
    },
  }));
});

Given('the host credential cannot be read', function () {
  const s = session(this);
  s.deps = {
    ...s.deps,
    credential: async () => {
      throw new Error('keychain locked');
    },
  };
});

const run = async (s: Session) => {
  s.outcome = await runCodeTool(s.deps).then(
    (code) => ({ code }),
    (error: unknown) => ({ error }),
  );
};

When('I run the code tool with {string} on stdin', async function (text: string) {
  const s = session(this);
  const stdin = s.deps.stdin as PassThrough;
  const running = run(s);
  stdin.end(text);
  await running;
});

When('I run the code tool', async function () {
  await run(session(this));
});

Then('the code tool exits with {int}', function (code: number) {
  assert.deepEqual(session(this).outcome, { code });
});

Then('the code tool fails with {string}', function (message: string) {
  const outcome = session(this).outcome;
  assert.ok(outcome && 'error' in outcome, 'the code tool did not fail');
  assert.equal((outcome.error as Error).message, message);
});

Then(
  'the code tool fails with the sandbox error {string} {string}',
  function (code: string, message: string) {
    const outcome = session(this).outcome;
    assert.ok(outcome && 'error' in outcome, 'the code tool did not fail');
    assert.ok(outcome.error instanceof SandboxError);
    assert.equal(outcome.error.code, code);
    assert.equal(outcome.error.message, message);
  },
);

const commandOf = (args: string, prompt: string = BUILD_PROMPT, base = tool()) => [
  ...base.command,
  '--append-system-prompt-file',
  prompt,
  ...args.split(' '),
];

Then(
  'the sandbox ran the profile {string} in {string} with the command of code.json, the system prompt and {string}',
  function (profile: string, cwd: string, args: string) {
    assert.deepEqual(session(this).started, { profile, cwd, command: commandOf(args) });
  },
);

Then('the command of the sandbox carries exactly one --append-system-prompt-file', function () {
  const command = session(this).started?.command ?? [];
  assert.equal(command.filter((word) => word === '--append-system-prompt-file').length, 1);
});

Then(
  'the sandbox ran in the terminal with the command of code.json, the system prompt and {string}',
  function (args: string) {
    const s = session(this);
    assert.equal(s.started, undefined);
    assert.deepEqual(s.inTerminal, { profile: 'builder', cwd: '/work', command: commandOf(args) });
  },
);

Then(
  'the runner was given the proxy port {string} and the session token {string}',
  function (port: string, token: string) {
    assert.deepEqual(session(this).variables, { authProxyPort: port, sessionToken: token });
  },
);

Then('the code tool stdout is {string}', function (text: string) {
  assert.equal(session(this).stdout, text);
});

Then('the code tool stderr is {string}', function (text: string) {
  assert.equal(session(this).stderr, text);
});

Then('the code tool stdin is destroyed and no longer piped', function () {
  const { stdin } = session(this).deps;
  assert.equal(stdin.destroyed, true);
  assert.equal(stdin.listenerCount('data'), 0);
});

Then('the code tool stdin is destroyed', function () {
  assert.equal(session(this).deps.stdin.destroyed, true);
});

Then(
  'the proxy was started with the options of code.json and the session token {string}',
  function (token: string) {
    const s = session(this);
    const { authProxy } = tool();
    assert.ok(s.proxyOptions);
    assert.equal(s.proxyOptions.sessionToken, token);
    assert.equal(s.proxyOptions.credential, s.deps.credential);
    assert.equal(s.proxyOptions.upstream, authProxy.upstream);
    assert.deepEqual(s.proxyOptions.policy, authProxy.policy);
  },
);

Then('the proxy was revoked then closed', function () {
  assert.deepEqual(session(this).events, ['start', 'revoke', 'close']);
});

Then('no proxy was started', function () {
  assert.deepEqual(session(this).events, []);
});

// --- processDependencies, srtOptions --------------------------------------------------------------------------

const fakeProcess = (env: Record<string, string>, cwd: string, argv: string): CodeProcess => ({
  env,
  argv: argv.split(' '),
  execPath: '/usr/bin/node-of-the-host',
  cwd: () => cwd,
  stdin: new PassThrough(),
  stdout: new PassThrough(),
  stderr: new PassThrough(),
});

Given(
  'a process with INIT_CWD {string}, the cwd {string} and the arguments {string}',
  function (initCwd: string, cwd: string, argv: string) {
    this.state['process'] = fakeProcess({ INIT_CWD: initCwd }, cwd, argv);
  },
);

Given(
  'a process without INIT_CWD, the cwd {string} and the arguments {string}',
  function (cwd: string, argv: string) {
    this.state['process'] = fakeProcess({}, cwd, argv);
  },
);

When('I build the process dependencies with standard streams that are terminals', function () {
  this.state['deps'] = processDependencies(stored(this, 'process'), () => true);
});

When('I build the process dependencies with stdout not a terminal', function () {
  this.state['deps'] = processDependencies(stored(this, 'process'), (fd) => fd !== 1);
});

const deps = (world: SandboxWorld) => stored<CodeToolDependencies>(world, 'deps');

Then(
  'the dependencies run in {string} with the arguments {string} in a terminal',
  function (cwd: string, args: string) {
    assert.deepEqual([deps(this).cwd, deps(this).argv, deps(this).terminal], [cwd, args.split(' '), true]);
  },
);

Then(
  'the dependencies run in {string} with the arguments {string} without a terminal',
  function (cwd: string, args: string) {
    const expected = args === '' ? [] : args.split(' ');
    assert.deepEqual([deps(this).cwd, deps(this).argv, deps(this).terminal], [cwd, expected, false]);
  },
);

Then('the dependencies load the tool of code.json', function () {
  assert.deepEqual(deps(this).tool, tool());
});

Given('a process with INIT_CWD in {string} of the worktree {string}', function (dir: string, name: string) {
  this.state['process'] = fakeProcess(
    { INIT_CWD: join(named(this, name).worktree, dir) },
    '/elsewhere',
    'node',
  );
});

Given('the worktree {string} holds the file {string}', function (name: string, file: string) {
  writeFileSync(join(named(this, name).worktree, file), '# instructions\n');
});

Then('the system prompt of the dependencies is the build prompt of the launcher', function () {
  assert.equal(deps(this).systemPrompt(), BUILD_PROMPT);
});

Then('the dependencies start the auth proxy of auth-proxy.ts', function () {
  assert.equal(deps(this).startProxy, startAuthProxy);
});

Then('the dependencies give a fresh 64-hex session token each time', function () {
  const [a, b] = [deps(this).sessionToken(), deps(this).sessionToken()];
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

Then(
  'the dependencies build an srt runner for the variables {string} {string} and {string} {string}',
  function (k1: string, v1: string, k2: string, v2: string) {
    assert.ok(deps(this).runner({ [k1]: v1, [k2]: v2 }) instanceof SrtSandboxRunner);
  },
);

Then('the dependencies pass the process streams through', function () {
  const proc = stored<CodeProcess>(this, 'process');
  const { stdin, stdout, stderr } = deps(this);
  assert.deepEqual(
    [stdin, stdout, stderr].map((s) => s === undefined),
    [false, false, false],
  );
  assert.ok(stdin === proc.stdin && stdout === proc.stdout && stderr === proc.stderr);
});

Then(
  'the srt options for the variables {string} {string} and {string} {string} are those of the package',
  function (k1: string, v1: string, k2: string, v2: string) {
    const proc = stored<CodeProcess>(this, 'process');
    const variables = { [k1]: v1, [k2]: v2 };
    const { srtCli, ...rest } = srtOptions(proc, variables);
    // Resolved as node resolves the package: under the Stryker sandbox, node_modules is a link to the real one.
    assert.ok(
      srtCli.endsWith(join('node_modules', '@anthropic-ai', 'sandbox-runtime', 'dist', 'cli.js')),
      srtCli,
    );
    assert.ok(existsSync(srtCli), srtCli);
    assert.deepEqual(rest, {
      profilesDir: join(PKG, 'profiles'),
      node: '/usr/bin/node-of-the-host',
      canaryProbe: join(PKG, 'src', 'canary-probe.mjs'),
      tmpRoot: tmpdir(),
      home: homedir(),
      hostEnv: proc.env,
      trusted: [PKG, join(ROOT, 'package.json')],
      variables,
    });
  },
);

// --- failureReporter -------------------------------------------------------------------------------------------

When(
  'the code tool failure reporter gets a sandbox error {string} {string}',
  function (code: string, message: string) {
    reportOn(this, new SandboxError(code as never, message));
  },
);

When('the code tool failure reporter gets the error {string}', function (message: string) {
  reportOn(this, new Error(message));
});

function reportOn(world: SandboxWorld, error: unknown): void {
  const stderr = new PassThrough();
  let text = '';
  stderr.on('data', (chunk: Buffer) => (text += chunk.toString()));
  const code = failureReporter(stderr)(error);
  world.state['reported'] = () => ({ code, text });
}

Then('it returns {int} and writes {string} to stderr', function (code: number, line: string) {
  assert.deepEqual(stored<() => { code: number; text: string }>(this, 'reported')(), { code, text: line });
});

// --- the system prompt of the tool: the launcher's, never the worktree's -------------------------------------------------------------

const REVIEW_PROMPT = join(PKG, 'prompts', 'review.md');

Given('the session takes the system prompt of the dependencies of code.json', function () {
  const s = session(this);
  s.prompt = processDependencies(
    fakeProcess({ INIT_CWD: '/work' }, '/work', 'node'),
    () => false,
  ).systemPrompt();
});

Given('the session takes the tool and the system prompt of the dependencies of review.json', function () {
  const s = session(this);
  const real = processDependencies(
    fakeProcess({ INIT_CWD: '/work' }, '/work', 'node'),
    () => false,
    'review.json',
  );
  s.deps = { ...s.deps, tool: real.tool };
  s.prompt = real.systemPrompt();
});

Then(
  'the sandbox ran the profile {string} with the command of review.json, the launcher prompt and {string}',
  function (profile: string, args: string) {
    assert.deepEqual(session(this).started, {
      profile,
      cwd: '/work',
      command: commandOf(args, REVIEW_PROMPT, loadTool(join(PKG, 'review.json'))),
    });
  },
);

Given('the session system prompt is {string}', function (prompt: string) {
  session(this).prompt = prompt;
});

Then(
  'the sandbox ran the command of code.json, the system prompt {string}, and {string}',
  function (prompt: string, args: string) {
    assert.deepEqual(session(this).started?.command, commandOf(args, prompt));
  },
);

Given('the session system prompt is refused with {string}', function (message: string) {
  const s = session(this);
  s.deps = {
    ...s.deps,
    systemPrompt: () => {
      throw new SandboxError('ISOLATION_UNAVAILABLE', message);
    },
  };
});

Given(
  'a tool file derived from code.json naming the launcher prompt file {string}',
  function (launcherPromptFile: string) {
    const dir = mkdtempSync(join(tmpdir(), 'aos-tool-'));
    this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'tool.json');
    writeFileSync(file, JSON.stringify({ ...tool(), launcherPromptFile }));
    // processDependencies joins the tool file to the package directory: a relative path reaches the temporary file.
    this.state['toolFile'] = relative(PKG, file);
  },
);

When('I build the process dependencies of the stored tool file', function () {
  this.state['deps'] = processDependencies(
    stored(this, 'process'),
    () => false,
    stored<string>(this, 'toolFile'),
  );
});

When('I build the process dependencies of the tool file {string}', function (file: string) {
  this.state['deps'] = processDependencies(stored(this, 'process'), () => false, file);
});

When('I build the review dependencies', function () {
  this.state['deps'] = reviewDependencies(stored(this, 'process'), () => false);
});

Then('the profile of the dependencies is {string}', function (profile: string) {
  assert.equal(deps(this).tool.profile, profile);
});

Then('the dependencies load the tool of review.json', function () {
  assert.deepEqual(deps(this).tool, loadTool(join(PKG, 'review.json')));
});

Then('the system prompt of the dependencies is the review prompt of the launcher', function () {
  assert.equal(deps(this).systemPrompt(), REVIEW_PROMPT);
});

Then(
  'the system prompt of the dependencies is refused naming the launcher file {string}',
  function (file: string) {
    assert.throws(
      () => deps(this).systemPrompt(),
      (error: unknown) =>
        error instanceof SandboxError &&
        error.code === 'ISOLATION_UNAVAILABLE' &&
        error.message === `ISOLATION_UNAVAILABLE: prompt du lanceur introuvable : ${join(PKG, file)}`,
    );
  },
);
