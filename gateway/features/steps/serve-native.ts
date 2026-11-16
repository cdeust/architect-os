import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, Server as NetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  NativeLauncher,
  SrtSandboxRunner,
  type NativeChild,
  type Sandbox,
  type SandboxExit,
  type SandboxRequest,
  type SandboxRunner,
} from '@architect-os/sandbox';
import type { Scheduler } from '../../src/domain/ports.js';
import { InMemoryAuditLog } from '../../src/infrastructure/in-memory.js';
import { StreamClientTransport } from '../../src/infrastructure/stream-transport.js';
import { JsonLinesAuditLog } from '../../src/infrastructure/stdout-audit-log.js';
import { TimerScheduler } from '../../src/infrastructure/usage-adapters.js';
import { nativeHost, serveNative, type NativeHost } from '../../src/main.js';
import { FakeModuleRunner } from './fake-modules.js';
import { Given, Then, When, type GatewayWorld } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOKEN = 'a-bearer-token-of-the-native-process-0123456789';
/** The bound of the stop the scenarios give the process; no other delay is scheduled with it. */
const GRACE_MS = 7777;

/** The scheduler of the process: the work waits until a scenario runs the one it names. */
class GraceScheduler implements Scheduler {
  readonly waiting: { ms: number; work: () => void }[] = [];
  after(ms: number, work: () => void): void {
    this.waiting.push({ ms, work });
  }
}

/** A native child as the process sees it: the two streams of its MCP channel, and how it ends. */
class ChildDouble implements NativeChild {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly exited: Promise<SandboxExit>;
  private finish: (exit: SandboxExit) => void = () => {};

  constructor(
    private readonly name: string,
    private readonly onClose: (name: string) => void,
  ) {
    this.exited = new Promise((done) => (this.finish = done));
  }

  /** The child ends by itself, as a crash would. */
  exit(): void {
    this.stdout.end();
    this.finish({ code: 1, signal: null });
  }

  close(): Promise<SandboxExit> {
    this.onClose(this.name);
    this.stdin.end();
    this.exit();
    return this.exited;
  }
}

/** The worker of a task: an MCP client on the streams the gateway serves, which calls the module memory and stays. */
class WorkerDouble implements SandboxRunner {
  async start(): Promise<Sandbox> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let finish: (exit: SandboxExit) => void = () => {};
    const exited = new Promise<SandboxExit>((done) => (finish = done));
    const client = new Client({ name: 'worker', version: '0.0.0' });
    // The gateway connects its side once the sandbox is given: the worker speaks first, from the background.
    void client
      .connect(new StreamClientTransport(stdin, stdout))
      .then(() =>
        client.callTool({ name: 'call', arguments: { address: 'memory.search', arguments: { query: 'x' } } }),
      )
      .catch(() => undefined);
    return {
      stdin,
      stdout,
      stderr: new PassThrough(),
      exited,
      stop: async () => {
        stdin.end();
        stdout.end();
        finish({ code: null, signal: 'SIGKILL' });
        return exited;
      },
    };
  }
}

interface Scene {
  env: Record<string, string>;
  port: number;
  stderr: string;
  /** The native children the process asked for, in order. */
  started: string[];
  /** The closed list it gave the launcher. */
  processes?: unknown;
  /** What the children write on their stderr, as the process handed it to its launcher. */
  log?: (name: string, text: string) => void;
  data?: ChildDouble;
  broker?: ChildDouble;
  garbledBroker: boolean;
  /** Every operation data was asked, in order. */
  asked: { tool: string; args: unknown }[];
  /** What each sandbox was started with: its profile and the variables of its runner. */
  given: { profile: string; variables: Record<string, string> }[];
  /** The events and the standard error as they were when the process gave its code. */
  atEnd?: { events: string[]; stderr: string };
  audit: InMemoryAuditLog;
  /** Held while data must not answer the end of a task. */
  hold?: { gate: Promise<void>; release: () => void };
  /** What happened to the sandboxes and the children, in order: `stop module`, `data closed`… */
  events: string[];
  /** How many servers of the process still listened each time a child was closed. */
  listeningAtClose: number[];
  /** Every server the process listened with, and where it did. */
  servers: NetServer[];
  listened: { address: string; port: number }[];
  modules: FakeModuleRunner;
  scheduler: GraceScheduler;
  stop: () => void;
  running?: Promise<number>;
  code?: number;
  refusedAtStart: boolean;
  releaseLaunches?: () => void;
}
const scene = (world: GatewayWorld): Scene => world.state['serve-native'] as Scene;

