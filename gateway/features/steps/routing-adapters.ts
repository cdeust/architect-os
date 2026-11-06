import assert from 'node:assert/strict';
import type { DataOpName, TaskEnding } from '@architect-os/contracts';
import type { ServiceResponse } from '../../src/domain/ports.js';
import type {
  DataClient,
  Ids,
  ModuleClient,
  TaskRegistry,
  TaskSandboxes,
  TaskTokens,
} from '../../src/domain/routing.js';
import {
  InMemoryDataClient,
  InMemoryModules,
  InMemoryTaskRegistry,
  InMemoryTaskSandboxes,
  InMemoryTaskTokens,
  SequentialIds,
} from '../../src/infrastructure/in-memory-routing.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InMemorySandboxRunner } from '@architect-os/sandbox';
import { GatewayError } from '../../src/domain/errors.js';
import { UsageForwarder } from '../../src/application/usage-forwarder.js';
import {
  InMemoryBrokerControl,
  InMemoryUsageSink,
  ManualScheduler,
} from '../../src/infrastructure/in-memory-usage.js';
import { McpDataClient, McpTaskRegistry, RandomIds } from '../../src/infrastructure/mcp-routing.js';
import { ModuleHost } from '../../src/infrastructure/module-host.js';
import { TaskSandboxGroups } from '../../src/infrastructure/task-sandboxes.js';
import { FakeModuleRunner } from './fake-modules.js';
import { Given, Then, When, type GatewayWorld } from './helpers.js';

/**
 * A fake of data for the contracts of its MCP adapters, over the SDK in this process: the tasks of the registry (open,
 * end once, get) and an echo of any other operation. The real data server is proven by its own features and by
 * features/integration/gateway.feature; a component does not import another.
 */
async function fakeData(world: GatewayWorld, state: 'up' | 'down' | 'storeless' = 'up'): Promise<Client> {
  const server = new Server({ name: 'fake-data', version: '0.0.0' }, { capabilities: { tools: {} } });
  const tasks = new Map<string, Record<string, unknown>>();
  const answer = (value: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError, structuredContent: value as Record<string, unknown> } : {}),
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args = {} } }) => {
    if (state === 'storeless') return answer({ code: 'INTERNAL', message: 'internal error' }, true);
    // An error answer without structured content, as a server other than data could give.
    if (name === 'runs.get') return { content: [{ type: 'text' as const, text: 'refused' }], isError: true };
    const task = String(args['task']);
    if (name === 'tasks.open') {
      tasks.set(task, { ...args });
      return answer(tasks.get(task));
    }
    if (name === 'tasks.end' || name === 'tasks.get') {
      const record = tasks.get(task);
      if (record === undefined)
        return answer({ code: 'NOT_FOUND', message: `${name}: no such record` }, true);
      if (name === 'tasks.end') {
        if (record['ending'] !== undefined)
          return answer({ code: 'INVALID_OPERATION', message: 'tasks.end: invalid operation' }, true);
        record['ending'] = args['ending'];
      }
      return answer(record);
    }
    return answer(`${name} ${JSON.stringify(args)}`);
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test-gateway', version: '0.0.0' });
  await client.connect(clientSide);
  world.cleanups.push(() => server.close());
  if (state === 'down') await server.close();
  return client;
}

/**
 * The contracts of the ports of the routing (gateway/features/adapters.feature): each adapter is built with what reads
 * back its effect, the in-memory ones through their records; the MCP adapters join their rows with the gateway's
 * infrastructure (brick 1b.4, commit 3).
 */
interface Contracts {
  registry?: TaskRegistry;
  ended?: (task: string) => Promise<unknown>;
  tokens?: TaskTokens;
  honoured?: (token: string) => string | undefined;
  ids?: Ids;
  modules?: ModuleClient;
  data?: DataClient;
  answer?: ServiceResponse;
  sandboxes?: TaskSandboxes;
  stopped?: (task: string) => Promise<boolean>;
  refusal?: unknown;
  runner?: FakeModuleRunner;
}

const contracts = (world: GatewayWorld): Contracts => (world.state['routing-contracts'] ??= {}) as Contracts;

function must<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `${what} must be given first`);
  return value;
}

const inMemory = (adapter: string): void => assert.equal(adapter, 'in-memory', `unknown adapter: ${adapter}`);

Given('the {string} task registry', async function (adapter: string) {
  if (adapter === 'mcp') {
    const data = await fakeData(this);
    Object.assign(contracts(this), {
      registry: new McpTaskRegistry(data),
      ended: async (task: string) => {
        const got = await data.callTool({ name: 'tasks.get', arguments: { task } });
        return (JSON.parse((got.content as { text: string }[])[0]!.text) as { ending?: string }).ending;
      },
    });
    return;
  }
  inMemory(adapter);
  const registry = new InMemoryTaskRegistry();
  Object.assign(contracts(this), {
    registry,
    ended: async (task: string) => registry.ended.find((end) => end.task === task)?.ending,
  });
});

