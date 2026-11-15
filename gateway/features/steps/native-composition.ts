import assert from 'node:assert/strict';
import { connect, createServer, type AddressInfo, type Server } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewayError } from '../../src/domain/errors.js';
import {
  InMemoryAuditLog,
  InMemoryAuthenticator,
  InMemoryQuota,
  SystemClock,
} from '../../src/infrastructure/in-memory.js';
import { RandomIds } from '../../src/infrastructure/mcp-routing.js';
import { TimerScheduler } from '../../src/infrastructure/usage-adapters.js';
import { composeNative, type NativeDependencies } from '../../src/main.js';
import { FakeModuleRunner } from './fake-modules.js';
import { Given, Then, When, attempt, type Attempt, type GatewayWorld } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface Scene {
  deps: NativeDependencies;
  /** How many times the composition set the usage handler of the broker client. */
  handlers: { set: number };
  composed?: Awaited<ReturnType<typeof composeNative>>;
  refusal?: unknown;
  /** The operations asked of the data double, in order. */
  asked: { name: string; arguments: unknown }[];
  /** The module sandboxes, when the scenario has fake ones. */
  modules?: FakeModuleRunner;
  /** The task opened through the composed router. */
  task?: string;
  /** Releases the launches the fake sandboxes hold. */
  release?: () => void;
  /** Whether the closing a scenario started without waiting is over. */
  closed?: { over: boolean };
  /** What closing the composition produced. */
  closing?: Attempt;
}
const scene = (world: GatewayWorld): Scene => world.state['native-composition'] as Scene;

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );
const closed = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

/** The dependencies of a composition that reaches nothing: no module is called, so nothing is launched or asked. */
function dependencies(files: NativeDependencies['files'], port: number, profile = 'owner'): Scene {
  const clock = new SystemClock();
  const handlers = { set: 0 };
  const deps: NativeDependencies = {
    files,
    data: { callTool: () => Promise.reject(new Error('data is not reached')) },
    broker: {
      callTool: () => Promise.reject(new Error('the broker is not reached')),
      setNotificationHandler: () => void (handlers.set += 1),
    },
    brokerPort: 1,
    runners: () => ({ start: () => Promise.reject(new Error('no module is launched')) }),
    root: ROOT,
    callbackPort: port,
    auth: new InMemoryAuthenticator(new Map()),
    quota: new InMemoryQuota(1, 60_000, clock),
    audit: new InMemoryAuditLog(),
    clock,
    scheduler: new TimerScheduler(),
    ids: new RandomIds(),
    profile,
    probeMs: 1000,
  };
  return { deps, handlers, asked: [] };
}

const committed = (name: string): string => join(ROOT, 'topology', name);

const files = (catalog: string): NativeDependencies['files'] => ({
  catalog: committed(catalog),
  servers: committed('modules.mcp.json'),
  clients: committed('clients.json'),
});

/** A port held by a listener of the scenario until its end. */
async function heldPort(world: GatewayWorld): Promise<number> {
  const holder = createServer();
  const port = await listen(holder);
  world.cleanups.push(() => closed(holder));
  return port;
}

Given(
  'a native composition whose topology has no catalogue, and a callback port another listener already holds',
  async function () {
    this.state['native-composition'] = dependencies(files('no-such-catalog.json'), await heldPort(this));
  },
);

Given(
  'a native composition over the committed topology, and a callback port another listener already holds',
  async function () {
    this.state['native-composition'] = dependencies(files('catalog.json'), await heldPort(this));
  },
);

Given('a native composition over the committed topology on any free callback port', function () {
  this.state['native-composition'] = dependencies(files('catalog.json'), 0);
});

Given(
  'a native composition over the committed topology for the profile {string}, on any free callback port',
  function (profile: string) {
    this.state['native-composition'] = dependencies(files('catalog.json'), 0, profile);
  },
);

Given(
  'a native composition over the committed topology and a second client profile {string}, for that profile, on any free callback port',
  function (profile: string) {
    const committedClients = JSON.parse(readFileSync(committed('clients.json'), 'utf8')) as {
      profiles: Record<string, unknown>[];
    };
    const dir = mkdtempSync(join(tmpdir(), 'native-composition-'));
    this.cleanups.push(() => rmSync(dir, { recursive: true }));
    const clients = join(dir, 'clients.json');
    writeFileSync(
      clients,
      JSON.stringify({
        profiles: [
          ...committedClients.profiles,
          { ...committedClients.profiles[0], name: profile, owner: false },
        ],
      }),
    );
    this.state['native-composition'] = dependencies({ ...files('catalog.json'), clients }, 0, profile);
  },
);

/** Data and the broker answer every operation with a text, and data records what it was asked. */
function accepting(current: Scene): void {
  const answer = { content: [{ type: 'text' as const, text: 'ok' }] };
  current.deps.data = {
    callTool: (params) => {
      current.asked.push({ name: params.name, arguments: params.arguments });
      return Promise.resolve(answer);
    },
  };
  current.deps.broker = { ...current.deps.broker, callTool: () => Promise.resolve(answer) };
}

Given(
  'a native composition over the committed topology on any free callback port, whose data and broker accept every operation',
  function () {
    const current = dependencies(files('catalog.json'), 0);
    accepting(current);
    this.state['native-composition'] = current;
  },
);