const until = async (condition: () => boolean, what: string): Promise<void> => {
  // Reached only when the condition never comes: long enough for a loaded host (the mutation run).
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** What a connection to a loopback port meets: `connected`, or the code of its refusal. */
const reach = (port: number): Promise<string> =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => (socket.destroy(), resolve('connected')));
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(String(error.code)));
  });

const listenOn = (server: NetServer, port: number): Promise<number> =>
  new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listenOn(probe, 0);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** An MCP server of the SDK on the streams of a child double. */
async function serveOn(
  child: ChildDouble,
  name: string,
  answer: (tool: string, args: unknown) => Promise<void>,
): Promise<Server> {
  const server = new Server({ name, version: '0.0.0' }, { capabilities: { tools: {}, logging: {} } });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    await answer(params.name, params.arguments);
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  });
  await server.connect(new StdioServerTransport(child.stdin, child.stdout));
  return server;
}

Given(
  'a native process with doubles for data, the broker and the sandboxes, on a free port',
  async function () {
    const dir = mkdtempSync(join(tmpdir(), 'serve-native-'));
    this.cleanups.push(() => rmSync(dir, { recursive: true }));
    const brokerConfig = join(dir, 'broker.json');
    writeFileSync(brokerConfig, JSON.stringify({ port: 5099 }));
    const port = await freePort();
    const current: Scene = {
      env: {
        GATEWAY_TOKENS: `${TOKEN}=alice`,
        GATEWAY_PORT: String(port),
        GATEWAY_QUOTA_PER_MINUTE: '100',
        GATEWAY_PROFILE: 'owner',
        BROKER_CONFIG: brokerConfig,
        DATABASE_URL: 'memory',
      },
      port,
      stderr: '',
      started: [],
      garbledBroker: false,
      asked: [],
      given: [],
      audit: new InMemoryAuditLog(),
      events: [],
      listeningAtClose: [],
      servers: [],
      listened: [],
      modules: new FakeModuleRunner(),
      scheduler: new GraceScheduler(),
      stop: () => {},
      refusedAtStart: false,
    };
    this.state['serve-native'] = current;
    this.cleanups.push(async () => {
      current.stop();
      current.hold?.release();
      current.modules.unstoppable.clear();
      await current.running;
      await until(() => current.servers.every((server) => !server.listening), 'every server to be closed');
    });
  },
);

Given('the environment of the native process lacks {word}', function (variable: string) {
  delete scene(this).env[variable];
});

Given('the broker double of the native process does not speak MCP', function () {
  scene(this).garbledBroker = true;
});

Given('another listener already holds the port of the native process', async function () {
  const holder = createServer();
  await new Promise<void>((resolve) => holder.listen(scene(this).port, '127.0.0.1', resolve));
  this.cleanups.push(() => new Promise<void>((resolve) => holder.close(() => resolve())));
});

Given('the data double of the native process holds its answer to the end of a task', function () {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  scene(this).hold = { gate, release };
});

Given('the sandbox of the module {string} of the native process refuses to stop', function (module: string) {
  scene(this).modules.unstoppable.add(module);
});

/** Starts the process; what it gives is read from `scene.code` once it is over. */
function startProcess(world: GatewayWorld): void {
  const current = scene(world);
  // The servers the process listens with, whatever their layer: net.Server is what http.Server listens through.
  const listen = NetServer.prototype.listen;
  NetServer.prototype.listen = function (this: NetServer, ...args: unknown[]) {
    current.servers.push(this);
    this.once('listening', () => current.listened.push({ ...(this.address() as AddressInfo) }));
    return (listen as (...a: unknown[]) => NetServer).apply(this, args);
  } as typeof listen;
  world.cleanups.push(() => void (NetServer.prototype.listen = listen));
  const closed = (name: string): void => {
    current.events.push(`${name} closed`);
    current.listeningAtClose.push(current.servers.filter((server) => server.listening).length);
  };
  const runner: SandboxRunner = {
    start: async (request: SandboxRequest) => {
      const sandbox = await (request.profile === 'worker' ? new WorkerDouble() : current.modules).start(
        request,
      );
      return {
        ...sandbox,
        stop: () => {
          current.events.push(`stop ${request.profile}`);
          return sandbox.stop();
        },
      };
    },
  };
  const stopped = new Promise<void>((resolve) => (current.stop = resolve));
  current.running = serveNative({
    env: current.env,
    root: ROOT,
    node: process.execPath,
    stderr: new Writable({
      write(chunk: Buffer, _encoding, done) {
        current.stderr += chunk.toString();
        done();
      },
    }),
    audit: current.audit,
    launch: (processes, log) => {
      current.processes = processes;
      current.log = log;
      return {
        start: async (name) => {
          current.started.push(name);
          const child = new ChildDouble(name, closed);
          if (name === 'data') {
            current.data = child;
            const server = await serveOn(child, 'data', async (tool, args) => {
              current.asked.push({ tool, args });
              if (tool === 'tasks.end') await current.hold?.gate;
            });
            world.cleanups.push(() => server.close());
          } else {
            current.broker = child;
            if (current.garbledBroker)
              child.stdin.once('data', () => child.stdout.write('this is not MCP\n'));
            else {
              const server = await serveOn(child, 'broker', async () => {});
              world.cleanups.push(() => server.close());
            }
          }
          return child;
        },
      };
    },
    runners: (variables) => ({
      start: (request) => {
        current.given.push({ profile: request.profile, variables });
        return runner.start(request);
      },
    }),
    stopped,
    graceMs: GRACE_MS,
    scheduler: current.scheduler,
    probeMs: 1000,
  }).then((code) => {
    current.atEnd = { events: [...current.events], stderr: current.stderr };
    return (current.code = code);
  });
}

