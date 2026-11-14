import assert from 'node:assert/strict';
import type { MemoryItem } from '@architect-os/contracts';
import type { ServiceResponse } from '../../gateway/src/domain/ports.js';
import { BROKER_KEY, startSrtPlatform, type SrtPlatform } from '../support/srt-platform.js';
import type { ArchitectWorld } from '../support/world.js';
import { Given, Then, When } from './helpers.js';

interface Platform extends SrtPlatform {
  task?: { task: string; token: string };
  answer?: ServiceResponse;
  /** The memories the store held before the call. */
  before?: MemoryItem[];
}

const platformOf = (world: ArchitectWorld): Platform => {
  const platform = world.state['recall-srt'] as Platform | undefined;
  assert.ok(platform, 'the platform must be given first');
  return platform;
};

Given(
  'the platform of the committed topology under srt, data in memory holding the memory {string}, and the broker before a fake model that searches the memory for {string} then answers {string}',
  { timeout: 60_000 },
  async function (content: string, query: string, output: string) {
    const platform = await startSrtPlatform(content, [
      { tool: 'mcp__platform__memory_search', input: { query, limit: 5 } },
      { tool: 'StructuredOutput', input: JSON.parse(output) },
    ]);
    this.cleanups.push(() => platform.close());
    this.state['recall-srt'] = platform satisfies Platform;
  },
);

Given(
  'the platform of the committed topology under srt, data in memory holding the memory {string}, and the broker before a fake model that inserts the memory {string} tagged {string} then answers with the id it got',
  { timeout: 60_000 },
  async function (held: string, content: string, tags: string) {
    const platform = await startSrtPlatform(held, [
      { tool: 'mcp__platform__memory_insert', input: { content, tags: tags.split(',') } },
      {
        tool: 'StructuredOutput',
        inputFrom: (result) => ({ memory_id: (/"id"\s*:\s*"([^"]+)"/.exec(result) ?? [])[1] }),
      },
    ]);
    this.cleanups.push(() => platform.close());
    const given: Platform = platform;
    given.before = await platform.memories();
    this.state['recall-srt'] = given;
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

Then('the call answers ok with a memory id', function () {
  const { answer } = platformOf(this);
  assert.ok(answer !== undefined && !answer.isError, String(answer?.text));
  assert.equal(answer.structured?.['status'], 'ok');
  const data = answer.structured?.['data'] as { memory_id?: unknown } | undefined;
  assert.ok(typeof data?.memory_id === 'string' && data.memory_id !== '', JSON.stringify(data));
});

Then(
  'the store holds exactly one memory more, {string} tagged {string}, whose id is the memory id of the answer',
  async function (content: string, tags: string) {
    const platform = platformOf(this);
    const known = new Set((platform.before ?? []).map((memory) => memory.id));
    const added = (await platform.memories()).filter((memory) => !known.has(memory.id));
    const data = platform.answer?.structured?.['data'] as { memory_id: string };
    assert.deepEqual(
      added.map(({ id, content, tags }) => ({ id, content, tags })),
      [{ id: data.memory_id, content, tags: tags.split(',') }],
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
