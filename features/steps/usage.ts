import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { UsageAppendInput } from '@architect-os/contracts';
import { DataOperations } from '../../data/src/application/operations.js';
import type { DataStore } from '../../data/src/domain/ports.js';
import { InMemoryDataStore } from '../../data/src/infrastructure/in-memory.js';
import { createDataMcpServer } from '../../data/src/presentation/mcp-server.js';
import { UsageForwarder } from '../../gateway/src/application/usage-forwarder.js';
import type { AppendOutcome, BrokerControl, UsageSink } from '../../gateway/src/domain/ports.js';
import { InMemoryBrokerControl, InMemoryUsageSink } from '../../gateway/src/infrastructure/in-memory.js';
import {
  McpBrokerControl,
  McpUsageSink,
  TimerScheduler,
  onUsage,
} from '../../gateway/src/infrastructure/usage-adapters.js';
import { start, type StartedBroker } from '../../modules/broker/src/main.js';
import { stdioTransport } from '../../modules/broker/src/presentation/mcp-server.js';
import {
  fakeUpstream,
  keyFile,
  send,
  stdioPair,
  testConfig,
} from '../../modules/broker/features/steps/harness.js';
import type { ArchitectWorld } from '../support/world.js';
import { Given, Then, When, assertMatches } from './helpers.js';

type Caller = Pick<Client, 'callTool'>;

/** What the gateway holds of data: a client it may swap, as the gateway of 1b.4 reconnects to a data relaunched. */
class DataLink implements Caller {
  current: Caller | undefined;
  callTool: Caller['callTool'] = (...args) => {
    assert.ok(this.current, 'data was never served');
    return this.current.callTool(...args);
  };
}

/** Serves a data MCP server over `store` in this process and gives the client of the gateway, and its end. */
async function serveData(
  world: ArchitectWorld,
  store: DataStore,
): Promise<{ client: Client; gone: () => Promise<void> }> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createDataMcpServer(new DataOperations(store));
  await server.connect(serverSide);
  const client = new Client({ name: 'test-gateway', version: '0.0.0' });
  await client.connect(clientSide);
  world.cleanups.push(() => server.close());
  return { client, gone: () => server.close() };
}

interface UsageScene {
  sink?: UsageSink & { gone?: () => Promise<void> };
  outcome?: AppendOutcome;
  control?: BrokerControl;
  honours?: (token: string) => { task: string } | null;
  link?: DataLink;
  gone?: () => Promise<void>;
  data?: Client;
  forwarder?: UsageForwarder;
  broker?: StartedBroker;
  lastStatus?: number;
}

const scene = (world: ArchitectWorld): UsageScene => (world.state['usage'] ??= {}) as UsageScene;

function must<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `${what} must be given first`);
  return value;
}

/** Starts the real broker over a fake upstream, its MCP client being the gateway's, usage handed to `receive`. */
async function startBroker(world: ArchitectWorld, receive?: (data: unknown) => Promise<void>) {
  const upstream = await fakeUpstream();
  const key = keyFile('sk-test-key-of-the-scenario');
  world.cleanups.push(
    () => upstream.close(),
    () => key.remove(),
  );
  const pair = stdioPair();
  const started = start(testConfig(upstream.url, key.file), stdioTransport(pair.stdin, pair.stdout), 0);
  const client = new Client({ name: 'test-gateway', version: '0.0.0' });
  if (receive !== undefined) onUsage(client, receive);
  await client.connect(pair.client);
  const broker = await started;
  world.cleanups.push(() => broker.close());
  scene(world).broker = broker;
  return { broker, client };
}

// --- the contracts of the two ports, on every adapter ---

Given('the {string} usage sink', async function (adapter: string) {
  if (adapter === 'in-memory') {
    const sink = new InMemoryUsageSink();
    scene(this).sink = sink;
    scene(this).gone = async () => void (sink.reachable = false);
  } else {
    assert.equal(adapter, 'mcp', `unknown usage sink adapter: ${adapter}`);
    const data = await serveData(this, new InMemoryDataStore());
    scene(this).sink = new McpUsageSink(data.client);
    scene(this).gone = data.gone;
  }
});

Given(
  'the {string} usage sink over a store that fails with {string}',
  async function (adapter: string, message: string) {
    assert.equal(adapter, 'mcp');
    const data = await serveData(this, {
      execute: async () => {
        throw new Error(message);
      },
    });
    scene(this).sink = new McpUsageSink(data.client);
  },
);

Given('data is gone', async function () {
  await must(scene(this).gone, 'a data')();
});

When('the gateway appends the usage record {string}', async function (record: string) {
  scene(this).outcome = await must(scene(this).sink, 'a usage sink').append(
    JSON.parse(record) as UsageAppendInput,
  );
});

Then('the append outcome is {string}', function (outcome: string) {
  assert.equal(scene(this).outcome, outcome);
});

Then(
  'appending the usage record {string} fails with {string}',
  async function (record: string, code: string) {
    await assert.rejects(
      must(scene(this).sink, 'a usage sink').append(JSON.parse(record) as UsageAppendInput),
      {
        code,
      },
    );
  },
);

Then('the usage sink is available', async function () {
  assert.equal(await must(scene(this).sink, 'a usage sink').available(), true);
});

Then('the usage sink is not available', async function () {
  assert.equal(await must(scene(this).sink, 'a usage sink').available(), false);
});