When('the native process is started and its end is awaited', async function () {
  startProcess(this);
  await scene(this).running;
});

When('the native process is started and serving', async function () {
  startProcess(this);
  const current = scene(this);
  await until(
    () => current.listened.some(({ port }) => port === current.port) || current.code !== undefined,
    'the process to listen',
  );
  assert.equal(current.code, undefined, current.stderr);
});

const httpClient = async (current: Scene, token: string | undefined): Promise<Client> => {
  const client = new Client({ name: 'e2e-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${current.port}/mcp`), {
      requestInit: token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
};

Then('a client with the configured token lists the tools {string}', async function (names: string) {
  const client = await httpClient(scene(this), TOKEN);
  assert.equal(
    (await client.listTools()).tools
      .map((tool) => tool.name)
      .sort()
      .join(', '),
    names,
  );
  await client.close();
});

Then(
  'a client without a token calling {string} is refused {word}',
  async function (tool: string, code: string) {
    const client = await httpClient(scene(this), undefined);
    const answer = await client.callTool({ name: tool, arguments: { query: 'q' } });
    assert.equal(answer.isError, true);
    assert.match((answer.content as { text: string }[])[0]!.text, new RegExp(code));
    await client.close();
  },
);

Then('the process listens for its clients on 127.0.0.1 and nowhere else', function () {
  const current = scene(this);
  assert.deepEqual(
    current.listened.filter(({ port }) => port === current.port).map(({ address }) => address),
    ['127.0.0.1'],
  );
});

When('a client with the configured token calls {string} without waiting', async function (tool: string) {
  const client = await httpClient(scene(this), TOKEN);
  // Its task is ended under it when the process stops: what the call gives is not what the scenario is about.
  void client.callTool({ name: tool, arguments: { query: 'q' } }).catch(() => undefined);
});

When('the worker of that call has called the module {string}', async function (module: string) {
  const { modules } = scene(this);
  await until(() => modules.started.includes(module), `the module ${module} to be launched`);
});

When(
  'the sandbox of the module {string} of the native process exits by itself',
  async function (module: string) {
    const { modules } = scene(this);
    modules.kill(module);
    await until(() => modules.ended.includes(module), `the module ${module} to end`);
  },
);

When('the native process is asked to stop', async function () {
  const current = scene(this);
  current.stop();
  await current.running;
});

When('the native process is asked to stop, without waiting for its end', async function () {
  scene(this).stop();
});

When('the data double of the native process exits by itself', async function () {
  scene(this).data!.exit();
  await scene(this).running;
});

When('the broker double of the native process exits by itself', async function () {
  scene(this).broker!.exit();
  await scene(this).running;
});

When('the bound of the stop passes', async function () {
  const { scheduler } = scene(this);
  await until(() => scheduler.waiting.some(({ ms }) => ms === GRACE_MS), 'the stop to be bounded');
  for (const { ms, work } of scheduler.waiting) if (ms === GRACE_MS) work();
  await scene(this).running;
});

When('the data double of the native process writes {string} on its standard error', function (text: string) {
  scene(this).log!('data', text.replaceAll('\\n', '\n'));
});

Then('the stop of the native process is not over', async function () {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scene(this).code, undefined);
});

Then('the native process gave the code {int}', function (code: number) {
  assert.equal(scene(this).code, code);
});

Then('the native process wrote on its standard error:', function (expected: string) {
  assert.equal(scene(this).stderr, `${expected}\n`);
});

Then(
  'the native process had written on its standard error, when it gave its code:',
  function (expected: string) {
    assert.equal(scene(this).atEnd!.stderr, `${expected}\n`);
  },
);

Then('the native process wrote nothing on its standard error', function () {
  assert.equal(scene(this).stderr, '');
});

Then('the native process wrote on its standard error a line matching {string}', function (pattern: string) {
  assert.match(scene(this).stderr, new RegExp(`^gateway: ${pattern}\\n$`));
});

Then('the native process launched nothing', function () {
  assert.deepEqual(scene(this).started, []);
  assert.equal(scene(this).processes, undefined);
});

Then('the native process asked its launcher for the closed list {string}', function (names: string) {
  assert.deepEqual(Object.keys(scene(this).processes as object).sort(), names.split(', '));
});

Then('both children of the native process were closed', function () {
  assert.deepEqual(
    scene(this)
      .events.filter((event) => event.endsWith(' closed'))
      .sort(),
    ['broker closed', 'data closed'],
  );
});

Then('no server of the native process was listening when its children were closed', function () {
  assert.deepEqual(scene(this).listeningAtClose, [0, 0]);
});

Then('nothing listens on the port of the native process any more', async function () {
  assert.equal(await reach(scene(this).port), 'ECONNREFUSED');
});

Then('nothing listens on the callback port of the native process any more', async function () {
  const current = scene(this);
  const callbacks = current.listened.filter(({ port }) => port !== current.port);
  assert.equal(callbacks.length, 1);
  assert.equal(await reach(callbacks[0]!.port), 'ECONNREFUSED');
});

const asked = (current: Scene, tool: string): Record<string, unknown>[] =>
  current.asked.filter((call) => call.tool === tool).map((call) => call.args as Record<string, unknown>);

Then('the open task was ended {string} by data', function (ending: string) {
  assert.deepEqual(
    asked(scene(this), 'tasks.end').map((end) => end['ending']),
    [ending],
  );
});

Then(
  'data opened one task, for the client {string} under the profile {string}',
  function (client: string, profile: string) {
    assert.deepEqual(
      asked(scene(this), 'tasks.open').map((open) => ({ client: open['client'], profile: open['profile'] })),
      [{ client, profile }],
    );
  },
);

Then(
  'the worker was started with the broker port {int} and a task token, the module with the callback port',
  function (brokerPort: number) {
    const current = scene(this);
    const callback = current.listened.filter(({ port }) => port !== current.port);
    assert.equal(callback.length, 1);
    const of = (profile: string) => current.given.filter((start) => start.profile === profile);
    assert.deepEqual(
      of('module').map((start) => start.variables),
      [{ callbackPort: String(callback[0]!.port) }],
    );
    const [worker, ...others] = of('worker');
    assert.deepEqual(others, []);
    assert.deepEqual(Object.keys(worker!.variables).sort(), ['brokerPort', 'taskToken']);
    assert.equal(worker!.variables['brokerPort'], String(brokerPort));
    assert.ok(worker!.variables['taskToken'] !== '', 'the task token is empty');
  },
);

Given(
  'the environment of the native process has {word} set to {string}',
  function (name: string, value: string) {
    scene(this).env[name] = value;
  },
);

Then(
  'a second call of {string} by the client with the configured token is refused {word}',
  async function (tool: string, code: string) {
    const client = await httpClient(scene(this), TOKEN);
    const answer = await client.callTool({ name: tool, arguments: { query: 'q' } });
    assert.equal(answer.isError, true);
    assert.match((answer.content as { text: string }[])[0]!.text, new RegExp(code));
    await client.close();
  },
);

Given('the sandboxes of the modules of the native process are held at their launch', function () {
  const current = scene(this);
  const release = current.modules.hold();
  current.releaseLaunches = release;
  this.cleanups.push(release);
});

When('the held launches of the native process go on', function () {
  scene(this).releaseLaunches!();
});

Then('the sandbox of the module started after the bound is stopped once it has started', async function () {
  const current = scene(this);
  assert.ok(!current.atEnd!.events.includes('stop module'), current.atEnd!.events.join(', '));
  await until(() => current.events.includes('stop module'), 'the late sandbox to be stopped');
});

Then('the composition left behind has tried again to stop the module', async function () {
  const current = scene(this);
  await until(
    () => current.events.filter((event) => event === 'stop module').length === 2,
    'the composition left behind to reach the module',
  );
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
});

When(
  'the broker double of the native process writes {string} on its standard error',
  function (text: string) {
    scene(this).log!('broker', text.replaceAll('\\n', '\n'));
  },
);

Then(
  'the sandbox of the module of the native process was stopped, then both children were closed',
  function () {
    assert.deepEqual(
      scene(this).atEnd!.events.filter((event) => event === 'stop module' || event.endsWith(' closed')),
      ['stop module', 'data closed', 'broker closed'],
    );
  },
);

Then('no sandbox of a module was stopped by the native process', function () {
  const { events } = scene(this).atEnd!;
  assert.ok(!events.includes('stop module'), events.join(', '));
});

// --- the host of the real process (nativeHost) ---

interface HostScene {
  proc: EventEmitter & { env: Record<string, string>; execPath: string; stderr: PassThrough };
  host: NativeHost;
  asked: boolean;
  logged: string;
  exit?: SandboxExit;
}
const hostScene = (world: GatewayWorld): HostScene => world.state['native-host'] as HostScene;

Given(
  'the host of a process whose entry is the built serve.js of the gateway of this repository',
  async function () {
    const proc = Object.assign(new EventEmitter(), {
      env: { GATEWAY_PORT: '1' },
      execPath: process.execPath,
      stderr: new PassThrough(),
    });
    const entry = pathToFileURL(join(ROOT, 'gateway', 'dist', 'src', 'serve.js')).href;
    const current: HostScene = { proc, host: await nativeHost(proc, entry), asked: false, logged: '' };
    void current.host.stopped.then(() => (current.asked = true));
    this.state['native-host'] = current;
  },
);

Then(
  'the host of the process has the root of this repository, the node, the environment and the stderr of its process',
  function () {
    const { host, proc } = hostScene(this);
    assert.equal(host.root, realpathSync(ROOT));
    assert.equal(host.node, proc.execPath);
    assert.equal(host.env, proc.env);
    assert.equal(host.stderr, proc.stderr);
  },
);

Then('the host of the process is not asked to stop', async function () {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hostScene(this).asked, false);
});

