import assert from 'node:assert/strict';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UsageRecordSchema } from '@architect-os/contracts';
import type { StartedBroker } from '../../src/main.js';
import {
  fakeUpstream,
  keyFile,
  send,
  startTestBroker,
  testConfig,
  type Answer,
  type UpstreamAnswer,
} from './harness.js';
import { Given, Then, When, slot, type BrokerWorld } from './helpers.js';

class BrokerScenario {
  upstream: Awaited<ReturnType<typeof fakeUpstream>> | undefined;
  key = '';
  keyPath = '';
  broker: StartedBroker | undefined;
  client: Client | undefined;
  usage: unknown[] = [];
  answers: Answer[] = [];
  tokens: string[] = [];
  toolResult: { isError?: boolean; text: string } | undefined;
}
const scenario = (world: BrokerWorld) => slot(world, 'broker', () => new BrokerScenario());
const must = <T>(value: T | undefined, what: string): T => {
  assert.ok(value !== undefined, `${what} must be given first`);
  return value;
};

Given('a fake upstream answering a JSON message', async function () {
  const upstream = await fakeUpstream();
  scenario(this).upstream = upstream;
  this.cleanups.push(() => upstream.close());
});

Given('a broker over that upstream with the key {string}', async function (key: string) {
  const s = scenario(this);
  const file = keyFile(key);
  this.cleanups.push(file.remove);
  s.key = key;
  s.keyPath = file.file;
  const started = await startTestBroker(testConfig(must(s.upstream, 'an upstream').url, file.file));
  Object.assign(s, { broker: started.broker, client: started.client, usage: started.usage });
  this.cleanups.push(() => started.broker.close());
});

const ANSWER_NAMES: Record<string, UpstreamAnswer> = {
  'a JSON message': 'json',
  'a stream of events': 'sse',
  'an API error': 'error',
};

Given('the fake upstream answers {}', function (name: string) {
  const kind = ANSWER_NAMES[name];
  assert.ok(kind !== undefined, `no upstream answer named "${name}"`);
  must(scenario(this).upstream, 'an upstream').answer(kind);
});

Then('the gateway sees the MCP server {string} version {string}', function (name: string, version: string) {
  assert.deepEqual(must(scenario(this).client, 'a gateway').getServerVersion(), { name, version });
});