Given('the {string} broker control', async function (adapter: string) {
  if (adapter === 'in-memory') {
    const control = new InMemoryBrokerControl();
    scene(this).control = control;
    scene(this).honours = (token) => control.granted.get(token) ?? null;
  } else {
    assert.equal(adapter, 'mcp', `unknown broker control adapter: ${adapter}`);
    const { broker, client } = await startBroker(this);
    scene(this).control = new McpBrokerControl(client);
    scene(this).honours = (token) => broker.service.authorize(token);
  }
});

When('the gateway grants {string} to the task {string}', async function (token: string, task: string) {
  await must(scene(this).control, 'a broker control').grant({ token, task });
});

When(
  'the gateway grants {string} to the task {string} called by {string}',
  async function (token: string, task: string, parent: string) {
    await must(scene(this).control, 'a broker control').grant({ token, task, parent });
  },
);

When('the gateway revokes {string}', async function (token: string) {
  await must(scene(this).control, 'a broker control').revoke(token);
});

Then('granting {string} to the task {string} is refused', async function (token: string, task: string) {
  await assert.rejects(must(scene(this).control, 'a broker control').grant({ token, task }));
});

Then('the broker honours {string} for {string}', function (token: string, expected: string) {
  const grant = must(scene(this).honours, 'a broker control')(token);
  assert.ok(grant !== null, `the broker does not honour ${token}`);
  const { token: _token, ...rest } = grant as { token?: string };
  assert.deepEqual(
    Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    JSON.parse(expected),
  );
});

Then('the broker does not honour {string}', function (token: string) {
  assert.equal(must(scene(this).honours, 'a broker control')(token), null);
});

// --- the three together ---

Given(
  'the broker, the gateway and data over MCP, the gateway probing data every {int} ms',
  async function (probeMs: number) {
    const link = new DataLink();
    const data = await serveData(this, new InMemoryDataStore());
    link.current = data.client;
    let forwarder: UsageForwarder | undefined;
    const { client } = await startBroker(this, (record) => must(forwarder, 'a forwarder').receive(record));
    forwarder = new UsageForwarder(
      new McpUsageSink(link),
      new McpBrokerControl(client),
      new TimerScheduler(),
      probeMs,
    );
    Object.assign(scene(this), { link, gone: data.gone, data: data.client, forwarder });
  },
);

Given(
  'the gateway opens the task {string} with the token {string}',
  async function (task: string, token: string) {
    await must(scene(this).forwarder, 'a forwarder').grant({ token, task });
  },
);

async function post(world: ArchitectWorld, token: string): Promise<number> {
  const broker = must(scene(world).broker, 'a broker');
  const answer = await send(
    broker.relay.port,
    'POST',
    '/v1/messages',
    { 'content-type': 'application/json', 'x-api-key': token },
    '{"model":"m","max_tokens":1}',
  );
  return answer.status;
}

/** Waits until `done` holds, polling every 5 ms, at most 2 s: the notifications and the probe are asynchronous. */
async function until(done: () => Promise<boolean> | boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 2000; waited += 5) {
    if (await done()) return;
    await sleep(5);
  }
  assert.fail(`not within 2 s: ${what}`);
}

/** The records data holds, all tasks; none when data is gone. */
async function stored(world: ArchitectWorld): Promise<number> {
  const response = await must(scene(world).data, 'data')
    .callTool({ name: 'usage.aggregate', arguments: { limit: 1000 } })
    .catch(() => undefined);
  const text = (response?.content as { text?: string }[] | undefined)?.[0]?.text ?? '[]';
  return (JSON.parse(text) as { requests: number }[]).reduce((sum, row) => sum + row.requests, 0);
}

When('the worker of {string} posts to the broker, which answers 200', async function (token: string) {
  const forwarder = must(scene(this).forwarder, 'a forwarder');
  const handled = async () => (await stored(this)) + forwarder.state().lost + forwarder.state().refused;
  const before = await handled();
  assert.equal(await post(this, token), 200);
  // One record per answer: the gateway is done with it once it is written, refused or lost.
  await until(async () => (await handled()) > before, 'the record of the answer written or lost');
});

Then('the gateway turns data down and loses {int} record', async function (lost: number) {
  const forwarder = must(scene(this).forwarder, 'a forwarder');
  await until(() => forwarder.state().data === 'down' && forwarder.state().lost === lost, 'data down');
});

Then('the worker of {string} posting to the broker is answered 401', async function (token: string) {
  // The revocation follows the failed write: the broker answers 401 once the gateway has revoked the token.
  await until(async () => (await post(this, token)) === 401, 'a 401 of the broker');
});

When('data is back, empty', async function () {
  const data = await serveData(this, new InMemoryDataStore());
  must(scene(this).link, 'a data link').current = data.client;
  scene(this).data = data.client;
});

Then('the worker of {string} posting to the broker is answered 200 again', async function (token: string) {
  const forwarder = must(scene(this).forwarder, 'a forwarder');
  await until(() => forwarder.state().data === 'up', 'data up again');
  await until(async () => (await post(this, token)) === 200, 'a 200 of the broker');
});

Then('data sums for {string}:', async function (task: string, expected: string) {
  const data = must(scene(this).data, 'data');
  let rows: unknown;
  await until(async () => {
    const response = await data.callTool({ name: 'usage.aggregate', arguments: { task } });
    rows = JSON.parse((response.content as { text: string }[])[0]?.text ?? '[]');
    try {
      assertMatches(rows, JSON.parse(expected));
      return true;
    } catch {
      return false;
    }
  }, `data sums ${expected}`);
});

Then('the usage state of the gateway is {string}', function (expected: string) {
  assert.deepEqual(must(scene(this).forwarder, 'a forwarder').state(), JSON.parse(expected));
});
