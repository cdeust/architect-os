import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DATA_OPS, DATA_OP_NAMES } from '@architect-os/contracts';
import { z } from 'zod';
import { GatewayError } from '../../src/domain/errors.js';
import type { ServiceResponse } from '../../src/domain/ports.js';
import { createCallbackHost, type CallbackRouter } from '../../src/presentation/callback-host.js';
import { Given, Then, When, required, type GatewayWorld } from './helpers.js';

/** The router of the test: one known call, scripted answers, and what it was asked. */
class ScriptedRouter implements CallbackRouter {
  readonly described: string[] = [];
  readonly operated: [string, string, Record<string, unknown>][] = [];
  readonly called: [unknown, string, Record<string, unknown>][] = [];

  constructor(private readonly known: string) {}

  describe(id: string) {
    this.described.push(id);
    return id === this.known
      ? { task: 'task-1', module: 'memory', depth: 2, deadline: '2026-11-06T10:00:00.000Z' }
      : undefined;
  }

  async operate(call: string, op: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    this.operated.push([call, op, args]);
    if (op === 'memory.insert')
      throw new GatewayError('FORBIDDEN_WRITE', 'memory may not write memory.memories');
    if (op === 'usage.append') throw new Error('data is gone');
    if (op === 'tasks.end') return { text: '{"code":"NOT_FOUND"}', structured: undefined, isError: true };
    return { text: '[{"id":"m1"}]', structured: undefined, isError: false };
  }

  async call(
    caller: { call: string },
    address: string,
    args: Record<string, unknown>,
  ): Promise<ServiceResponse> {
    this.called.push([caller, address, args]);
    return { text: '{"score":1}', structured: { score: 1 }, isError: false };
  }
}

interface Scene {
  router: ScriptedRouter;
  url: string;
  status?: number;
  answer?: Record<string, unknown>;
  tools?: { name: string; inputSchema: unknown }[];
}

const sceneOf = (world: GatewayWorld) =>
  required(world.state['callback'] as Scene | undefined, 'a callback host');
const answerOf = (world: GatewayWorld) => required(sceneOf(world).answer, 'an answer of the callback');

Given('the callback host over a router that knows the call {string}', async function (call: string) {
  const router = new ScriptedRouter(call);
  const host = createCallbackHost(router);
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  this.cleanups.push(() => new Promise<void>((resolve) => host.close(() => resolve())));
  const { port } = host.address() as AddressInfo;
  this.state['callback'] = { router, url: `http://127.0.0.1:${port}` } satisfies Scene;
});

const bearer = (call: string): Record<string, string> =>
  call === '' ? {} : { authorization: `Bearer ${call}` };

When('a module posts to {string} with the bearer {string}', async function (path: string, call: string) {
  const response = await fetch(`${sceneOf(this).url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...bearer(call),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  sceneOf(this).status = response.status;
});

When('a module gets {string} with the bearer {string}', async function (path: string, call: string) {
  sceneOf(this).status = (await fetch(`${sceneOf(this).url}${path}`, { headers: bearer(call) })).status;
});

Then('the callback answers {int}', function (status: number) {
  assert.equal(sceneOf(this).status, status);
});

Then('the router was asked nothing but to describe {string}', function (call: string) {
  const { router } = sceneOf(this);
  assert.deepEqual(router.described, call === '' ? [] : [call]);
  assert.deepEqual([router.operated, router.called], [[], []]);
});

async function connected(world: GatewayWorld, call: string): Promise<Client> {
  const client = new Client({ name: 'test-module', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${sceneOf(world).url}/mcp`), {
      requestInit: { headers: bearer(call) },
    }),
  );
  world.cleanups.push(() => client.close());
  return client;
}

When('the module of {string} lists the tools of the callback', async function (call: string) {
  sceneOf(this).tools = (await (await connected(this, call)).listTools()).tools;
});

Then('the callback lists every data operation with the JSON schema of its input', function () {
  assert.deepEqual(
    sceneOf(this).tools,
    DATA_OP_NAMES.map((name) => ({
      name,
      inputSchema: z.toJSONSchema(DATA_OPS[name].input, { io: 'input' }),
    })),
  );
});

When(
  'the module of {string} calls back {string} with {string}',
  async function (call: string, name: string, args: string) {
    sceneOf(this).answer = await (
      await connected(this, call)
    ).callTool({ name, arguments: JSON.parse(args) });
  },
);

Then(
  'the router operated {string} with {string} for the call {string}',
  function (op: string, args: string, call: string) {
    assert.deepEqual(sceneOf(this).router.operated, [[call, op, JSON.parse(args)]]);
    assert.deepEqual(sceneOf(this).router.called, []);
  },
);

Then(
  'the router called {string} with {string} for the call {string}',
  function (address: string, args: string, call: string) {
    assert.deepEqual(sceneOf(this).router.called, [[{ call }, address, JSON.parse(args)]]);
    assert.deepEqual(sceneOf(this).router.operated, []);
  },
);

Then('the module got the text {string} and no error', function (text: string) {
  assert.deepEqual(answerOf(this), { content: [{ type: 'text', text }], isError: false });
});

Then(
  'the module got the text {string} with the structured content {string} and no error',
  function (text: string, structured: string) {
    assert.deepEqual(answerOf(this), {
      content: [{ type: 'text', text }],
      structuredContent: JSON.parse(structured),
      isError: false,
    });
  },
);

Then('the module got the text {string} flagged as an error', function (text: string) {
  assert.deepEqual(answerOf(this), { content: [{ type: 'text', text }], isError: true });
});

Then('the module got the error {string}', function (refusal: string) {
  assert.deepEqual(answerOf(this), {
    content: [{ type: 'text', text: JSON.stringify(JSON.parse(refusal)) }],
    isError: true,
  });
});

When(
  'a module posts to {string} with the authorization {string}',
  async function (path: string, authorization: string) {
    const response = await fetch(`${sceneOf(this).url}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    sceneOf(this).status = response.status;
  },
);

When(
  'a module posts an initialize to {string} with the bearer {string}',
  async function (path: string, call: string) {
    const response = await fetch(`${sceneOf(this).url}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...bearer(call),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-module', version: '0.0.0' },
        },
      }),
    });
    sceneOf(this).status = response.status;
    this.state['callback-initialize'] = {
      type: response.headers.get('content-type'),
      body: await response.json(),
    };
  },
);

Then(
  'the callback answers {int} in JSON from {string} version {string}',
  function (status: number, name: string, version: string) {
    assert.equal(sceneOf(this).status, status);
    const answer = this.state['callback-initialize'] as {
      type: string;
      body: { result: { serverInfo: unknown } };
    };
    assert.match(answer.type, /^application\/json/);
    assert.deepEqual(answer.body.result.serverInfo, { name, version });
  },
);
