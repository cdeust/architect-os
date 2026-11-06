import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SrtSandboxRunner, type ProcessRunnerOptions, type Sandbox } from '@architect-os/sandbox';
import { DataOperations } from '../../data/src/application/operations.js';
import { InMemoryDataStore } from '../../data/src/infrastructure/in-memory.js';
import { createDataMcpServer } from '../../data/src/presentation/mcp-server.js';
import type { TaskRouter } from '../../gateway/src/application/task-router.js';
import type { ServiceResponse } from '../../gateway/src/domain/ports.js';
import { BrokerTaskTokens } from '../../gateway/src/infrastructure/broker-task-tokens.js';
import { InMemoryAuditLog, SystemClock } from '../../gateway/src/infrastructure/in-memory.js';
import { RandomIds } from '../../gateway/src/infrastructure/mcp-routing.js';
import { TaskSandboxGroups } from '../../gateway/src/infrastructure/task-sandboxes.js';
import { loadTopology } from '../../gateway/src/infrastructure/topology-files.js';
import { McpBrokerControl, TimerScheduler } from '../../gateway/src/infrastructure/usage-adapters.js';
import { WorkerHost } from '../../gateway/src/infrastructure/worker-host.js';
import { composeRouting } from '../../gateway/src/main.js';
import { createCallbackHost } from '../../gateway/src/presentation/callback-host.js';
import { keyFile, startTestBroker, testConfig } from '../../modules/broker/features/steps/harness.js';
import { startFakeModel, type FakeModel } from '../support/fake-model.js';
import type { ArchitectWorld } from '../support/world.js';
import { Given, Then, When } from './helpers.js';

/** The platform root: the module and the worker read their code there, and write nothing there. */
const ROOT = realpathSync(new URL('../../', import.meta.url).pathname);
const SRT_CLI = createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js');
/** The built entry points topology/modules.mcp.json launches (tsc -b: npm test and the gate build first). */
const ENTRY_POINTS = ['modules/memory/dist/src/serve.js', 'services/memory/dist/worker/task-serve.js'];
/** A fake key of the broker, in a throwaway file: never a real one. */
const BROKER_KEY = 'sk-ant-fake-broker-key-of-the-e2e-not-a-key';

interface Platform {
  router: TaskRouter;
  model: FakeModel;
  memory: string;
  brokerPort: number;
  workers: Sandbox[];
  task?: { task: string; token: string };
  answer?: ServiceResponse;
}

const platformOf = (world: ArchitectWorld): Platform => {
  const platform = world.state['recall-srt'] as Platform | undefined;
  assert.ok(platform, 'the platform must be given first');
  return platform;
};

/** The options of a platform runner: the committed profiles, a disposable cwd, the variables of its launcher. */
const runnerOptions = (variables: Record<string, string>): ProcessRunnerOptions => ({
  profilesDir: join(ROOT, 'packages', 'sandbox', 'profiles'),
  srtCli: SRT_CLI,
  node: process.execPath,
  canaryProbe: join(ROOT, 'packages', 'sandbox', 'src', 'canary-probe.mjs'),
  tmpRoot: tmpdir(),
  home: homedir(),
  hostEnv: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: process.env['HOME'] },
  trusted: [],
  variables,
  workspace: 'disposable',
});

async function dataInMemory(world: ArchitectWorld): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createDataMcpServer(new DataOperations(new InMemoryDataStore()));
  await server.connect(serverSide);
  const data = new Client({ name: 'e2e-gateway', version: '0.0.0' });
  await data.connect(clientSide);
  world.cleanups.push(() => server.close());
  return data;
}

