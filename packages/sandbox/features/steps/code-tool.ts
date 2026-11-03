import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { startAuthProxy, type AuthProxy, type AuthProxyOptions } from '../../src/auth-proxy.js';
import {
  failureReporter,
  processDependencies,
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
  outcome?: { code: number } | { error: unknown };
}
const session = (world: SandboxWorld) => stored<Session>(world, 'codeTool');

const PLUGINS = [join(ROOT, 'plugins', 'builder-guard')];
const tool = () => loadTool(join(PKG, 'code.json'));

Given(
  'a code tool session with the session token {string} and the arguments {string}',
  function (token: string, args: string) {
    const events: string[] = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const s: Session = { events, stdout: '', stderr: '', deps: undefined as never };
    stdout.on('data', (chunk: Buffer) => (s.stdout += chunk.toString()));
    stderr.on('data', (chunk: Buffer) => (s.stderr += chunk.toString()));
    const proxy: AuthProxy = {
      port: 4321,
      revoke: () => void events.push('revoke'),
      close: async () => void events.push('close'),
    };
    const memory = new InMemorySandboxRunner(['builder']);
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
      plugins: PLUGINS,
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

const commandOf = (args: string) => [
  'claude',
  ...PLUGINS.flatMap((dir) => ['--plugin-dir', dir]),
  ...args.split(' '),
];

Then(
  'the sandbox ran the profile {string} in {string} with claude, the plugin directories of code.json and {string}',
  function (profile: string, cwd: string, args: string) {
    assert.deepEqual(session(this).started, { profile, cwd, command: commandOf(args) });
  },
);

Then(
  'the sandbox ran in the terminal with claude, the plugin directories of code.json and {string}',
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

Then(
  'the dependencies load the tool of code.json and its plugin directories under the repository',
  function () {
    assert.deepEqual(deps(this).tool, tool());
    assert.deepEqual(deps(this).plugins, PLUGINS);
  },
);

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
    const { srtCli, ...rest } = srtOptions(proc, PLUGINS, variables);
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
      trusted: [PKG, join(ROOT, 'package.json'), ...PLUGINS],
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
