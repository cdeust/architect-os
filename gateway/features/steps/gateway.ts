import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { TopologySchema } from '@architect-os/contracts';
import { TaskRouter } from '../../src/application/task-router.js';
import { GatewayError } from '../../src/domain/errors.js';
import type { ServiceResponse } from '../../src/domain/ports.js';
import type { ModuleCall } from '../../src/domain/routing.js';
import { InMemoryAuditLog } from '../../src/infrastructure/in-memory.js';
import {
  InMemoryDataClient,
  InMemoryModules,
  InMemoryTaskRegistry,
  InMemoryTaskSandboxes,
  InMemoryTaskTokens,
  ManualTime,
  SequentialIds,
} from '../../src/infrastructure/in-memory-routing.js';
import { Given, Then, When, attempt, refusedWith, type Attempt, type GatewayWorld } from './helpers.js';

/** A call a module received, with what its identifier stood for at that moment. */
interface Seen {
  call: ModuleCall;
  at: number;
  described: ReturnType<TaskRouter['describe']>;
}

interface Scene {
  router: TaskRouter;
  seen: Seen[];
  modules: InMemoryModules;
  registry: InMemoryTaskRegistry;
  tokens: InMemoryTaskTokens;
  sandboxes: InMemoryTaskSandboxes;
  audit: InMemoryAuditLog;
  time: ManualTime;
  /** The call of the scenario, awaited or still in flight. */
  pending?: Promise<Attempt>;
  outcome?: Attempt;
  /** The tokens of the tasks, by task. */
  tokenOf: Map<string, string>;
  /** The calls a module saw cancelled. */
  cancelled: Set<string>;
}

const scene = (world: GatewayWorld): Scene => {
  const found = world.state['routing'] as Scene | undefined;
  assert.ok(found, 'the gateway must be given first');
  return found;
};

/** Lets the work that awaits settle: the in-memory adapters answer in microtasks. */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 5; round += 1) await tick();
};

Given('the gateway over the topology {word}', function (path: string) {
  const topology = TopologySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const time = new ManualTime(new Date('2026-11-06T09:00:00.000Z'));
  const parts = {
    modules: new InMemoryModules(),
    registry: new InMemoryTaskRegistry(),
    tokens: new InMemoryTaskTokens(),
    sandboxes: new InMemoryTaskSandboxes(),
    audit: new InMemoryAuditLog(),
  };
  const seen: Seen[] = [];
  // Records each call as the module receives it, with what the router says of its identifier then.
  const recording = {
    call: (call: ModuleCall) => {
      seen.push({ call, at: time.now().getTime(), described: router.describe(call.call) });
      return parts.modules.call(call);
    },
  };
  const router: TaskRouter = new TaskRouter(
    topology,
    recording,
    new InMemoryDataClient(),
    parts.registry,
    parts.tokens,
    parts.sandboxes,
    parts.audit,
    time,
    time,
    new SequentialIds(),
  );
  this.state['routing'] = {
    ...parts,
    seen,
    router,
    time,
    tokenOf: new Map(),
    cancelled: new Set(),
  } satisfies Scene;
});

Given(
  'the client {string} opened the task {string} with the profile {string}',
  async function (client: string, task: string, profile: string) {
    const opened = await scene(this).router.open(client, profile);
    // The identifiers of a scenario go in step: task-n has the token token-n, granted to it at its opening.
    assert.deepEqual(opened, { task, token: task.replace('task', 'token') });
    scene(this).tokenOf.set(task, opened.token);
    assert.deepEqual(
      scene(this).tokens.granted,
      [...scene(this).tokenOf].map(([open, token]) => ({ token, task: open })),
    );
  },
);

When(
  'the client {string} opens a task with the profile {string}',
  async function (client: string, profile: string) {
    scene(this).outcome = await attempt(() => scene(this).router.open(client, profile));
  },
);

// --- what the modules do ---

Given('no module behaviour', function () {});

/** A module that calls back `address` with the identifier of its call, then answers its own answer and the other. */
Given(
  'the module {string} calls back {string} with {string} before it answers',
  function (module: string, address: string, args: string) {
    const { router, modules } = scene(this);
    modules.behaviours.set(module, async (call) => {
      const nested = await router.call(
        { call: call.call },
        address,
        JSON.parse(args) as Record<string, unknown>,
      );
      return echo(call, nested);
    });
  },
);