Then('the registry refuses to end {string} again', async function (task: string) {
  await assert.rejects(must(contracts(this).registry, 'a registry').end(task, 'completed'), {
    message: /tasks.end: invalid operation/,
  });
});

When('the registry opens the task {string}', async function (task: string) {
  await must(contracts(this).registry, 'a registry').open(JSON.parse(task));
});

When('the registry ends {string} with {string}', async function (task: string, ending: TaskEnding) {
  await must(contracts(this).registry, 'a registry').end(task, ending);
});

Then('the registry reads back {string} ended with {string}', async function (task: string, ending: string) {
  assert.equal(await must(contracts(this).ended, 'a registry')(task), ending);
});

Given('the {string} task tokens', function (adapter: string) {
  if (adapter === 'usage forwarder') {
    const broker = new InMemoryBrokerControl();
    Object.assign(contracts(this), {
      tokens: new UsageForwarder(new InMemoryUsageSink(), broker, new ManualScheduler(), 250),
      honoured: (token: string) => broker.granted.get(token)?.task,
    });
    return;
  }
  inMemory(adapter);
  const tokens = new InMemoryTaskTokens();
  Object.assign(contracts(this), {
    tokens,
    honoured: (token: string) =>
      tokens.retired.includes(token)
        ? undefined
        : tokens.granted.find((grant) => grant.token === token)?.task,
  });
});

When('the tokens grant {string} to {string}', async function (token: string, task: string) {
  await must(contracts(this).tokens, 'tokens').grant({ token, task });
});

When('the tokens retire {string}', async function (token: string) {
  await must(contracts(this).tokens, 'tokens').retire(token);
});

Then('the token {string} is honoured for {string}', function (token: string, task: string) {
  assert.equal(must(contracts(this).honoured, 'tokens')(token), task);
});

Then('the token {string} is not honoured', function (token: string) {
  assert.equal(must(contracts(this).honoured, 'tokens')(token), undefined);
});

Given('the {string} identifiers', function (adapter: string) {
  if (adapter === 'random') {
    contracts(this).ids = new RandomIds();
    return;
  }
  assert.equal(adapter, 'sequential', `unknown adapter: ${adapter}`);
  contracts(this).ids = new SequentialIds();
});

Then(
  '{int} identifiers of the kind {string} are distinct and start with {string}',
  function (count: number, kind: 'task' | 'token' | 'call', prefix: string) {
    const ids = must(contracts(this).ids, 'identifiers');
    const made = Array.from({ length: count }, () => ids.next(kind));
    assert.equal(new Set(made).size, count);
    for (const id of made) assert.ok(id.startsWith(prefix), id);
  },
);

Given('the {string} module client', function (adapter: string) {
  if (adapter === 'mcp') {
    const host = new ModuleHost(
      { mcpServers: { judge: { command: 'node', args: ['modules/judge/dist/src/serve.js'] } } },
      new FakeModuleRunner(),
      { profile: 'module', cwd: '.' },
    );
    this.cleanups.push(() => host.close());
    contracts(this).modules = host;
    return;
  }
  inMemory(adapter);
  contracts(this).modules = new InMemoryModules();
});

When(
  'the module client calls {string} tool {string} with {string} and the call identifier {string}',
  async function (module: string, tool: string, args: string, call: string) {
    contracts(this).answer = await must(contracts(this).modules, 'a module client').call({
      module,
      tool,
      args: JSON.parse(args) as Record<string, unknown>,
      call,
      timeoutMs: 1000,
      signal: new AbortController().signal,
    });
  },
);

Given('a module host over no server', function () {
  const runner = new FakeModuleRunner();
  const host = new ModuleHost({ mcpServers: {} }, runner, { profile: 'module', cwd: '.' });
  Object.assign(contracts(this), { modules: host, runner });
});

When(
  'the module client calls {string} tool {string} with {string} and the call identifier {string}, refused',
  async function (module: string, tool: string, args: string, call: string) {
    contracts(this).refusal = await must(contracts(this).modules, 'a module client')
      .call({
        module,
        tool,
        args: JSON.parse(args) as Record<string, unknown>,
        call,
        timeoutMs: 1000,
        signal: new AbortController().signal,
      })
      .then(
        () => assert.fail('the call was answered'),
        (error: unknown) => error,
      );
  },
);

Then('the module call is refused with code {string}', function (code: string) {
  assert.equal((contracts(this).refusal as { code?: string }).code, code);
});