Given(
  'a native composition over the committed topology and a client profile {string} of the module {string}, with fake module sandboxes, on any free callback port',
  function (profile: string, module: string) {
    const committedClients = JSON.parse(readFileSync(committed('clients.json'), 'utf8')) as {
      profiles: Record<string, unknown>[];
    };
    const dir = mkdtempSync(join(tmpdir(), 'native-composition-'));
    this.cleanups.push(() => rmSync(dir, { recursive: true }));
    const clients = join(dir, 'clients.json');
    writeFileSync(
      clients,
      JSON.stringify({
        profiles: [
          ...committedClients.profiles,
          { ...committedClients.profiles[0], name: profile, modules: [module], owner: false },
        ],
      }),
    );
    const current = dependencies({ ...files('catalog.json'), clients }, 0, profile);
    accepting(current);
    current.modules = new FakeModuleRunner();
    current.deps.runners = () => current.modules!;
    this.state['native-composition'] = current;
  },
);

When(
  'a task is opened through the composed router for the profile {string}',
  async function (profile: string) {
    const current = scene(this);
    current.task = (await current.composed!.router.open('cli', profile)).task;
  },
);

When('the composed router calls {string} for that task', async function (address: string) {
  const current = scene(this);
  await current.composed!.router.call({ task: current.task! }, address, {});
});

When('the sandbox of the module {string} refuses to stop', function (module: string) {
  const { modules } = scene(this);
  modules!.unstoppable.add(module);
  // Pushed after the cleanup of the composition, so it runs first: the sandbox then stops with the second close.
  this.cleanups.push(() => void modules!.unstoppable.delete(module));
});

Given(
  'a native composition over the committed topology with fake sandboxes whose launches are held, on any free callback port',
  function () {
    const current = dependencies(files('catalog.json'), 0);
    accepting(current);
    current.modules = new FakeModuleRunner();
    current.release = current.modules.hold();
    current.deps.runners = () => current.modules!;
    this.state['native-composition'] = current;
  },
);

When('the composed router calls {string} for that task without waiting', async function (address: string) {
  const current = scene(this);
  // The call is refused once its task is ended under it: what it gives is not what the scenario is about.
  void current.composed!.router.call({ task: current.task! }, address, {}).catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
});

When('the native composition starts to close', async function () {
  const current = scene(this);
  current.closed = { over: false };
  const mark = (): void => void (current.closed!.over = true);
  current.composed!.close().then(mark, mark);
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
});

Then('the closing of the composition is not over', function () {
  assert.equal(scene(this).closed!.over, false);
});

When('the held launches of the composition go on', function () {
  scene(this).release!();
});

Then(
  'the closing of the composition is over, and the {int} sandbox it launched has ended',
  async function (count: number) {
    const current = scene(this);
    const deadline = Date.now() + 5000;
    while (!current.closed!.over && Date.now() < deadline)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(current.closed!.over, true);
    assert.equal(current.modules!.started.length, count);
    assert.equal(current.modules!.ended.length, count);
  },
);

When('the audit log of the composition refuses to be written', function () {
  scene(this).deps.audit.record = () => Promise.reject(new Error('the audit log is closed'));
});

Then('the sandbox of the module {string} ended', function (module: string) {
  assert.deepEqual(scene(this).modules!.ended, [module]);
});

Then('data was asked to end that task as {string}, after it opened it', function (ending: string) {
  const { asked, task } = scene(this);
  assert.deepEqual(
    asked.map(({ name }) => name),
    ['tasks.open', 'tasks.end'],
  );
  assert.deepEqual(asked[1]!.arguments, { task, ending });
});

Then('the closing is refused with {string}', function (message: string) {
  const { closing } = scene(this);
  assert.ok(closing?.failed, 'the closing succeeded');
  assert.equal((closing.error as Error).message, message);
});

When('the native gateway is composed', async function () {
  const current = scene(this);
  try {
    const composed = await composeNative(current.deps);
    this.cleanups.push(() => composed.close());
    current.composed = composed;
    current.refusal = null;
  } catch (error) {
    current.refusal = error;
  }
});

Then('the native composition is refused for its topology, not for the port', function () {
  const { refusal } = scene(this);
  assert.ok(refusal instanceof Error, String(refusal));
  assert.match(refusal.message, /no-such-catalog\.json/);
  assert.doesNotMatch(refusal.message, /EADDRINUSE/);
});

Then('the native composition is refused with the code {string}', function (code: string) {
  const { refusal } = scene(this);
  assert.ok(refusal instanceof Error, String(refusal));
  assert.equal((refusal as NodeJS.ErrnoException).code, code);
});

/** What a connection to the callback port of the composition meets: `connected`, or the code of its refusal. */
const reach = (port: number): Promise<string> =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => (socket.destroy(), resolve('connected')));
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(String(error.code)));
  });

Then(
  'the callback host of the composition listens on {string} and accepts a connection',
  async function (address: string) {
    const { composed } = scene(this);
    assert.ok(composed !== undefined, String(scene(this).refusal));
    assert.equal(composed.callback.address, address);
    assert.equal(await reach(composed.callback.port), 'connected');
  },
);

When('the native composition is closed', async function () {
  await scene(this).composed!.close();
});

When('the native composition is closed, and its closing is awaited whatever it does', async function () {
  const current = scene(this);
  current.closing = await attempt(() => current.composed!.close());
});

Then('nothing listens on the callback port any more', async function () {
  assert.equal(await reach(scene(this).composed!.callback.port), 'ECONNREFUSED');
});

Then(
  'the native composition is refused with {string} saying {string}',
  function (code: string, message: string) {
    const { refusal } = scene(this);
    assert.ok(refusal instanceof GatewayError, String(refusal));
    assert.deepEqual({ code: refusal.code, message: refusal.message }, { code, message });
  },
);

Then('the refused composition left the usage handler of the broker client untouched', function () {
  assert.equal(scene(this).handlers.set, 0);
});

Then('the composition set the usage handler of the broker client once', function () {
  assert.equal(scene(this).handlers.set, 1);
});
