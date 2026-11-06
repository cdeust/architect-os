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
import { Given, Then, When, type GatewayWorld } from './helpers.js';

/**
 * The contracts of the ports of the routing (gateway/features/adapters.feature): each adapter is built with what reads
 * back its effect, the in-memory ones through their records; the MCP adapters join their rows with the gateway's
 * infrastructure (brick 1b.4, commit 3).
 */
interface Contracts {
  registry?: TaskRegistry;
  ended?: (task: string) => TaskEnding | undefined;
  tokens?: TaskTokens;
  honoured?: (token: string) => string | undefined;
  ids?: Ids;
  modules?: ModuleClient;
  data?: DataClient;
  answer?: ServiceResponse;
  sandboxes?: TaskSandboxes;
  stopped?: (task: string) => boolean;
}

const contracts = (world: GatewayWorld): Contracts => (world.state['routing-contracts'] ??= {}) as Contracts;

function must<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `${what} must be given first`);
  return value;
}

const inMemory = (adapter: string): void => assert.equal(adapter, 'in-memory', `unknown adapter: ${adapter}`);

Given('the {string} task registry', function (adapter: string) {
  inMemory(adapter);
  const registry = new InMemoryTaskRegistry();
  Object.assign(contracts(this), {
    registry,
    ended: (task: string) => registry.ended.find((end) => end.task === task)?.ending,
  });
});

When('the registry opens the task {string}', async function (task: string) {
  await must(contracts(this).registry, 'a registry').open(JSON.parse(task));
});

When('the registry ends {string} with {string}', async function (task: string, ending: TaskEnding) {
  await must(contracts(this).registry, 'a registry').end(task, ending);
});

Then('the registry reads back {string} ended with {string}', function (task: string, ending: string) {
  assert.equal(must(contracts(this).ended, 'a registry')(task), ending);
});

Given('the {string} task tokens', function (adapter: string) {
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

Then('the module answer is {string}', function (text: string) {
  assert.deepEqual(contracts(this).answer, { structured: undefined, text, isError: false });
});

Given('the {string} data client', function (adapter: string) {
  inMemory(adapter);
  contracts(this).data = new InMemoryDataClient();
});

When('the data client executes {string} with {string}', async function (op: string, args: string) {
  contracts(this).answer = await must(contracts(this).data, 'a data client').execute(
    op as DataOpName,
    JSON.parse(args) as Record<string, unknown>,
  );
});

Then('the data answer is {string}', function (text: string) {
  assert.deepEqual(contracts(this).answer, { structured: undefined, text, isError: false });
});

Given('the {string} task sandboxes', function (adapter: string) {
  inMemory(adapter);
  const sandboxes = new InMemoryTaskSandboxes();
  Object.assign(contracts(this), { sandboxes, stopped: (task: string) => sandboxes.stopped.includes(task) });
});

When('the sandboxes of {string} are stopped', async function (task: string) {
  await must(contracts(this).sandboxes, 'sandboxes').stop(task);
});

Then('the sandboxes of {string} are gone', function (task: string) {
  assert.equal(must(contracts(this).stopped, 'sandboxes')(task), true);
});
