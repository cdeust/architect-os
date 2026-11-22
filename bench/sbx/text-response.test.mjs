import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fixtureResponse,
  model,
  nativeTextStream,
  verifiedBrokerText,
  verifiedText,
} from './text-response.mjs';

const challenge = 'AOS-challenge';
const counts = { input_tokens: 8, output_tokens: 4 };

test('only the exact text and measured terminal usage reach the native client', () => {
  const r = fixtureResponse(challenge);
  r.id = 'private-provider-response';
  r.end_turn = true;
  r.output[0].phase = 'final_answer';
  r.usage.internal = 'provider metadata';
  r.output[0].content[0].annotations = [{ extra: 'provider annotation' }];
  r.output.unshift({ type: 'reasoning', summary: [], encrypted_content: 'opaque reasoning' });
  const usage = verifiedText(r, challenge, 70);
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
  'continuation required': (r) => {
    r.end_turn = false;
  },
  'partial answer': (r) => {
    r.output[0].phase = 'partial_answer';
  },
  commentary: (r) => {
    r.output[0].phase = 'commentary';
  },
  'incomplete response': (r) => {
    r.status = 'incomplete';
  },
  'different model': (r) => {
    r.model = 'other';
  },
  'incomplete item': (r) => {
    r.output[0].status = 'incomplete';
  },
  'missing final item status': (r) => {
    delete r.output[0].status;
  },
  'non-null incomplete details': (r) => {
    r.incomplete_details = { reason: 'content_filter' };
  },
  'missing total': (r) => {
    delete r.usage.total_tokens;
  },
  'output above host grant': (r) => {
    r.usage.output_tokens = 71;
    r.usage.total_tokens = 79;
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
    assert.throws(() => verifiedText(r, challenge, 70), /SBX_SUBSCRIPTION_/);
  });
}

test('the hosted port requires an already projected response', () => {
  const valid = fixtureResponse(challenge);
  assert.deepEqual(verifiedBrokerText(valid, challenge, 4), counts);
  for (const change of [
    (r) => {
      r.headers = { 'x-openai-model': 'another' };
    },
    (r) => {
      r.metadata = { openai_verification_recommendation: [] };
    },
    (r) => {
      r.output[0].safety_buffering = true;
    },
    (r) => {
      r.usage.private = 'private';
    },
  ]) {
    const response = structuredClone(valid);
    change(response);
    assert.throws(() => verifiedBrokerText(response, challenge, 4), /SBX_SUBSCRIPTION_BROKER_SHAPE/);
  }
});
