import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createSubscriptionControls,
  subscriptionMetadata,
  unknownHttpControlFingerprint,
} from './subscription-metadata.mjs';

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

test('control fields on explicit, ordinary and nested events veto delivery', () => {
  // Guardian only describes one completed action. Even requires_review=false grants no authority.
  const cases = [
    [{ guardian: { item_id: 'fixture', requires_review: false } }, 'guardian_assessment'],
    [{ guardian: { item_id: 'fixture', requires_review: true } }, 'guardian_assessment'],
    [{ guardian: null }, 'guardian_assessment'],
    [{ future: 'private', guardian: null }, 'guardian_assessment'],
    [{ openai_verification_recommendation: ['trusted_access_for_cyber'] }, 'model_verification'],
    [{ openai_verification_recommendation: { unexpected: true } }, 'model_verification'],
    [{ openai_chatgpt_moderation_metadata: { presentation: 'inline', display: {} } }, 'turn_moderation'],
    [{ openai_chatgpt_moderation_metadata: null }, 'turn_moderation'],
    [{ type: 'safety_buffering', retry_model: 'private-substitute' }, 'safety_buffering'],
    [{ safety_buffering: { retry_model: 'private-substitute' } }, 'safety_buffering'],
    [{ unknown: 'private' }, 'requires_native_handling'],
  ];
  for (const [metadata, disposition] of cases) {
    assert.equal(classify({ metadata }), disposition);
    for (const notification of [{ metadata }, { response: { metadata } }]) {
      assert.equal(
        createSubscriptionControls(model).event({ type: 'response.created', ...notification }, id),
        disposition,
      );
    }
  }
  for (const field of [true, null, {}, { retry_model: 'private-substitute' }]) {
    assert.equal(classify({ safety_buffering: field }), 'safety_buffering');
  }
  assert.equal(
    classify({ safety_buffering: false, metadata: { type: 'safety_buffering' } }),
    'safety_buffering',
  );
  assert.equal(classify({ safety_buffering: false }), 'informational');
  assert.equal(classify({ item: { type: 'function_call' } }), 'requires_native_handling');
  for (const fields of [{ metadata: null }, { metadata: [] }, { headers: 'text' }, { sequence_number: -1 }]) {
    assert.equal(classify(fields), 'invalid_metadata');
  }
});

test('the documented empty verification list never masks a sibling control', () => {
  const empty = { openai_verification_recommendation: [] };
  assert.equal(classify({ metadata: empty }), 'informational');
  for (const [sibling, result] of [
    [{ guardian: { item_id: 'fixture', requires_review: true } }, 'guardian_assessment'],
    [{ openai_chatgpt_moderation_metadata: null }, 'turn_moderation'],
    [{ type: 'safety_buffering' }, 'safety_buffering'],
    [{ future: null }, 'requires_native_handling'],
  ]) {
    assert.equal(classify({ metadata: { ...empty, ...sibling } }), result);
    assert.equal(classify({ metadata: { ...sibling, ...empty } }), result);
  }
  assert.equal(classify({ metadata: empty, safety_buffering: true }), 'safety_buffering');
  assert.equal(classify({ metadata: empty, headers: { 'openai-model': 'other' } }), 'model_mismatch');
});

test('the fourth trial identified the gateway header by name; only the observed public wire version is understood', () => {
  const name = 'x-openai-proxy-wasm';
  assert.equal(
    createHash('sha256').update(name).digest('hex'),
    'a5b017a27edeb0ac49e363aa14c45553bdceb0131dd02d4ac238a871745e7867',
  );
  const inspect = (headers) => createSubscriptionControls(model).http(headers);
  assert.equal(inspect({ [name]: ['v0.1'] }), 'informational');
  for (const value of [[], ['v0.2'], ['v0.1', 'v0.1'], ['v0.1, v0.1'], 'v0.1', [null]]) {
    assert.equal(inspect({ [name]: value }), 'unrecognized_proxy_version');
  }
  assert.equal(inspect({ [name.toUpperCase()]: ['v0.1'], [name]: ['v0.1'] }), 'unrecognized_proxy_version');
  assert.equal(classify({ headers: { [name]: 'v0.1' } }), 'requires_native_handling');
  assert.equal(inspect({ [name]: ['v0.1'], 'x-openai-proxy-new': ['v0.1'] }), 'requires_native_handling');
  assert.equal(
    inspect({ [name]: ['v0.1'], 'x-reasoning-included': ['true'] }),
    'reasoning_control',
  );
});