Given(
  'the platform of the committed topology under srt, data in memory holding the memory {string}, and the broker before a fake model that searches the memory for {string} then answers {string}',
  { timeout: 60_000 },
  async function (content: string, query: string, output: string) {
    for (const entry of ENTRY_POINTS)
      assert.ok(
        existsSync(join(ROOT, entry)),
        `${entry} is built by tsc -b before the suite (npm test, the gate)`,
      );
    const data = await dataInMemory(this);
    const inserted = await data.callTool({ name: 'memory.insert', arguments: { content, tags: [] } });
    const memory = (JSON.parse((inserted.content as { text: string }[])[0]!.text) as { id: string }).id;

    const model = await startFakeModel([
      { tool: 'mcp__platform__memory_search', input: { query, limit: 5 } },
      { tool: 'StructuredOutput', input: JSON.parse(output) },
    ]);
    this.cleanups.push(() => model.close());
    const key = keyFile(BROKER_KEY);
    this.cleanups.push(() => key.remove());
    const broker = await startTestBroker(testConfig(model.url, key.file));
    this.cleanups.push(() => broker.broker.close());
    const brokerPort = broker.broker.relay.port;

    // The callback is listened before the router exists: it reaches the router once composed.
    let router: TaskRouter | undefined;
    const callback = createCallbackHost({
      describe: (id) => router!.describe(id),
      operate: (call, op, args) => router!.operate(call, op, args),
      call: (caller, address, args) => router!.call(caller, address, args),
    });
    await new Promise<void>((resolve) => callback.listen(0, '127.0.0.1', resolve));
    this.cleanups.push(() => new Promise<void>((resolve) => callback.close(() => resolve())));
    const callbackPort = String((callback.address() as AddressInfo).port);

    const files = {
      catalog: join(ROOT, 'topology', 'catalog.json'),
      servers: join(ROOT, 'topology', 'modules.mcp.json'),
      clients: join(ROOT, 'topology', 'clients.json'),
    };
    const groups = new TaskSandboxGroups();
    const workers: Sandbox[] = [];
    const host = new WorkerHost(
      loadTopology(files).servers,
      ({ taskToken }) => new SrtSandboxRunner(runnerOptions({ brokerPort: String(brokerPort), taskToken })),
      { profile: 'worker', cwd: ROOT },
      { add: (task, sandbox) => (workers.push(sandbox), groups.add(task, sandbox)) },
    );
    const composed = await composeRouting({
      files,
      runner: new SrtSandboxRunner(runnerOptions({ callbackPort })),
      launch: { profile: 'module', cwd: ROOT },
      data,
      tokens: new BrokerTaskTokens(new McpBrokerControl(broker.client)),
      sandboxes: groups,
      audit: new InMemoryAuditLog(),
      clock: new SystemClock(),
      scheduler: new TimerScheduler(),
      ids: new RandomIds(),
      workers: host,
    });
    router = composed.router;
    this.cleanups.push(() => composed.modules.close());
    this.state['recall-srt'] = { router, model, memory, brokerPort, workers } satisfies Platform;
  },
);

When(
  'the owner opens a task and calls {string} with {string}',
  { timeout: 180_000 },
  async function (address: string, args: string) {
    const platform = platformOf(this);
    platform.task = await platform.router.open('e2e-owner', 'owner');
    platform.answer = await platform.router.call({ task: platform.task.task }, address, JSON.parse(args));
  },
);

Then(
  'the call answers ok with the data {string} and the evidence of the memory {string}',
  function (data: string, content: string) {
    const { answer, memory } = platformOf(this);
    assert.ok(answer !== undefined && !answer.isError, String(answer?.text));
    assert.deepEqual(
      {
        status: answer.structured?.['status'],
        data: answer.structured?.['data'],
        evidence: answer.structured?.['evidence'],
      },
      {
        status: 'ok',
        data: JSON.parse(data),
        evidence: [{ source: 'memory', ref: memory, excerpt: content }],
      },
    );
  },
);

Then(
  'the fake model was asked by the model {string} through the broker, with the key of the broker and never the token of the task',
  function (family: string) {
    const { model, task } = platformOf(this);
    const asked = model.requests.filter((request) => request.path === '/v1/messages');
    assert.ok(asked.length >= 2, `the model was asked ${asked.length} times`);
    for (const request of asked) {
      assert.equal(request.apiKey, BROKER_KEY);
      assert.match(String(request.body.model), new RegExp(`^claude-${family}-`));
      assert.ok(!JSON.stringify(request).includes(task!.token), 'the token of the task reached the model');
    }
  },
);

When('the owner completes the task', async function () {
  const platform = platformOf(this);
  await platform.router.complete(platform.task!.task);
});

Then('the sandbox of the worker of the task is stopped', async function () {
  const { workers } = platformOf(this);
  assert.equal(workers.length, 1);
  await workers[0]!.exited;
});

Then('the broker refuses the token of the task', async function () {
  const { brokerPort, task } = platformOf(this);
  const response = await fetch(`http://127.0.0.1:${brokerPort}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': task!.token },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 1, messages: [] }),
  });
  assert.equal(response.status, 401);
});
