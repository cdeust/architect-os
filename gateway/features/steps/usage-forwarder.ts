import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import type { UsageAppendInput } from '@architect-os/contracts';
import { UsageForwarder } from '../../src/application/usage-forwarder.js';
import { GatewayError, type GatewayErrorCode } from '../../src/domain/errors.js';
import type { AppendOutcome, TaskGrant } from '../../src/domain/ports.js';
import {
  InMemoryBrokerControl,
  InMemoryUsageSink,
  ManualScheduler,
} from '../../src/infrastructure/in-memory-usage.js';
import { onUsage } from '../../src/infrastructure/usage-adapters.js';
import { Given, Then, When, assertMatches, type GatewayWorld } from './helpers.js';

/** The in-memory broker, with one hook a scenario may set: work done while it grants a token. */
class HookedBroker extends InMemoryBrokerControl {
  hook: { token: string; work: () => Promise<void> } | undefined;

  override async grant(grant: TaskGrant): Promise<void> {
    await super.grant(grant);
    const hook = this.hook;
    if (hook?.token === grant.token) {
      this.hook = undefined;
      await hook.work();
    }
  }
}

/** The in-memory registry, that a scenario may make fail as a bug would, not as data gone. */
class FailingSink extends InMemoryUsageSink {
  failure: Error | undefined;

  override async append(record: UsageAppendInput): Promise<AppendOutcome> {
    if (this.failure !== undefined) throw this.failure;
    return super.append(record);
  }
}

interface Forwarding {
  forwarder: UsageForwarder;
  broker: HookedBroker;
  sink: FailingSink;
  scheduler: ManualScheduler;
}

function forwarding(world: GatewayWorld): Forwarding {
  const state = world.state['forwarding'] as Forwarding | undefined;
  assert.ok(state, 'a usage forwarder must be given first');
  return state;
}

Given('a usage forwarder probing data every {int} ms', function (probeMs: number) {
  const broker = new HookedBroker();
  const sink = new FailingSink();
  const scheduler = new ManualScheduler();
  this.state['forwarding'] = {
    forwarder: new UsageForwarder(sink, broker, scheduler, probeMs),
    broker,
    sink,
    scheduler,
  } satisfies Forwarding;
});

Given(
  'the gateway opened the task {string} with the token {string} called by {string}',
  async function (task: string, token: string, parent: string) {
    await forwarding(this).forwarder.grant({ token, task, parent });
  },
);

Given(
  'the gateway opened the task {string} with the token {string}',
  async function (task: string, token: string) {
    await forwarding(this).forwarder.grant({ token, task });
  },
);

When('the gateway retired the token {string}', async function (token: string) {
  await forwarding(this).forwarder.retire(token);
});

Given('data refuses every record', function () {
  forwarding(this).sink.refusing = true;
});

Given('data is unavailable', function () {
  forwarding(this).sink.reachable = false;
});

Given('data is available again', function () {
  forwarding(this).sink.reachable = true;
});

Given('data fails with an error {string}', function (message: string) {
  forwarding(this).sink.failure = new Error(message);
});

Given('data fails with the gateway code {word} {string}', function (code: GatewayErrorCode, message: string) {
  forwarding(this).sink.failure = new GatewayError(code, message);
});

Given('the notifications of a broker client handed over by onUsage', function () {
  const { forwarder } = forwarding(this);
  const client = {
    setNotificationHandler: (_schema: unknown, handler: (notification: unknown) => unknown) => {
      this.state['notify'] = handler;
    },
  };
  onUsage(client as unknown as Parameters<typeof onUsage>[0], (data) => forwarder.receive(data));
});

When(
  'the broker client gets a notification of the logger {string} with {string}',
  async function (logger: string, data: string) {
    const notify = this.state['notify'] as (notification: unknown) => unknown;
    await notify({
      method: 'notifications/message',
      params: { level: 'info', logger, data: JSON.parse(data) },
    });
  },
);

When(
  'while the broker grants {string} back, the gateway retires {string} and opens the task {string} with it',
  function (granted: string, token: string, task: string) {
    const { broker, forwarder } = forwarding(this);
    broker.hook = {
      token: granted,
      work: async () => {
        await forwarder.retire(token);
        await forwarder.grant({ token, task });
      },
    };
  },
);

When('the broker sends the usage record {string}', async function (record: string) {
  await forwarding(this).forwarder.receive(JSON.parse(record));
});

When(
  'the broker sends {int} usage records of the task {string} at once',
  async function (count: number, task: string) {
    const { forwarder } = forwarding(this);
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        forwarder.receive({ at: `2026-11-05T10:00:0${i}.000Z`, status: 200, task }),
      ),
    );
  },
);

When('the probe of data runs', async function () {
  forwarding(this).scheduler.run();
  // The probe is asynchronous; every adapter here settles within the microtasks of one turn.
  await tick();
});

Then(
  'the broker sending the usage record {string} fails with {string}',
  async function (record: string, message: string) {
    await assert.rejects(forwarding(this).forwarder.receive(JSON.parse(record)), { message });
  },
);

Then('data holds the usage records {string}', function (expected: string) {
  assertMatches(forwarding(this).sink.records, JSON.parse(expected));
});

Then('data holds no usage record', function () {
  assert.deepEqual(forwarding(this).sink.records, []);
});

Then('the usage state is {string}', function (expected: string) {
  assert.deepEqual(forwarding(this).forwarder.state(), JSON.parse(expected));
});

Then('the broker got the calls {string}', function (calls: string) {
  assert.deepEqual(forwarding(this).broker.calls, calls.split(', '));
});

Then('the broker honours the tokens {string}', function (tokens: string) {
  assert.deepEqual([...forwarding(this).broker.granted.keys()].sort(), tokens.split(', ').sort());
});

Then('the broker honours the token {string} for {string}', function (token: string, expected: string) {
  const grant = forwarding(this).broker.granted.get(token);
  assert.ok(grant, `the broker does not honour ${token}`);
  const { token: _token, ...rest } = grant;
  assert.deepEqual(
    Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    JSON.parse(expected),
  );
});

Then('a probe of data waits {int} ms', function (ms: number) {
  assert.deepEqual(forwarding(this).scheduler.waiting(), [ms]);
});

Then('no probe of data waits', function () {
  assert.deepEqual(forwarding(this).scheduler.waiting(), []);
});