test('the host carries one bound inline notification and clears it on a refusal or close', () => {
  const key = 'openai_chatgpt_moderation_metadata';
  const metadata = { [key]: { presentation: 'inline' } };
  const notice = { type, response_id: id, metadata };
  const start = () => createSubscriptionControls(model);
  const valid = start();
  assert.equal(valid.event(notice, id), 'informational');
  assert.equal(valid.moderationPresentation, 'inline');
  assert.equal(valid.event(notice, id), 'turn_moderation');
  assert.equal(valid.moderationPresentation, undefined);
  const closed = start();
  assert.equal(closed.event(notice, id), 'informational');
  closed.close();
  assert.equal(closed.moderationPresentation, undefined);
  for (const event of [
    { ...notice, response_id: 'another' },
    { ...notice, type: 'response.created' },
    { type: 'response.in_progress', response: { metadata } },
    { ...notice, metadata: { ...metadata, unknown: false } },
    { ...notice, metadata: { ...metadata, guardian: {} } },
    { ...notice, safety_buffering: true },
    { ...notice, metadata: { [key]: { presentation: 'inline', final_answer_moderation: {} } } },
    { ...notice, metadata: { [key]: { presentation: 'other' } } },
    { ...notice, metadata: { [key]: ['inline'] } },
  ]) {
    const controls = start();
    assert.notEqual(controls.event(event, id), 'informational');
    assert.equal(controls.moderationPresentation, undefined);
  }
});

test('HTTP diagnostics and private account telemetry are never read', () => {
  const headers = {};
  for (const name of [
    'content-type',
    'set-cookie',
    'x-request-id',
    'openai-organization',
    'x-codex-credits-balance',
    'x-codex-primary-used-percent',
    'x-codex-secondary-reset-at',
  ]) {
    Object.defineProperty(headers, name, {
      enumerable: true,
      get() {
        assert.fail('private value was accessed');
      },
    });
  }
  assert.equal(createSubscriptionControls(model).http(headers), 'informational');
  // Only the HTTP layer can carry unrelated transport headers.
  assert.equal(classify({ headers: { 'set-cookie': 'private' } }), 'requires_native_handling');
});

test('only the canonical name of the first unknown HTTP control is fingerprinted', () => {
  const name = 'X-OpenAI-Future-Control';
  const expected = createHash('sha256').update(name.toLowerCase()).digest('hex');
  const headers = Object.create(null);
  for (const key of [
    'content-type',
    'set-cookie',
    'x-codex-credits-balance',
    'x-codex-secondary-reset-at',
    name,
    'x-codex-next-control',
  ]) {
    Object.defineProperty(headers, key, {
      enumerable: true,
      get: () => assert.fail('read a private HTTP value'),
    });
  }
  assert.equal(unknownHttpControlFingerprint(headers), expected);
  assert.equal(unknownHttpControlFingerprint({ [name]: ['private provider value'] }), expected);
  assert.equal(unknownHttpControlFingerprint({ [name.toLowerCase()]: ['another value'] }), expected);
  assert.equal(createSubscriptionControls(model).http(headers), 'requires_native_handling');
});

test('known controls, ordinary HTTP names and malformed envelopes cannot produce a fingerprint', () => {
  for (const headers of [
    null,
    [],
    'private text',
    {},
    {
      'OpenAI-Model': ['different'],
      'x-codex-turn-state': ['opaque'],
      'x-codex-safety-buffering-enabled': ['true'],
      'x-models-etag': ['hidden'],
      'x-reasoning-included': ['true'],
      'x-codex-rate-limit-reached-type': ['hidden'],
      'OpenAI-Organization': ['private'],
      'x-codex-primary-window-minutes': ['private'],
      authorization: ['private'],
      'x-unrelated-private-name': ['private'],
    },
  ])
    assert.equal(unknownHttpControlFingerprint(headers), undefined);
});

test('unsafe refused names are never fingerprinted or replaced with a later candidate', () => {
  for (const key of [
    'x-codex-private text',
    'x-codex-\u212Aey',
    'x-codex-trailing\n',
    'x-codex-sk-fixture',
    'x-openai-resp_fixture',
    'openai-eyJprivate',
    'x-codex-two--parts',
  ]) {
    const headers = { [key]: ['private'], 'x-codex-next-control': ['private'] };
    assert.equal(createSubscriptionControls(model).http(headers), 'requires_native_handling');
    assert.equal(unknownHttpControlFingerprint(headers), undefined);
  }
});

test('HTTP buffering parameters are response scoped and remain controls inside event headers', () => {
  const enabled = 'x-codex-safety-buffering-enabled';
  const fallback = 'x-codex-safety-buffering-faster-model';
  for (const [name, value] of [
    [enabled, 'true'],
    [enabled, 'false'],
    [fallback, 'gpt-faster-fixture'],
  ]) {
    assert.equal(createSubscriptionControls(model).http({ [name]: [value] }), 'informational');
    assert.equal(classify({ headers: { [name]: value } }), 'safety_buffering');
    for (const invalid of [value, [], [value, value], [value + ',' + value], [null], [true], [''], [' ']]) {
      assert.equal(
        createSubscriptionControls(model).http({ [name]: invalid }),
        'ambiguous_buffering_treatment',
      );
    }
    const duplicate = { [name]: [value], [name.toUpperCase()]: [value] };
    assert.equal(createSubscriptionControls(model).http(duplicate), 'ambiguous_buffering_treatment');
  }
  for (const [name, value] of [
    [enabled, '0'],
    [enabled, 'unknown'],
    [fallback, 'https://private.invalid'],
  ]) {
    assert.equal(
      createSubscriptionControls(model).http({ [name]: [value] }),
      'ambiguous_buffering_treatment',
    );
  }
  const controls = createSubscriptionControls(model);
  assert.equal(controls.http({ [enabled]: ['false'], [fallback]: ['gpt-faster-fixture'] }), 'informational');
  assert.equal(controls.http({}), 'unbound_metadata');
});

