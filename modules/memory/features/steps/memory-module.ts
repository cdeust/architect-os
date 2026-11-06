import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { serve } from '../../src/main.js';
import { Given, Then, When, required, type ModuleWorld } from './helpers.js';

/** The gateway end of the stdio of the module: MCP framing over two streams. */
class StreamTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  async start(): Promise<void> {
    this.input.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message !== null; message = this.buffer.readMessage())
        this.onmessage?.(message);
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.output.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

interface Scene {
  received: { bearer: string | undefined; name: string; args: unknown }[];
  /** The client of each initialize the callback answered: one server per request, stateless. */
  clients: unknown[];
  stdin: PassThrough;
  stderr: PassThrough;
  ended: Promise<number>;
  gateway?: Client;
  answer?: Record<string, unknown>;
}

const sceneOf = (world: ModuleWorld) =>
  required(world.state['module'] as Scene | undefined, 'a served module');
const gatewayOf = (world: ModuleWorld) => required(sceneOf(world).gateway, 'a connected gateway');

/** A fake callback of the gateway on a free loopback port, answering every call with `answer`. */
async function fakeCallback(
  world: ModuleWorld,
  received: Scene['received'],
  clients: Scene['clients'],
  answer: CallToolResult,
): Promise<string> {
  const http = createServer((req, res) => {
    const server = new Server({ name: 'fake-callback', version: '0.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, (request) => {
      received.push({
        bearer: req.headers.authorization,
        name: request.params.name,
        args: request.params.arguments,
      });
      return answer;
    });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => void transport.close());
    void server
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .then(() => {
        const client = server.getClientVersion();
        if (client !== undefined) clients.push(client);
      });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  world.cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
}

async function served(
  world: ModuleWorld,
  env: Record<string, string>,
  answer?: CallToolResult,
): Promise<void> {
  const received: Scene['received'] = [];
  const clients: Scene['clients'] = [];
  const url =
    answer === undefined
      ? {}
      : { GATEWAY_CALLBACK_URL: await fakeCallback(world, received, clients, answer) };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const scene: Scene = {
    received,
    clients,
    stdin,
    stderr,
    ended: serve({ ...env, ...url }, stdin, stdout, stderr),
  };
  world.state['module'] = scene;
  if (answer === undefined) return;
  const gateway = new Client({ name: 'test-gateway', version: '0.0.0' });
  await gateway.connect(new StreamTransport(stdout, stdin));
  scene.gateway = gateway;
  world.cleanups.push(() => void stdin.end());
}

const text = (value: string, extra: Partial<CallToolResult> = {}): CallToolResult => ({
  content: [{ type: 'text', text: value }],
  ...extra,
});

Given('the module memory served with its callback on a fake gateway', function () {
  return served(this, {}, text('[{"id":"m1"}]', { structuredContent: { rows: 1 } }));
});

Given(
  'the module memory served with its callback on a fake gateway that refuses with {string}',
  function (refusal: string) {
    return served(this, {}, text(refusal, { isError: true }));
  },
);

Given('the module memory served with its callback on a fake gateway that answers no text', function () {
  return served(this, {}, { content: [] });
});

When('the module memory is served without GATEWAY_CALLBACK_URL', function () {
  return served(this, { PATH: '/usr/bin' });
});

Then(
  'the module lists exactly the tools {string} with the input schemas of {string}',
  async function (names: string, _views: string) {
    const { tools } = await gatewayOf(this).listTools();
    const committed = (name: string) =>
      JSON.parse(readFileSync(new URL(`../../schemas/${name}.in.json`, import.meta.url), 'utf8')) as Record<
        string,
        unknown
      >;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      names.split(','),
    );
    for (const tool of tools) {
      const { $schema: _, ...schema } = committed(tool.name);
      const { $schema: __, ...listed } = tool.inputSchema as Record<string, unknown>;
      assert.deepEqual(listed, schema, tool.name);
    }
  },
);

When(
  'the gateway calls {string} with {string} and the call identifier {string}',
  async function (name: string, args: string, call: string) {
    sceneOf(this).answer = await gatewayOf(this).callTool({
      name,
      arguments: JSON.parse(args),
      _meta: { call },
    });
  },
);

When(
  'the gateway calls {string} with {string} without a call identifier',
  async function (name: string, args: string) {
    sceneOf(this).answer = await gatewayOf(this).callTool({ name, arguments: JSON.parse(args) });
  },
);

Then(
  'the callback got {string} with {string} and the bearer {string}',
  function (op: string, args: string, call: string) {
    assert.deepEqual(sceneOf(this).received, [
      { bearer: `Bearer ${call}`, name: op, args: JSON.parse(args) },
    ]);
  },
);

Then('the callback got nothing', function () {
  assert.deepEqual(sceneOf(this).received, []);
});

Then(
  'the module answered the text {string} with the structured content {string} and no error',
  function (value: string, structured: string) {
    assert.deepEqual(
      sceneOf(this).answer,
      text(value, { structuredContent: JSON.parse(structured), isError: false }),
    );
  },
);

Then('the module answered the text {string} and no error', function (value: string) {
  assert.deepEqual(sceneOf(this).answer, text(value, { isError: false }));
});

Then('the module answered the text {string} flagged as an error', function (value: string) {
  assert.deepEqual(sceneOf(this).answer, text(value, { isError: true }));
});

When('the gateway closes the stdin of the module', function () {
  sceneOf(this).stdin.end();
});

Then('the module ends with the exit code {int}', async function (code: number) {
  assert.equal(await sceneOf(this).ended, code);
});

Then('the module wrote {string} on its stderr', function (message: string) {
  assert.equal(String(sceneOf(this).stderr.read()), `${message}\n`);
});

Then('the module is served by {string} version {string}', function (name: string, version: string) {
  assert.deepEqual(gatewayOf(this).getServerVersion(), { name, version });
});

Then(
  'the callback was called by the client {string} version {string}',
  function (name: string, version: string) {
    assert.deepEqual(sceneOf(this).clients, [{ name, version }]);
  },
);
