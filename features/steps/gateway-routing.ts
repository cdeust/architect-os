import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DataOperations } from '../../data/src/application/operations.js';
import { InMemoryDataStore } from '../../data/src/infrastructure/in-memory.js';
import { createDataMcpServer } from '../../data/src/presentation/mcp-server.js';
import type { TaskRouter } from '../../gateway/src/application/task-router.js';
import type { ServiceResponse } from '../../gateway/src/domain/ports.js';
import { InMemoryAuditLog } from '../../gateway/src/infrastructure/in-memory.js';
import {
  InMemoryTaskSandboxes,
  InMemoryTaskTokens,
  ManualTime,
  SequentialIds,
} from '../../gateway/src/infrastructure/in-memory-routing.js';
import type { ModuleHost } from '../../gateway/src/infrastructure/module-host.js';
import { composeRouting } from '../../gateway/src/main.js';
import { FakeModuleRunner } from '../../gateway/features/steps/fake-modules.js';
import type { ArchitectWorld } from '../support/world.js';
import { Given, Then, When, assertMatches } from './helpers.js';

interface Routing {
  runner: FakeModuleRunner;
  data: Client;
  time: ManualTime;
  router?: TaskRouter;
  host?: ModuleHost;
  pending?: Promise<{ value?: ServiceResponse; error?: unknown }>;
  outcome?: { value?: ServiceResponse; error?: unknown };
  loading?: unknown;
  both?: { value?: ServiceResponse; error?: unknown }[];
}

const routing = (world: ArchitectWorld): Routing => {
  const found = world.state['gateway-routing'] as Routing | undefined;
  assert.ok(found, 'the gateway must be given first');
  return found;
};

const TOPOLOGY = 'gateway/features/fixtures/topology.json';

/** The three files of the topology, split from the fixture into a fresh directory; `change` breaks the catalogue. */
function topologyFiles(
  world: ArchitectWorld,
  change?: (catalog: { modules: Record<string, unknown>[] }) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), 'topology-'));
  world.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const whole = JSON.parse(readFileSync(TOPOLOGY, 'utf8')) as Record<string, unknown>;
  const catalog = whole['catalog'] as { modules: Record<string, unknown>[] };
  change?.(catalog);
  const files = {
    catalog: join(dir, 'catalog.json'),
    servers: join(dir, 'modules.mcp.json'),
    clients: join(dir, 'clients.json'),
  };
  writeFileSync(files.catalog, JSON.stringify(catalog));
  writeFileSync(files.servers, JSON.stringify(whole['servers']));
  writeFileSync(files.clients, JSON.stringify(whole['clients']));
  return files;
}

async function load(world: ArchitectWorld, change?: Parameters<typeof topologyFiles>[1]): Promise<void> {
  const scene = routing(world);
  const { router, modules } = await composeRouting({
    files: topologyFiles(world, change),
    runner: scene.runner,
    launch: { profile: 'module', cwd: '.' },
    data: scene.data,
    tokens: new InMemoryTaskTokens(),
    sandboxes: new InMemoryTaskSandboxes(),
    audit: new InMemoryAuditLog(),
    clock: scene.time,
    scheduler: scene.time,
    ids: new SequentialIds(),
  });
  world.cleanups.push(() => modules.close());
  Object.assign(scene, { router, host: modules });
}

Given(
  'the gateway over the topology gateway\\/features\\/fixtures\\/topology.json, its modules in fake sandboxes and data over MCP',
  async function () {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createDataMcpServer(new DataOperations(new InMemoryDataStore()));
    await server.connect(serverSide);
    const data = new Client({ name: 'test-gateway', version: '0.0.0' });
    await data.connect(clientSide);
    this.cleanups.push(() => server.close());
    this.state['gateway-routing'] = {
      runner: new FakeModuleRunner(),
      data,
      time: new ManualTime(new Date('2026-11-06T09:00:00.000Z')),
    } satisfies Routing;
    await load(this);
  },
);

Given(
  'the task {string} opened by {string} with the profile {string}',
  async function (task: string, client: string, profile: string) {
    const opened = await routing(this).router!.open(client, profile);
    assert.equal(opened.task, task);
  },
);

Given('the module {string} hangs until its call is cancelled', function (module: string) {
  routing(this).runner.hanging.add(module);
});

Given('the module {string} no longer hangs', function (module: string) {
  routing(this).runner.hanging.delete(module);
});

Given(
  'the sandbox of {string} writes what is not MCP at its next {int} launches',
  function (module: string, count: number) {
    routing(this).runner.garbling.set(module, count);
  },
);

When('{string} calls {string} over MCP twice at once', async function (task: string, address: string) {
  const scene = routing(this);
  const both = await Promise.all([1, 2].map(() => attempt(() => scene.router!.call({ task }, address, {}))));
  scene.both = both;
});

Then('both answers over MCP are {string}', function (text: string) {
  assert.deepEqual(
    routing(this).both?.map((got) => got.value?.text),
    [text, text],
  );
});

