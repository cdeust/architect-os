import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ModulesMcpJson } from '@architect-os/contracts';
import type { Sandbox, SandboxExit, SandboxRequest, SandboxRunner } from '@architect-os/sandbox';
import { GatewayError } from '../../src/domain/errors.js';
import type { ServiceResponse } from '../../src/domain/ports.js';
import type { WorkerChannel } from '../../src/domain/routing.js';
import { StreamClientTransport } from '../../src/infrastructure/stream-transport.js';
import { WorkerHost, type TaskSandboxRegistry } from '../../src/infrastructure/worker-host.js';
import {
  Given,
  Then,
  When,
  attempt,
  refusedWith,
  required,
  type Attempt,
  type GatewayWorld,
} from './helpers.js';

const INPUT = { tool: 'recall', input: { query: 'q' }, limits: { max_turns: 3 } };

/** A sandbox as a pair of streams: the gateway writes stdin, the worker of the test writes stdout. */
class StreamSandbox implements Sandbox {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  stops = 0;
  private finish!: (exit: SandboxExit) => void;
  readonly exited = new Promise<SandboxExit>((resolve) => (this.finish = resolve));

  exit(): void {
    this.stdout.end();
    this.finish({ code: 0, signal: null });
  }

  async stop(): Promise<SandboxExit> {
    this.stops += 1;
    this.stdout.end();
    this.finish({ code: null, signal: 'SIGKILL' });
    return this.exited;
  }
}

/** The channel of the test: a fixed input, relays by address, an output taken once. */
class ScriptedChannel implements WorkerChannel {
  readonly relays: [string, Record<string, unknown>][] = [];
  readonly outputs: unknown[] = [];

  input(): Record<string, unknown> {
    return INPUT;
  }

  async relay(address: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    this.relays.push([address, args]);
    if (address === 'memory.forbidden')
      throw new GatewayError('FORBIDDEN_CALL', 'agent may not call forbidden');
    if (address === 'memory.broken') throw new Error('socket hang up');
    return { text: '[{"id":"m1"}]', structured: { items: 1 }, isError: false };
  }

  complete(output: unknown): string {
    if (this.outputs.length > 0) throw new GatewayError('FORBIDDEN_CALL', 'the output is already given');
    this.outputs.push(output);
    return 'ok';
  }
}

interface Scene {
  servers: ModulesMcpJson;
  profile: string;
  cwd: string;
  variables: unknown[];
  requests: SandboxRequest[];
  sandboxes: StreamSandbox[];
  kept: [string, Sandbox][];
  channel: ScriptedChannel;
  abort: AbortController;
  run?: Promise<Attempt>;
  worker?: Client;
}

const sceneOf = (world: GatewayWorld) =>
  required(world.state['workerHost'] as Scene | undefined, 'a worker host');
const sandboxOf = (world: GatewayWorld) => required(sceneOf(world).sandboxes[0], 'a launched sandbox');
const workerOf = (world: GatewayWorld) => required(sceneOf(world).worker, 'a connected worker');

Given(
  'a worker host over the servers {string} for the profile {string} in {string}',
  function (servers: string, profile: string, cwd: string) {
    this.state['workerHost'] = {
      servers: JSON.parse(servers) as ModulesMcpJson,
      profile,
      cwd,
      variables: [],
      requests: [],
      sandboxes: [],
      kept: [],
      channel: new ScriptedChannel(),
      abort: new AbortController(),
    } satisfies Scene;
  },
);

async function runWorker(
  world: GatewayWorld,
  module: string,
  task: string,
  token: string,
  refusal?: string,
): Promise<void> {
  const scene = sceneOf(world);
  const runner: SandboxRunner = {
    start: async (request) => {
      scene.requests.push(request);
      if (refusal !== undefined) throw new Error(refusal);
      const sandbox = new StreamSandbox();
      scene.sandboxes.push(sandbox);
      return sandbox;
    },
  };
  const registry: TaskSandboxRegistry = { add: (owner, sandbox) => void scene.kept.push([owner, sandbox]) };
  const host = new WorkerHost(
    scene.servers,
    (variables) => {
      scene.variables.push(variables);
      return runner;
    },
    { profile: scene.profile, cwd: scene.cwd },
    registry,
  );
  const run = {
    task,
    token,
    module,
    tool: 'recall',
    call: 'call-1',
    timeoutMs: 1000,
    signal: scene.abort.signal,
  };
  scene.run = attempt(() => host.run(run, scene.channel));
  await new Promise((resolve) => setImmediate(resolve));
  const sandbox = scene.sandboxes[0];
  // No worker to connect when its launch failed, or when its call was cancelled before it started: it is stopped.
  if (sandbox === undefined || sandbox.stops > 0) return;
  const worker = new Client({ name: 'test-worker', version: '0.0.0' });
  await worker.connect(new StreamClientTransport(sandbox.stdin, sandbox.stdout));
  scene.worker = worker;
  world.cleanups.push(() => worker.close());
}

When(
  'the worker of {string} runs for the task {string} with the token {string}',
  function (module: string, task: string, token: string) {
    return runWorker(this, module, task, token);
  },
);

When(
  'the worker of {string} runs for the task {string} with the token {string}, its runner refusing {string}',
  function (module: string, task: string, token: string, refusal: string) {
    return runWorker(this, module, task, token, refusal);
  },
);

