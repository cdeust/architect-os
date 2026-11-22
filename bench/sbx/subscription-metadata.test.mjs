import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { subscriptionMetadata } from './subscription-metadata.mjs';

const type = 'response.metadata';
const model = 'gpt-6.2-astra';
const id = 'resp_fixture';
const classify = (extra) => subscriptionMetadata({ type, ...extra }, id, model);

test('the second native trial fingerprint identifies the upstream metadata event', () => {
  assert.equal(
    createHash('sha256').update(type).digest('hex'),
    '037e125ea2d6a409e3e17d05b062ce57c418a2d6443a96ccbc21a13252500441',
  );
});

test('only an informational envelope or a matching model confirmation is consumed', () => {
  for (const fields of [
    {},
    { response_id: id, metadata: {}, headers: {}, sequence_number: 0 },
    { headers: { 'OpenAI-Model': model, 'X-OpenAI-Model': model } },
  ]) {
    assert.equal(classify(fields), 'informational');
  }
  assert.equal(subscriptionMetadata({ type }, null, model), 'unbound_metadata');
  assert.equal(classify({ response_id: 'other' }), 'unbound_metadata');
  assert.equal(classify({ headers: { 'openai-model': 'other' } }), 'model_mismatch');
});

test('policy, opaque state, unknown headers and invalid fields stay on the refusal path', () => {
  for (const fields of [
    { safety_buffering: true },
    { metadata: { openai_verification_recommendation: [] } },
    { metadata: { openai_chatgpt_moderation_metadata: { presentation: 'inline' } } },
    { metadata: { unknown: 'private' } },
    { headers: { 'x-codex-turn-state': 'opaque' } },
    { item: { type: 'function_call' } },
  ]) {
    assert.equal(classify(fields), 'requires_native_handling');
  }
  for (const fields of [{ metadata: null }, { metadata: [] }, { headers: 'text' }, { sequence_number: -1 }]) {
    assert.equal(classify(fields), 'invalid_metadata');
  }
});