/** The text of a tool result, and whether it is an error. */
async function callTool(world: BrokerWorld, name: string, args: Record<string, unknown>) {
  const s = scenario(world);
  const result = (await must(s.client, 'a gateway').callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  s.toolResult = {
    ...(result.isError === undefined ? {} : { isError: result.isError }),
    text: result.content[0]?.text ?? '',
  };
  return s.toolResult;
}

const grant = async (world: BrokerWorld, token: string, task: string, parent?: string) => {
  scenario(world).tokens.push(token);
  return callTool(world, 'token_grant', { token, task, ...(parent === undefined ? {} : { parent }) });
};

Given(
  'the gateway grants the token {string} to the task {string} called by {string}',
  async function (token: string, task: string, parent: string) {
    const result = await grant(this, token, task, parent);
    // A Given that must hold: the first grant of a token succeeds. A When below checks a refused one.
    if (scenario(this).tokens.filter((t) => t === token).length === 1)
      assert.deepEqual(result, { text: '{"granted":true}' });
  },
);

Given(
  'the gateway grants the token {string} to the task {string}',
  async function (token: string, task: string) {
    assert.deepEqual(await grant(this, token, task), { text: '{"granted":true}' });
  },
);

When('the gateway revokes the token {string}', async function (token: string) {
  await callTool(this, 'token_revoke', { token });
});

Then('the broker answered the revocation with {string}', function (text: string) {
  assert.deepEqual(scenario(this).toolResult, { text });
});

Then('the grant is refused with {string}', function (text: string) {
  assert.deepEqual(scenario(this).toolResult, { isError: true, text });
});

When('the gateway calls token_grant with {string}', async function (args: string) {
  scenario(this).tokens.push('tok_hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh');
  await callTool(this, 'token_grant', JSON.parse(args) as Record<string, unknown>);
});

Then('the grant is refused by the schema', function () {
  const result = must(scenario(this).toolResult, 'a tool result');
  assert.equal(result.isError, true);
  assert.match(result.text, /Input validation error/);
});

const port = (world: BrokerWorld) => must(scenario(world).broker, 'a broker').relay.port;

const post = async (
  world: BrokerWorld,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
) => {
  scenario(world).answers.push(await send(port(world), method, path, headers, body));
};

When(
  'the worker posts {string} to {string} with the token {string}',
  async function (body: string, path: string, token: string) {
    await post(this, 'POST', path, { 'x-api-key': token, 'content-type': 'application/json' }, body);
  },
);

When(
  'the worker posts {string} to {string} with the headers {string}',
  async function (body: string, path: string, pairs: string) {
    const headers = Object.fromEntries(pairs.split(', ').map((pair) => pair.split('=') as [string, string]));
    await post(this, 'POST', path, headers, body);
  },
);

When(
  'the worker sends {string} to {string} with the token {string}',
  async function (method: string, path: string, token: string) {
    await post(this, method, path, { 'x-api-key': token }, method === 'GET' ? '' : '{}');
  },
);

const lastAnswer = (world: BrokerWorld) => must(scenario(world).answers.at(-1), 'an answer');

Then('the broker answers 200 with the body of the upstream', function () {
  const answer = lastAnswer(this);
  assert.equal(answer.status, 200);
  assert.match(answer.body, /SECRET-CONTENT/);
});

Then('the broker answers {int} {string}', function (status: number, type: string) {
  const answer = lastAnswer(this);
  assert.equal(answer.status, status);
  assert.equal((JSON.parse(answer.body) as { error: { type: string } }).error.type, type);
});

Then('the broker answers {int} with exactly:', function (status: number, body: string) {
  assert.deepEqual([lastAnswer(this).status, lastAnswer(this).body], [status, body]);
});

const upstreamRequests = (world: BrokerWorld) => must(scenario(world).upstream, 'an upstream').requests;

Then(
  'the upstream received one POST to {string} with the body {string}',
  function (url: string, body: string) {
    const requests = upstreamRequests(this);
    assert.deepEqual(
      requests.map(({ method, url, body }) => ({ method, url, body })),
      [{ method: 'POST', url, body }],
    );
  },
);

Then(
  'the upstream request carried the key {string} in x-api-key and no authorization',
  function (key: string) {
    const [request] = upstreamRequests(this);
    assert.deepEqual([request?.headers['x-api-key'], request?.headers['authorization']], [key, undefined]);
  },
);

Then('the upstream of the broker received no request', function () {
  assert.deepEqual(upstreamRequests(this), []);
});

/** The usage records, once the notifications sent with the answers have arrived. */
async function usage(world: BrokerWorld): Promise<unknown[]> {
  await new Promise((settled) => setTimeout(settled, 50));
  return scenario(world).usage;
}

Then('the gateway got one usage record matching:', async function (expected: string) {
  const records = (await usage(this)) as Record<string, unknown>[];
  assert.equal(records.length, 1, JSON.stringify(records));
  const want = JSON.parse(expected) as Record<string, unknown>;
  const record = records[0] as Record<string, unknown>;
  assert.deepEqual(Object.fromEntries(Object.keys(want).map((key) => [key, record[key]])), want);
  assert.equal(typeof record['at'], 'string');
});

Then('the usage record has no parent', async function () {
  const [record] = (await usage(this)) as Record<string, unknown>[];
  assert.equal('parent' in (record ?? {}), false);
});

Then('the gateway got no usage record', async function () {
  assert.deepEqual(await usage(this), []);
});

Then('every usage record is valid against the contract of the broker', async function () {
  for (const record of await usage(this)) UsageRecordSchema.parse(record);
});

Then('no usage record and no answer holds the key, the token or the content', async function () {
  const s = scenario(this);
  const text = JSON.stringify([await usage(this), s.answers.map((a) => [a.headers, a.status])]);
  for (const secret of [s.key, ...s.tokens]) assert.ok(!text.includes(secret), 'a secret leaked');
  assert.ok(!JSON.stringify(await usage(this)).includes('SECRET-CONTENT'), 'content in a usage record');
});

Given('the key file of the broker is {}', function (change: string) {
  const path = scenario(this).keyPath;
  if (change === 'removed') rmSync(path);
  else if (change === 'readable by its group') chmodSync(path, 0o640);
  else if (change === 'emptied') writeFileSync(path, '\n');
  else assert.fail(`no key file change named "${change}"`);
});