When(
  'the worker of {string} runs for the task {string} with the token {string} and a call already cancelled',
  function (module: string, task: string, token: string) {
    sceneOf(this).abort.abort();
    return runWorker(this, module, task, token);
  },
);

Then(
  'the runner was made with the variables {string} and started {string}',
  function (variables: string, request: string) {
    assert.deepEqual(sceneOf(this).variables, [JSON.parse(variables)]);
    assert.deepEqual(sceneOf(this).requests, [JSON.parse(request)]);
  },
);

Then('the sandbox of the run is kept with the task {string}', function (task: string) {
  assert.deepEqual(sceneOf(this).kept, [[task, sandboxOf(this)]]);
});

Then('no sandbox is kept with the task {string}', function (_task: string) {
  assert.deepEqual(sceneOf(this).kept, []);
});

Then('the worker sees exactly the tools:', async function (tools: string) {
  assert.deepEqual((await workerOf(this).listTools()).tools, JSON.parse(tools));
});

Then('the worker is served by {string} version {string}', function (name: string, version: string) {
  assert.deepEqual(workerOf(this).getServerVersion(), { name, version });
});

Then('the worker reads its input {string}', async function (input: string) {
  const answer = await workerOf(this).callTool({ name: 'task_input', arguments: {} });
  assert.deepEqual(answer.content, [{ type: 'text', text: JSON.stringify(JSON.parse(input)) }]);
});

When('the worker exits', function () {
  sandboxOf(this).exit();
});

Then('the run ends', async function () {
  const outcome = await required(sceneOf(this).run, 'a run');
  assert.equal(outcome.failed, false, String(outcome.error));
});

Then('the run is refused with {string} saying {string}', async function (code: string, message: string) {
  const outcome = await required(sceneOf(this).run, 'a run');
  refusedWith(outcome, code);
  assert.equal((outcome.error as Error).message, message);
});

Then(
  'the worker calls {string} with {string} and gets {string} with the structured content {string}',
  async function (address: string, args: string, text: string, structured: string) {
    const answer = await workerOf(this).callTool({
      name: 'call',
      arguments: { address, arguments: JSON.parse(args) },
    });
    assert.deepEqual(answer, {
      content: [{ type: 'text', text }],
      structuredContent: JSON.parse(structured),
      isError: false,
    });
  },
);

Then('the channel relayed {string} with {string}', function (address: string, args: string) {
  assert.deepEqual(sceneOf(this).channel.relays, [[address, JSON.parse(args)]]);
});

Then(
  'the worker calls {string} with {string} and gets the error {string}',
  async function (address: string, args: string, refusal: string) {
    const answer = await workerOf(this).callTool({
      name: 'call',
      arguments: { address, arguments: JSON.parse(args) },
    });
    assert.deepEqual(answer, {
      content: [{ type: 'text', text: JSON.stringify(JSON.parse(refusal)) }],
      isError: true,
    });
  },
);

Then(
  'the worker calls the tool {string} with {string} and gets an error {string}',
  async function (name: string, args: string, code: string) {
    const answer = await workerOf(this).callTool({ name, arguments: JSON.parse(args) });
    assert.equal(answer.isError, true);
    const text = (answer.content as { text: string }[])[0]!.text;
    assert.equal((JSON.parse(text) as { code: string }).code, code);
  },
);

Then(
  'the worker calls the tool {string} with {string} and gets the error {string}',
  async function (name: string, args: string, refusal: string) {
    const answer = await workerOf(this).callTool({ name, arguments: JSON.parse(args) });
    assert.deepEqual(answer, {
      content: [{ type: 'text', text: JSON.stringify(JSON.parse(refusal)) }],
      isError: true,
    });
  },
);

Then(
  'the worker gives the output {string} and gets {string}',
  async function (output: string, status: string) {
    const answer = await workerOf(this).callTool({
      name: 'task_complete',
      arguments: { output: JSON.parse(output) },
    });
    assert.deepEqual(answer.content, [{ type: 'text', text: status }]);
    assert.notEqual(answer.isError, true);
  },
);

Then(
  'the worker gives the output {string} and gets the error {string}',
  async function (output: string, refusal: string) {
    const answer = await workerOf(this).callTool({
      name: 'task_complete',
      arguments: { output: JSON.parse(output) },
    });
    assert.deepEqual(answer, {
      content: [{ type: 'text', text: JSON.stringify(JSON.parse(refusal)) }],
      isError: true,
    });
  },
);

Then('the channel took the output {string}', function (output: string) {
  assert.deepEqual(sceneOf(this).channel.outputs, [JSON.parse(output)]);
});

When('the call of the run is cancelled', function () {
  sceneOf(this).abort.abort();
});

When('the call of the run is cancelled again', function () {
  // A fresh abort of the same signal fires no event: the listener is checked by dispatching one.
  sceneOf(this).abort.signal.dispatchEvent(new Event('abort'));
});

Then('the sandbox of the run was stopped {int} time(s)', async function (times: number) {
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandboxOf(this).stops, times);
});

Then('the server of the run is closed', async function () {
  await assert.rejects(
    workerOf(this).callTool({ name: 'task_input', arguments: {} }, undefined, { timeout: 300 }),
  );
});