When('the process receives {word}', function (signal: string) {
  hostScene(this).proc.emit(signal);
});

Then('the host of the process is asked to stop', async function () {
  await hostScene(this).host.stopped;
});

Then(
  'the process still listens to SIGTERM and to SIGINT: a second signal does not end it by default',
  function () {
    const { proc } = hostScene(this);
    assert.deepEqual([proc.listenerCount('SIGTERM'), proc.listenerCount('SIGINT')], [1, 1]);
  },
);

When(
  'the launcher of the host starts a child that writes {string} on its stderr, then closes it',
  async function (text: string) {
    const current = hostScene(this);
    const child = {
      cwd: realpathSync(ROOT),
      // It writes, then lives until its stdin ends: closed by the launcher, not gone by itself.
      command: [
        process.execPath,
        '-e',
        `process.stderr.write(${JSON.stringify(text)}); process.stdin.resume();`,
      ],
      env: {},
    };
    const launcher = current.host.launch({ data: child, broker: child }, (name, written) => {
      current.logged += `${name}: ${written}`;
    });
    assert.ok(launcher instanceof NativeLauncher);
    const started = await launcher.start('data');
    await until(() => current.logged !== '', 'the child to write on its stderr');
    current.exit = await started.close();
  },
);

Then(
  'the log of the launcher received {string} from that child, and the child ended with the code {int}',
  function (text: string, code: number) {
    const { logged, exit } = hostScene(this);
    assert.equal(logged, `data: ${text}`);
    assert.deepEqual(exit, { code, signal: null });
  },
);

Then('the runner the host gives for the variables {string} is the srt runner', function (variables: string) {
  const runner = hostScene(this).host.runners(JSON.parse(variables) as Record<string, string>);
  assert.ok(runner instanceof SrtSandboxRunner);
});

Then(
  'the host of the process bounds the stop at {int} ms and probes data every {int} ms, on timers, with the audit log on stdout',
  function (graceMs: number, probeMs: number) {
    const { host } = hostScene(this);
    assert.equal(host.graceMs, graceMs);
    assert.equal(host.probeMs, probeMs);
    assert.ok(host.scheduler instanceof TimerScheduler);
    assert.ok(host.audit instanceof JsonLinesAuditLog);
  },
);