Given(
  'the module {string} calls back the data operation {string} with {string} before it answers',
  function (module: string, op: string, args: string) {
    const { router, modules } = scene(this);
    modules.behaviours.set(module, async (call) => {
      const nested = await router.operate(call.call, op, JSON.parse(args) as Record<string, unknown>);
      return echo(call, nested);
    });
  },
);

Given('the module {string} waits until its call is cancelled', function (module: string) {
  const { modules, cancelled } = scene(this);
  modules.behaviours.set(
    module,
    (call) =>
      new Promise<ServiceResponse>((_, reject) => {
        call.signal.addEventListener('abort', () => {
          cancelled.add(call.call);
          reject(new Error('cancelled'));
        });
      }),
  );
});

Given('the module {string} answers once its call is cancelled', function (module: string) {
  const { modules } = scene(this);
  modules.behaviours.set(
    module,
    (call) =>
      new Promise<ServiceResponse>((resolve) => {
        call.signal.addEventListener('abort', () =>
          resolve({ structured: undefined, text: 'late answer', isError: false }),
        );
      }),
  );
});

Given('the module {string} answers after {int} ms', function (module: string, ms: number) {
  const { modules, time } = scene(this);
  modules.behaviours.set(
    module,
    (call) =>
      new Promise<ServiceResponse>((resolve) =>
        time.after(ms, () =>
          resolve({ structured: undefined, text: `${call.module} after ${ms} ms`, isError: false }),
        ),
      ),
  );
});

Given('the module {string} fails', function (module: string) {
  scene(this).modules.behaviours.set(module, async () => {
    throw new Error('the module failed');
  });
});

Then('the refusal says {string}', function (message: string) {
  const got = scene(this).outcome;
  assert.ok(got?.failed, 'the call succeeded');
  assert.equal((got.error as Error).message, message);
});

Given('the registry is unavailable', function () {
  scene(this).registry.unavailable = new GatewayError('SERVICE_UNAVAILABLE', 'data is unavailable');
});

function echo(call: ModuleCall, nested: ServiceResponse): ServiceResponse {
  return {
    structured: undefined,
    text: `${call.module}/${call.tool} ${JSON.stringify(call.args)} <- ${nested.text}`,
    isError: false,
  };
}

// --- the calls ---

When(
  'the client calls {string} for {string} with {string}',
  async function (address: string, task: string, args: string) {
    const json = JSON.parse(args) as Record<string, unknown>;
    scene(this).outcome = await attempt(() => scene(this).router.call({ task }, address, json));
  },
);

When(
  'the client calls {string} for {string} with {string} without waiting',
  async function (address: string, task: string, args: string) {
    const json = JSON.parse(args) as Record<string, unknown>;
    scene(this).pending = attempt(() => scene(this).router.call({ task }, address, json));
    await settle();
  },
);

When(
  'a module calls back {string} with the call identifier {string}',
  async function (address: string, call: string) {
    scene(this).outcome = await attempt(() => scene(this).router.call({ call }, address, {}));
  },
);

When(/^(\d+) ms pass(?:es)?$/, async function (ms: string) {
  scene(this).time.pass(Number(ms));
  await settle();
});

When('the client of the profile {string} cancels {string}', async function (profile: string, task: string) {
  scene(this).outcome = await attempt(() => scene(this).router.cancel(profile, task));
  await settle();
});

When('the client completes {string}', async function (task: string) {
  scene(this).outcome = await attempt(() => scene(this).router.complete(task));
});

/** The outcome of the call of the scenario: the one in flight, once it settled, or the last one awaited. */
async function outcome(world: GatewayWorld): Promise<Attempt | undefined> {
  const { pending } = scene(world);
  if (pending === undefined) return scene(world).outcome;
  scene(world).pending = undefined;
  return (scene(world).outcome = await pending);
}

Then('the call answers {string}', async function (text: string) {
  const got = await outcome(this);
  assert.ok(got !== undefined && !got.failed, `the call failed: ${String(got?.error)}`);
  assert.equal((got.value as ServiceResponse).text, text);
});

Then(
  /^the (?:call|cancellation|completion|opening) is refused with "([A-Z_]+)"$/,
  async function (code: string) {
    refusedWith(await outcome(this), code);
  },
);

// --- what the gateway did ---

