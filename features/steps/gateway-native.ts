import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AuditEntry } from '../../gateway/src/domain/ports.js';
import { createHttpHost } from '../../gateway/src/presentation/http-host.js';
import { FRONT_SUBJECT, FRONT_TOKEN, type SrtPlatform } from '../support/srt-platform.js';
import type { ArchitectWorld } from '../support/world.js';
import { Given, Then, When } from './helpers.js';

interface Front {
  url: string;
  answer?: { isError?: boolean; structuredContent?: Record<string, unknown>; text: string };
}

const platformOf = (world: ArchitectWorld): SrtPlatform => {
  const platform = world.state['recall-srt'] as SrtPlatform | undefined;
  assert.ok(platform, 'the platform must be given first');
  return platform;
};

const frontOf = (world: ArchitectWorld): Front => {
  const front = world.state['gateway-native'] as Front | undefined;
  assert.ok(front, 'the front must be served first');
  return front;
};

Given("the clients' front of the gateway served over HTTP on a free loopback port", async function () {
  const host = createHttpHost(platformOf(this).createServer);
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  this.cleanups.push(() => new Promise<void>((resolve) => host.close(() => resolve())));
  this.state['gateway-native'] = { url: `http://127.0.0.1:${(host.address() as AddressInfo).port}/mcp` };
});

async function callFront(world: ArchitectWorld, tool: string, args: string, token: string | undefined) {
  const front = frontOf(world);
  const client = new Client({ name: 'e2e-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(front.url), {
      requestInit: token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  try {
    const result = await client.callTool({ name: tool, arguments: JSON.parse(args) });
    front.answer = {
      isError: result.isError === true,
      structuredContent: result.structuredContent as Record<string, unknown> | undefined,
      text: (result.content as { text: string }[])[0]?.text ?? '',
    };
  } finally {
    await client.close();
  }
}

When(
  'a client calls the tool {string} over HTTP with {string} and the bearer token of the front',
  { timeout: 180_000 },
  async function (tool: string, args: string) {
    await callFront(this, tool, args, FRONT_TOKEN);
  },
);

When(
  'a client calls the tool {string} over HTTP with {string} and no token',
  { timeout: 180_000 },
  async function (tool: string, args: string) {
    await callFront(this, tool, args, undefined);
  },
);

Then("the client's answer is ok with the data {string}", function (data: string) {
  const { answer } = frontOf(this);
  assert.ok(answer !== undefined && answer.isError !== true, String(answer?.text));
  assert.deepEqual(
    { status: answer.structuredContent?.['status'], data: answer.structuredContent?.['data'] },
    { status: 'ok', data: JSON.parse(data) },
  );
});

Then("the client's answer is ok with a memory id", function () {
  const { answer } = frontOf(this);
  assert.ok(answer !== undefined && answer.isError !== true, String(answer?.text));
  assert.equal(answer.structuredContent?.['status'], 'ok');
  const data = answer.structuredContent?.['data'] as { memory_id?: unknown } | undefined;
  assert.ok(typeof data?.memory_id === 'string' && data.memory_id !== '', JSON.stringify(data));
});

Then("the client's call is refused with code {string}", function (code: string) {
  const { answer } = frontOf(this);
  assert.ok(answer?.isError === true, 'the call must be refused');
  assert.equal((JSON.parse(answer.text) as { code?: unknown }).code, code);
});

/** The tasks the gateway opened in the registry: its `tasks.open` operations on data, in order. */
const opened = (platform: SrtPlatform): Record<string, unknown>[] =>
  platform.dataCalls.filter((call) => call.name === 'tasks.open').map((call) => call.arguments);

Then(
  'the registry of data holds one task of the subject of the token under the profile {string}, ended {string}',
  async function (profile: string, ending: string) {
    const platform = platformOf(this);
    const tasks = opened(platform);
    assert.equal(tasks.length, 1, `tasks opened: ${JSON.stringify(tasks)}`);
    const found = await platform.data.callTool({ name: 'tasks.get', arguments: { task: tasks[0]!['task'] } });
    const record = JSON.parse((found.content as { text: string }[])[0]!.text) as Record<string, unknown>;
    assert.deepEqual(
      { client: record['client'], profile: record['profile'], ending: record['ending'] },
      { client: FRONT_SUBJECT, profile, ending },
    );
  },
);

Then('the gateway opened no task in the registry of data', function () {
  assert.deepEqual(opened(platformOf(this)), []);
});

Then(
  'the registry of data holds the usage of that task: {int} answers of the model under the layer {string}',
  { timeout: 30_000 },
  async function (answers: number, layer: string) {
    const platform = platformOf(this);
    const [task] = opened(platform);
    const rows = async () => {
      const found = await platform.data.callTool({
        name: 'usage.aggregate',
        arguments: { task: task!['task'] },
      });
      return JSON.parse((found.content as { text: string }[])[0]!.text) as {
        layer: string;
        requests: number;
      }[];
    };
    // The broker reports each answer after it relayed it: polled, never a fixed delay.
    const deadline = Date.now() + 20_000;
    let seen = await rows();
    while (seen.reduce((sum, row) => sum + row.requests, 0) < answers && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      seen = await rows();
    }
    assert.deepEqual(
      seen.map((row) => ({ layer: row.layer, requests: row.requests })),
      [{ layer, requests: answers }],
    );
  },
);

Then('the callback host of the modules listens on {string} only', function (address: string) {
  assert.equal(platformOf(this).callback.address, address);
});

const callsOf = (world: ArchitectWorld, tool: string): AuditEntry[] =>
  platformOf(world).audit.entries.filter((entry) => entry.tool === tool);

Then('the audit log holds the call of {string} by the subject of the token, ok', function (tool: string) {
  const [entry, ...others] = callsOf(this, tool);
  assert.deepEqual(others, []);
  assert.deepEqual(
    { subject: entry?.subject, owner: entry?.owner, outcome: entry?.outcome },
    { subject: FRONT_SUBJECT, owner: 'memory', outcome: 'ok' },
  );
});

Then('the audit log holds the call of {string} refused with {string}', function (tool: string, code: string) {
  const [entry, ...others] = callsOf(this, tool);
  assert.deepEqual(others, []);
  assert.deepEqual(
    { subject: entry?.subject, outcome: entry?.outcome, error_code: entry?.error_code },
    { subject: 'anonymous', outcome: 'error', error_code: code },
  );
});
