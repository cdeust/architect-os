import assert from 'node:assert/strict';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { DATA_OP_NAMES } from '@architect-os/contracts';
import { DataOperations } from '../../src/application/operations.js';
import { InMemoryDataStore } from '../../src/infrastructure/in-memory.js';
import { serveStdio } from '../../src/main.js';
import { createDataMcpServer } from '../../src/presentation/mcp-server.js';
import { Given, Then, When, assertMatches, json, scenario, type DataWorld } from './helpers.js';

/** The client side of a stdio pair: what the gateway does on the stdin and stdout of data, over streams. */
class StreamClientTransport implements Transport {
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
    this.output.end();
    this.onclose?.();
  }
}

interface McpState {
  client?: Client;
  answer?: { isError: boolean; text: string };
  process?: { exit: Promise<number>; stdin: PassThrough; stdout: string[]; stderr: string[] };
}

const mcp = (world: DataWorld): McpState => (world.state['mcp'] ??= {}) as McpState;

async function connect(world: DataWorld, transport: Transport): Promise<void> {
  const client = new Client({ name: 'test-gateway', version: '0.0.0' });
  await client.connect(transport);
  world.cleanups.push(() => client.close());
  mcp(world).client = client;
}

async function serveOver(world: DataWorld, operations: DataOperations): Promise<void> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createDataMcpServer(operations);
  await server.connect(serverSide);
  world.cleanups.push(() => server.close());
  await connect(world, clientSide);
}

/** Runs serveStdio on a pair of streams, collecting what it writes on stdout and stderr. */
function startProcess(world: DataWorld, env: Record<string, string>) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written = { out: [] as string[], err: [] as string[] };
  stderr.on('data', (chunk: Buffer) => written.err.push(chunk.toString('utf8')));
  const tap = new PassThrough();
  stdout.on('data', (chunk: Buffer) => {
    written.out.push(chunk.toString('utf8'));
    tap.write(chunk);
  });
  const exit = serveStdio(env, stdin, stdout, stderr);
  world.cleanups.push(async () => {
    stdin.end();
    await exit;
  });
  mcp(world).process = { exit, stdin, stdout: written.out, stderr: written.err };
  return { stdin, tap };
}

Given('an MCP client of the data MCP server over an in-memory store', async function () {
  await serveOver(this, new DataOperations(new InMemoryDataStore()));
});

Given(
  'an MCP client of the data MCP server over a store that fails with {string}',
  async function (message: string) {
    await serveOver(
      this,
      new DataOperations({
        execute: async () => {
          throw new Error(message);
        },
      }),
    );
  },
);

Given('the data process served on a pair of streams without DATABASE_URL', async function () {
  const { stdin, tap } = startProcess(this, {});
  await connect(this, new StreamClientTransport(tap, stdin));
});

Given('the data process served on a pair of streams over the database of the scenario', async function () {
  assert.notEqual(this.databaseUrl, '', 'the @postgres hook must have created a database');
  const { stdin, tap } = startProcess(this, { DATABASE_URL: this.databaseUrl });
  await connect(this, new StreamClientTransport(tap, stdin));
});

Given('the data process started with its stdin already ended', function () {
  const { stdin } = startProcess(this, {});
  stdin.end();
});

Given('the data process started with the DATABASE_URL {string}', function (url: string) {
  startProcess(this, { DATABASE_URL: url });
});

function client(world: DataWorld): Client {
  const connected = mcp(world).client;
  assert.ok(connected, 'an MCP client of data must be given first');
  return connected;
}

When('the client calls {string} with {string}', async function (tool: string, input: string) {
  const response = await client(this).callTool({
    name: tool,
    arguments: json(scenario(this), input) as Record<string, unknown>,
  });
  const first = (response.content as { type: string; text?: string }[])[0];
  mcp(this).answer = { isError: response.isError === true, text: first?.text ?? '' };
});

function answer(world: DataWorld) {
  const got = mcp(world).answer;
  assert.ok(got, 'the client must call a tool first');
  return got;
}

When('I keep the MCP answer id as {string}', function (name: string) {
  scenario(this).vars[name] = (JSON.parse(answer(this).text) as { id: string }).id;
});

When('the stdin of the data process ends', function () {
  const process = mcp(this).process;
  assert.ok(process, 'the data process must be started first');
  process.stdin.end();
});

Then('the MCP server is {string} version {string}', function (name: string, version: string) {
  assert.deepEqual(client(this).getServerVersion(), { name, version });
});

Then('the MCP tools are exactly the typed operations', async function () {
  const { tools } = await client(this).listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...DATA_OP_NAMES].sort());
});

Then('every MCP tool has an object input schema and names the tables it writes', async function () {
  const { tools } = await client(this).listTools();
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.match(tool.description ?? '', /writes \[/, tool.name);
  }
  const append = tools.find((tool) => tool.name === 'usage.append');
  assert.match(append?.description ?? '', /writes \["usage_records"\]/);
});

Then('the MCP answer matches {string}', function (expected: string) {
  const got = answer(this);
  assert.equal(got.isError, false, got.text);
  assertMatches(JSON.parse(got.text), json(scenario(this), expected));
});

Then('the MCP call is refused with the code {string}', function (code: string) {
  const got = answer(this);
  assert.equal(got.isError, true);
  assert.equal((JSON.parse(got.text) as { code: string }).code, code);
});

Then('the MCP call is refused by the input schema', function () {
  const got = answer(this);
  assert.equal(got.isError, true);
  assert.match(got.text, /Input validation error/);
});

Then('the MCP call is refused without a code', function () {
  const got = answer(this);
  assert.equal(got.isError, true);
  assert.throws(() => JSON.parse(got.text));
});

Then('the MCP answer does not contain {string}', function (fragment: string) {
  assert.equal(answer(this).text.includes(fragment), false);
});

function started(world: DataWorld) {
  const process = mcp(world).process;
  assert.ok(process, 'the data process must be started first');
  return process;
}

Then('the data process ends with {int}', async function (code: number) {
  assert.equal(await started(this).exit, code);
});

Then('the data process wrote nothing but MCP on its stdout', function () {
  const lines = started(this).stdout.join('').split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'no MCP message');
  for (const line of lines) assert.equal((JSON.parse(line) as { jsonrpc: string }).jsonrpc, '2.0');
});

Then('the data process wrote nothing on its stdout', function () {
  assert.equal(started(this).stdout.join(''), '');
});

Then('the data process wrote {string} on its stderr', function (fragment: string) {
  const text = started(this).stderr.join('');
  assert.ok(text.includes(fragment), `stderr: ${text}`);
});