Then(
  'the module {string} was called with {string} for {string}, at depth {int}, with a timeout of {int} ms',
  function (module: string, call: string, task: string, depth: number, timeoutMs: number) {
    const found = scene(this).seen.find((seen) => seen.call.call === call);
    assert.ok(found, `no call ${call}`);
    assert.equal(found.call.timeoutMs, timeoutMs);
    assert.deepEqual(found.described, {
      task,
      module,
      depth,
      deadline: new Date(found.at + timeoutMs).toISOString(),
    });
  },
);

Then('{string} is the identifier of a call of {string} in flight', function (call: string, task: string) {
  assert.equal(scene(this).router.describe(call)?.task, task);
});

When(
  'a module calls back the data operation {string} with the call identifier {string}',
  async function (op: string, call: string) {
    scene(this).outcome = await attempt(() => scene(this).router.operate(call, op, {}));
  },
);

Then('the call fails with {string}', function (message: string) {
  const got = scene(this).outcome;
  assert.ok(got?.failed, 'the call succeeded');
  assert.equal((got.error as Error).message, message);
});

Then('{string} is not a call identifier', function (call: string) {
  assert.equal(scene(this).router.describe(call), undefined);
});

Then('the module {string} has its call in flight', function (module: string) {
  const { router } = scene(this);
  const last = callsOf(this, module).at(-1);
  assert.ok(last, `${module} was never called`);
  assert.equal(router.describe(last.call) !== undefined, true);
  assert.equal(last.signal.aborted, false);
});

Then('the module {string} saw its call cancelled', function (module: string) {
  const { cancelled } = scene(this);
  const last = callsOf(this, module).at(-1);
  assert.ok(last && cancelled.has(last.call), `${module} did not see its call cancelled`);
});

Then('the module {string} was never called', function (module: string) {
  assert.deepEqual(callsOf(this, module), []);
});

/** The calls a module received, in order. */
const callsOf = (world: GatewayWorld, module: string): ModuleCall[] =>
  scene(world)
    .seen.map((seen) => seen.call)
    .filter((call) => call.module === module);

/** The audit log, one line per entry: task (- when it has none), subject, tool, and the code of a refusal or ok. */
const auditLines = (world: GatewayWorld): string[] =>
  scene(world).audit.entries.map((entry) => {
    assert.equal(entry.outcome, entry.error_code === undefined ? 'ok' : 'error', JSON.stringify(entry));
    const task = Object.hasOwn(entry, 'task') ? entry.task : '-';
    return `${task} ${entry.subject} ${entry.tool} ${entry.error_code ?? 'ok'}`;
  });

Then('the last audit entry took {int} ms', function (ms: number) {
  assert.equal(scene(this).audit.entries.at(-1)?.duration_ms, ms);
});

Then('the audit log holds {string}', function (expected: string) {
  assert.deepEqual(auditLines(this), expected.split(', '));
});

Then('the audit log holds in any order {string}', function (expected: string) {
  assert.deepEqual(auditLines(this).sort(), expected.split(', ').sort());
});

Then('the token of {string} is retired and its sandboxes stopped', function (task: string) {
  const { tokens, sandboxes, tokenOf } = scene(this);
  assert.deepEqual(tokens.retired, [tokenOf.get(task)]);
  assert.deepEqual(sandboxes.stopped, [task]);
});

Then('the task {string} is open', function (task: string) {
  const { registry, tokens } = scene(this);
  assert.ok(
    registry.opened.some((open) => open.task === task),
    `${task} was never opened`,
  );
  assert.deepEqual(
    registry.ended.filter((end) => end.task === task),
    [],
  );
  assert.equal(tokens.retired.includes(scene(this).tokenOf.get(task) ?? ''), false);
});

Then(
  /^the task "([^"]+)" ended with "([a-z_]+)": its identifiers invalid, its token retired, its sandboxes stopped$/,
  function (task: string, ending: string) {
    const { registry, tokens, sandboxes, seen, router } = scene(this);
    assert.deepEqual(registry.ended, [{ task, ending }]);
    assert.deepEqual(tokens.retired, [scene(this).tokenOf.get(task)]);
    assert.deepEqual(sandboxes.stopped, [task]);
    for (const { call, described } of seen)
      if (described?.task === task)
        assert.equal(router.describe(call.call), undefined, `${call.call} is in flight`);
  },
);

Then('the registry holds the tasks {string}', function (tasks: string) {
  assert.deepEqual(
    scene(this).registry.opened.map((open) => open.task),
    tasks.split(', '),
  );
});