When('the gateway stops its modules', async function () {
  await routing(this).host!.close();
});

Then('the sandboxes ended are {string}', async function (modules: string) {
  await until(
    () => routing(this).runner.ended.length === modules.split(', ').length,
    `the sandboxes ${modules} ended`,
  );
  assert.deepEqual(routing(this).runner.ended, modules.split(', '));
});

Given('the sandbox of {string} fails its next {int} launches', function (module: string, count: number) {
  routing(this).runner.failing.set(module, count);
});

const attempt = (work: () => Promise<ServiceResponse>) =>
  work().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

When(
  '{string} calls {string} over MCP with {string}',
  async function (task: string, address: string, args: string) {
    const scene = routing(this);
    scene.outcome = await attempt(() => scene.router!.call({ task }, address, JSON.parse(args)));
  },
);

When(
  '{string} calls {string} over MCP with {string} without waiting',
  async function (task: string, address: string, args: string) {
    const scene = routing(this);
    scene.pending = attempt(() => scene.router!.call({ task }, address, JSON.parse(args)));
    await until(() => scene.runner.received.length > 0, 'the module received the call');
  },
);

When('{int} ms pass for the gateway', function (ms: number) {
  routing(this).time.pass(ms);
});

When('the sandbox of {string} is killed', async function (module: string) {
  const { runner } = routing(this);
  const before = runner.ended.length;
  runner.kill(module);
  await until(() => runner.ended.length > before, `the sandbox of ${module} ended`);
});

When('the client completes {string} over MCP', async function (task: string) {
  await routing(this).router!.complete(task);
});

When('the gateway is loaded with a catalogue where {string} calls itself', async function (module: string) {
  const scene = routing(this);
  scene.runner.started.length = 0;
  scene.loading = await load(this, (catalog) => {
    const found = catalog.modules.find((candidate) => candidate['name'] === module)!;
    (found['calls_allowed'] as string[]).push(module);
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
});

async function outcome(world: ArchitectWorld) {
  const scene = routing(world);
  if (scene.pending !== undefined) {
    scene.outcome = await scene.pending;
    scene.pending = undefined;
  }
  return scene.outcome;
}

/** The text of the answer, or, given as JSON with a `text` field, the whole answer: text, error flag, structured. */
Then('the answer over MCP is {string}', async function (expected: string) {
  const got = await outcome(this);
  assert.ok(got?.value, `the call failed: ${String(got?.error)}`);
  if (!expected.startsWith('{"text"')) return assert.equal(got.value.text, expected);
  assert.deepEqual(got.value, { structured: undefined, ...(JSON.parse(expected) as object) });
});

Given('the module {string} answers {string}', function (module: string, answer: string) {
  routing(this).runner.answers.set(module, JSON.parse(answer) as Record<string, unknown>);
});

Then('the module {string} saw the client {string}', function (module: string, client: string) {
  const seen = routing(this).runner.received.filter((received) => received.module === module);
  assert.deepEqual(seen.at(-1)?.client, JSON.parse(client));
});

Then(
  'the call over MCP is refused with {string} saying {string}',
  async function (code: string, saying: string) {
    const got = await outcome(this);
    const error = got?.error as { code?: string; message?: string } | undefined;
    assert.equal(error?.code, code, String(got?.error));
    assert.ok(error?.message?.startsWith(saying), String(error?.message));
  },
);

Then('the call over MCP is refused with {string}', async function (code: string) {
  const got = await outcome(this);
  assert.equal((got?.error as { code?: string } | undefined)?.code, code, String(got?.error));
});

Then(
  'the module {string} received {string} with the call identifier {string}',
  function (module: string, tool: string, call: string) {
    assert.deepEqual(
      routing(this).runner.received.map(({ module: m, tool: t, call: c }) => ({
        module: m,
        tool: t,
        call: c,
      })),
      [{ module, tool, call }],
    );
  },
);

Then('the module {string} saw the call {string} cancelled', async function (_module: string, call: string) {
  await until(
    () => routing(this).runner.cancelled.includes(call),
    `the cancellation of ${call} at the module`,
  );
});

Then('the sandboxes launched are {string}', function (modules: string) {
  assert.deepEqual(routing(this).runner.started, modules === '' ? [] : modules.split(', '));
});

Then('data holds the task {string}', async function (expected: string) {
  const { task } = JSON.parse(expected) as { task: string };
  const got = await routing(this).data.callTool({ name: 'tasks.get', arguments: { task } });
  assertMatches(JSON.parse((got.content as { text: string }[])[0]!.text), JSON.parse(expected));
});

Then('loading the gateway fails saying {string}', function (message: string) {
  const error = routing(this).loading;
  assert.ok(error instanceof Error, 'the gateway loaded');
  assert.ok(error.message.includes(message), error.message);
});

/** Waits until `done` holds, polling every 5 ms, at most 2 s: MCP over streams is asynchronous. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 2000; waited += 5) {
    if (done()) return;
    await sleep(5);
  }
  assert.fail(`not within 2 s: ${what}`);
}
