import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureResponse, model, nativeTextStream, verifiedText } from './text-response.mjs';

const challenge = 'AOS-challenge';
const counts = { input_tokens: 8, output_tokens: 4 };

test('only the exact text and measured terminal usage reach the native client', () => {
  const r = fixtureResponse(challenge);
  r.id = 'private-provider-response';
  r.usage.internal = 'provider metadata';
  r.output[0].content[0].annotations = [{ extra: 'provider annotation' }];
  r.output.unshift({ type: 'reasoning', summary: [], encrypted_content: 'opaque reasoning' });
  const usage = verifiedText(r, challenge);
  assert.deepEqual(usage, counts);
  const stream = nativeTextStream(challenge, usage);
  assert.doesNotMatch(
    stream,
    /private-provider-response|provider metadata|provider annotation|opaque reasoning/,
  );
  const events = stream
    .trimEnd()
    .split('\n\n')
    .map((block) => JSON.parse(block.split('\ndata: ')[1]));
  assert.deepEqual(
    events.map((e) => e.type),
    ['response.created', 'response.output_item.done', 'response.completed'],
  );
  const [start, item, done] = events;
  assert.equal(start.response.id, done.response.id);
  assert.deepEqual(done.response.output, [item.item]);
  assert.equal(done.response.model, model);
  assert.deepEqual(done.response.usage, { ...counts, total_tokens: 12 });
});

for (const [name, change] of Object.entries({
  'incomplete response': (r) => {
    r.status = 'incomplete';
  },
  'different model': (r) => {
    r.model = 'other';
  },
  'incomplete item': (r) => {
    r.output[0].status = 'incomplete';
  },
  'inconsistent total': (r) => {
    r.usage.total_tokens = 0;
  },
  'unsafe total': (r) => {
    r.usage.input_tokens = Number.MAX_SAFE_INTEGER;
  },
  'embedded error': (r) => {
    r.error = {};
  },
  'tool invocation': (r) => {
    r.output.push({ type: 'function_call' });
  },
  'different role': (r) => {
    r.output[0].role = 'user';
  },
  'additional content': (r) => {
    r.output[0].content.push({ type: 'refusal' });
  },
  'different challenge': (r) => {
    r.output[0].content[0].text += 'extra';
  },
  refusal: (r) => {
    r.output[0].content[0].type = 'refusal';
  },
  'missing usage': (r) => {
    delete r.usage;
  },
  'empty output count': (r) => {
    r.usage.output_tokens = 0;
  },
  'unsafe count': (r) => {
    r.usage.input_tokens = Number.MAX_SAFE_INTEGER + 1;
  },
})) {
  test('refuses ' + name, () => {
    const r = fixtureResponse(challenge);
    change(r);
    assert.throws(() => verifiedText(r, challenge), /SBX_SUBSCRIPTION_/);
  });
}
