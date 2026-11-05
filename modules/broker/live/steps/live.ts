import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { UsageRecordSchema } from '@architect-os/contracts';
import { readKeyFile } from '../../src/infrastructure/key-file.js';
import { send, startTestBroker, testConfig, type Answer } from '../../features/steps/harness.js';
import { Given, Then, When, type BrokerWorld } from '../../features/steps/helpers.js';

/** The smallest model of the current family (CLAUDE.md of the owner's environment: Haiku 5.5). */
const MODEL = 'claude-haiku-5-5';

const REQUESTS: Record<string, object> = {
  'one token of the smallest model': {
    model: MODEL,
    max_tokens: 1,
    messages: [{ role: 'user', content: '1' }],
  },
  'one token as a stream': {
    model: MODEL,
    max_tokens: 1,
    stream: true,
    messages: [{ role: 'user', content: '1' }],
  },
  'an unknown model': {
    model: 'claude-no-such-model',
    max_tokens: 1,
    messages: [{ role: 'user', content: '1' }],
  },
  'no max_tokens': { model: MODEL, messages: [{ role: 'user', content: '1' }] },
};

interface Live {
  broker: Awaited<ReturnType<typeof startTestBroker>>;
  key: string;
  token: string;
  answers: Answer[];
}

const live = (world: BrokerWorld) => {
  const value = world.state['live'] as Live | undefined;
  assert.ok(value !== undefined, 'no live broker started');
  return value;
};

Given('a broker over api.anthropic.com with the test key of ANTHROPIC_TEST_KEY_FILE', async function () {
  const file = process.env['ANTHROPIC_TEST_KEY_FILE'];
  assert.ok(
    file !== undefined && file !== '',
    'ANTHROPIC_TEST_KEY_FILE is not set: this command needs a test key of the owner, in a 0600 file',
  );
  const broker = await startTestBroker(testConfig('https://api.anthropic.com', file));
  this.cleanups.push(() => broker.broker.close());
  // Read here only to check that no answer reflects it; it is never printed (assertion messages name no secret).
  this.state['live'] = { broker, key: readKeyFile(file), token: '', answers: [] } satisfies Live;
});

Given(
  'the gateway grants a live token to the task {string} called by {string}',
  async function (task: string, parent: string) {
    const s = live(this);
    s.token = `tok_${randomBytes(24).toString('base64url')}`;
    const result = await s.broker.client.callTool({
      name: 'token_grant',
      arguments: { token: s.token, task, parent },
    });
    assert.equal(result.isError, undefined, 'the grant was refused');
  },
);

When('the worker sends the live request {string}', async function (name: string) {
  const s = live(this);
  const body = REQUESTS[name];
  assert.ok(body !== undefined, `no live request named "${name}"`);
  s.answers.push(
    await send(
      s.broker.broker.relay.port,
      'POST',
      '/v1/messages',
      { 'x-api-key': s.token, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      JSON.stringify(body),
    ),
  );
});

/** The records, once the notification of the last answer has arrived. */
const records = async (s: Live) => {
  for (let tries = 0; tries < 20 && s.broker.usage.length < s.answers.length; tries++)
    await new Promise((settled) => setTimeout(settled, 50));
  return s.broker.usage.map((record) => UsageRecordSchema.parse(record));
};

Then(
  'the live answer is {int} and the usage record has the model and input tokens',
  async function (status: number) {
    const s = live(this);
    assert.equal(s.answers.at(-1)?.status, status, `status of the live answer`);
    const record = (await records(s)).at(-1);
    assert.ok(record?.model?.startsWith('claude-haiku'), `model of the record: ${record?.model}`);
    assert.ok((record?.input_tokens ?? 0) > 0, 'input tokens of the record');
  },
);

Then(
  'the live answer is {int} and the usage record has the error type {string}',
  async function (status: number, type: string) {
    const s = live(this);
    assert.equal(s.answers.at(-1)?.status, status, 'status of the live answer');
    assert.equal((await records(s)).at(-1)?.error_type, type);
  },
);

Then(
  'the gateway got {int} live usage records, all for the task {string} called by {string}',
  async function (count: number, task: string, parent: string) {
    const all = await records(live(this));
    assert.deepEqual(
      all.map((record) => [record.task, record.parent]),
      Array.from({ length: count }, () => [task, parent]),
    );
  },
);

Then('no live answer, header or body, reflects the key or the token', function () {
  const s = live(this);
  const text = JSON.stringify(s.answers);
  // R-11: no reflection observed. The message names no secret.
  assert.ok(!text.includes(s.key), 'an answer reflects the key');
  assert.ok(!text.includes(s.token), 'an answer reflects the token');
});