test('other provider control headers veto delivery in HTTP and event contexts', () => {
  for (const [name, value, disposition] of [
    ['x-models-etag', 'private-catalog', 'catalog_refresh'],
    ['x-reasoning-included', 'false', 'reasoning_control'],
    ['x-codex-rate-limit-reached-type', 'private-snapshot', 'rate_limit_control'],
    ['x-codex-future-control', 'private-control', 'requires_native_handling'],
    ['openai-future-control', 'private-control', 'requires_native_handling'],
  ]) {
    assert.equal(createSubscriptionControls(model).http({ [name]: [value] }), disposition);
    assert.equal(classify({ headers: { [name]: value } }), disposition);
  }
});

test('explicit or ambiguous model identity takes precedence over every other HTTP control', () => {
  const treatment = { 'x-codex-safety-buffering-enabled': ['true'] };
  for (const [fields, result] of [
    [{ 'openai-model': ['other'] }, 'model_mismatch'],
    [{ 'openai-model': [model, model] }, 'ambiguous_model'],
    [{ 'openai-model': [null] }, 'ambiguous_model'],
    [{ 'openai-model': [[model]] }, 'ambiguous_model'],
    [{ 'openai-model': [model + ',other'] }, 'ambiguous_model'],
    [{ 'openai-model': model }, 'ambiguous_model'],
    [{ 'openai-model': [model], 'OpenAI-Model': [model] }, 'ambiguous_model'],
    [{ 'openai-model': [model], 'x-openai-model': ['other'] }, 'ambiguous_model'],
  ]) {
    for (const headers of [
      { ...fields, ...treatment },
      { ...treatment, ...fields },
    ]) {
      assert.equal(createSubscriptionControls(model).http(headers), result);
    }
  }
  const aliases = { 'OpenAI-Model': [model], 'X-OpenAI-Model': [model] };
  assert.equal(createSubscriptionControls(model).http(aliases), 'informational');
  assert.equal(classify({ headers: aliases }), 'informational');
  assert.equal(
    createSubscriptionControls(model).event(
      {
        type: 'response.created',
        headers: { 'openai-model': model },
        response: { headers: { 'openai-model': 'other' } },
      },
      id,
    ),
    'ambiguous_model',
  );
});

test('opaque routing state is only compared within one response and never returned', () => {
  const key = 'x-codex-turn-state';
  const withState = (value) => ({ type, headers: { [key]: value } });
  const controls = createSubscriptionControls(model);
  assert.equal(controls.http({ [key]: ['private-state-a'] }), 'informational');
  assert.equal(controls.event(withState('private-state-a'), id), 'informational');
  assert.equal(controls.event(withState('private-state-b'), id), 'ambiguous_turn_state');
  assert.equal(controls.event({ type }, id), 'unbound_metadata');
  controls.close();
  assert.equal(controls.http({}), 'unbound_metadata');
  const next = createSubscriptionControls(model);
  assert.equal(next.http({ [key]: ['private-state-b'] }), 'informational');
  assert.equal(next.event(withState(['private-state-b']), 'next-response'), 'informational');
  assert.equal(next.event(withState('private-state-b'), id), 'unbound_metadata');
  next.close();
  assert.equal(classify({ headers: { [key]: 'private-state-c' } }), 'informational');
  for (const value of [[], null, ['one', 'two'], 'one,two', 'one\ntwo', '']) {
    assert.equal(classify({ headers: { [key]: value } }), 'ambiguous_turn_state');
  }
  assert.equal(classify({ headers: { [key]: 'one', 'X-Codex-Turn-State': 'one' } }), 'ambiguous_turn_state');
});

test('a control scope cannot accept a second HTTP response or survive explicit close', () => {
  const first = createSubscriptionControls(model);
  assert.equal(first.http({}), 'informational');
  assert.equal(first.http({}), 'unbound_metadata');
  const second = createSubscriptionControls(model);
  assert.equal(second.event({ type }, id), 'informational');
  assert.equal(second.http({}), 'unbound_metadata');
  const third = createSubscriptionControls(model);
  third.close();
  assert.equal(third.event({ type }, id), 'unbound_metadata');
  assert.equal(subscriptionMetadata({ type: 'response.created' }, id, model), 'unbound_metadata');
  assert.equal(subscriptionMetadata({ type }, id, ''), 'unbound_metadata');
});