Then('the module host launched no sandbox', function () {
  assert.deepEqual(must(contracts(this).runner, 'a module host').started, []);
});

Then('the module answer is {string}', function (text: string) {
  assert.deepEqual(contracts(this).answer, { structured: undefined, text, isError: false });
});

Given('the {string} data client', async function (adapter: string) {
  if (adapter === 'mcp') {
    contracts(this).data = new McpDataClient(await fakeData(this));
    return;
  }
  inMemory(adapter);
  contracts(this).data = new InMemoryDataClient();
});

When('the data client executes {string} with {string}', async function (op: string, args: string) {
  contracts(this).answer = await must(contracts(this).data, 'a data client').execute(
    op as DataOpName,
    JSON.parse(args) as Record<string, unknown>,
  );
});

Given('the {string} data client while {}', async function (adapter: string, state: string) {
  const down = state === 'data is down';
  assert.ok(down || state === 'data cannot reach its store', `unknown state: ${state}`);
  if (adapter === 'mcp') {
    contracts(this).data = new McpDataClient(await fakeData(this, down ? 'down' : 'storeless'));
    return;
  }
  inMemory(adapter);
  const data = new InMemoryDataClient();
  data.unavailable = new GatewayError('SERVICE_UNAVAILABLE', 'data did not answer memory.search: down');
  contracts(this).data = data;
});

When('the data client executes {string} with {string}, refused', async function (op: string, args: string) {
  contracts(this).refusal = await must(contracts(this).data, 'a data client')
    .execute(op as DataOpName, JSON.parse(args) as Record<string, unknown>)
    .then(
      () => assert.fail('data answered'),
      (error: unknown) => error,
    );
});

Then('the data call is refused with code {string} saying {string}', function (code: string, saying: string) {
  const error = contracts(this).refusal as { code?: string; message?: string };
  assert.equal(error.code, code);
  assert.ok(error.message?.startsWith(saying), String(error.message));
});

Then('the data answer matches {string}', function (expected: string) {
  const answer = contracts(this).answer as unknown as Record<string, unknown>;
  const wanted = JSON.parse(expected) as Record<string, unknown>;
  assert.equal(answer['isError'], wanted['isError']);
  assert.equal(
    (answer['structured'] as { code?: string } | undefined)?.code,
    (wanted['structured'] as { code?: string } | undefined)?.code,
  );
});

Then('the module call refusal says {string}', function (message: string) {
  assert.equal((contracts(this).refusal as Error).message, message);
});

Given(
  'the task sandbox groups with {int} sandboxes of {string}',
  async function (count: number, task: string) {
    const groups = new TaskSandboxGroups();
    const stops: number[] = [];
    const runner = new InMemorySandboxRunner(['worker']);
    for (let index = 0; index < count; index += 1) {
      const sandbox = await runner.start({ profile: 'worker', cwd: '.', command: ['w'] });
      stops.push(0);
      groups.add(task, {
        ...sandbox,
        stop: () => ((stops[index] = (stops[index] ?? 0) + 1), sandbox.stop()),
      });
    }
    this.state['groups'] = { groups, stops };
  },
);

When('the sandbox groups stop {string}', async function (task: string) {
  await (this.state['groups'] as { groups: TaskSandboxGroups }).groups.stop(task);
});

Then('each sandbox of {string} was stopped once', function (_task: string) {
  const { stops } = this.state['groups'] as { stops: number[] };
  assert.deepEqual(stops, [1, 1]);
});

Then('the data answer is {string}', function (text: string) {
  assert.deepEqual(contracts(this).answer, { structured: undefined, text, isError: false });
});

Given('the {string} task sandboxes of {string}', async function (adapter: string, task: string) {
  if (adapter === 'in-memory') {
    const sandboxes = new InMemoryTaskSandboxes();
    Object.assign(contracts(this), {
      sandboxes,
      stopped: async (gone: string) => sandboxes.stopped.includes(gone),
    });
    return;
  }
  assert.equal(adapter, 'groups', `unknown adapter: ${adapter}`);
  const groups = new TaskSandboxGroups();
  const sandbox = await new InMemorySandboxRunner(['worker']).start({
    profile: 'worker',
    cwd: '.',
    command: ['w'],
  });
  groups.add(task, sandbox);
  let exited = false;
  void sandbox.exited.then(() => (exited = true));
  Object.assign(contracts(this), {
    sandboxes: groups,
    stopped: async () => (await Promise.resolve(), exited),
  });
});

When('the sandboxes of {string} are stopped', async function (task: string) {
  await must(contracts(this).sandboxes, 'sandboxes').stop(task);
});

Then('the sandboxes of {string} are gone', async function (task: string) {
  assert.equal(await must(contracts(this).stopped, 'sandboxes')(task), true);
});
