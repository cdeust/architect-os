import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { frameByteLimit } from './json-frame.mjs';
import { observeSubscription } from './subscription-observation.mjs';
import { parseResponse } from './subscription-stream.mjs';

const model = 'gpt-6.2-astra';
const id = 'resp_sensitive_fixture_id';
const secret = 'private fixture header and safety data';
const usage = { input_tokens: 17, output_tokens: 4, total_tokens: 21 };
const opened = { type: 'response.created', response: { id, model, status: 'in_progress' } };
function end(status = 'completed', counts = usage) {
  return { type: 'response.' + status, response: { id, model, status, usage: counts, output: [] } };
}
const wire = (...events) => events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
const observe = (...events) => observeSubscription(wire(...events), model);
const hash = (name) => createHash('sha256').update(name).digest('hex');

test('provider accounting survives an earlier mandatory native rejection with no provider data disclosed', () => {
  const metadata = {
    type: 'response.metadata',
    response_id: id,
    headers: { 'X-Codex-Turn-State': secret, 'X-OpenAI-Model': model, 'X-Unknown-Header': secret },
    metadata: {
      openai_verification_recommendation: { private: secret },
      openai_chatgpt_moderation_metadata: [secret],
      opaque_flag: secret,
    },
    safety_buffering: true,
    extended_feature: secret,
  };
  const transcript = wire(opened, metadata, end());
  assert.throws(() => parseResponse(transcript, 'unused', 64), { message: 'UPSTREAM_REFUSED' });
  const observation = observeSubscription(transcript, model);
  assert.deepEqual(observation, {
    evidence: 'bound',
    terminal: 'completed',
    usage,
    usage_status: 'observed',
    metadata: {
      categories: [
        'ambiguous_turn_state',
        'effective_model_header',
        'moderation_metadata',
        'moderation_opaque',
        'safety_buffering_true',
        'safety_control_present',
        'turn_state_header',
        'unknown_envelope',
        'unknown_header',
        'unknown_metadata',
        'verification_metadata',
      ],
      unknown_names_sha256: {
        envelope: hash('extended_feature'),
        header: hash('x-unknown-header'),
        metadata: hash('opaque_flag'),
      },
    },
  });
  const published = JSON.stringify(observation);
  for (const value of [
    secret,
    id,
    model,
    'x-unknown-header',
    'opaque_flag',
    'extended_feature',
    hash(secret),
  ])
    assert.ok(!published.includes(value));
});

test('moderation evidence records nonexclusive shapes without inspecting private reports', () => {
  const privateKey = 'sensitive_provider_category';
  const privateReport = { [privateKey]: { results: [secret, id] } };
  const payload = {
    presentation: 'inline',
    prompt: privateReport,
    generation: privateReport,
    safety_block: privateReport,
    final_answer_moderation: { item_id: id, display: privateReport },
    [privateKey]: secret,
  };
  const metadata = { openai_chatgpt_moderation_metadata: payload };
  for (const frame of [
    { type: 'response.metadata', response_id: id, metadata },
    { type: 'response.in_progress', response_id: id, metadata },
    { type: 'response.in_progress', response: { id, model, metadata } },
  ]) {
    const result = observe(opened, frame, end());
    assert.equal(result.evidence, 'bound');
    assert.deepEqual(
      result.metadata.categories.filter((label) => label.startsWith('moderation_')),
      [
        'moderation_final_answer_marker',
        'moderation_generation_report',
        'moderation_metadata',
        'moderation_opaque',
        'moderation_presentation_inline',
        'moderation_prompt_report',
        'moderation_safety_block',
      ],
    );
    assert.deepEqual(result.metadata.unknown_names_sha256, {});
    for (const value of [privateKey, secret, id, hash(privateKey), hash(secret), hash(id)]) {
      assert.ok(!JSON.stringify(result).includes(value));
    }
  }
});

test('malformed, empty and misplaced moderation structures never acquire a recognized shape', () => {
  for (const value of [
    null,
    true,
    secret,
    [],
    {},
    { presentation: secret, prompt: [], safety_block: 0, final_answer_moderation: null },
    { nested: { presentation: 'inline', prompt: {} } },
  ]) {
    const frame = { type: 'response.metadata', metadata: { openai_chatgpt_moderation_metadata: value } };
    const result = observe(opened, frame, end());
    assert.deepEqual(
      result.metadata.categories.filter((label) => label.startsWith('moderation_')),
      ['moderation_metadata', 'moderation_opaque'],
    );
    assert.deepEqual(result.metadata.unknown_names_sha256, {});
  }
  const misplaced = {
    item: { metadata: { openai_chatgpt_moderation_metadata: { prompt: {} } }, safety_buffering: true },
  };
  const result = observe(opened, { type: 'response.in_progress', ...misplaced }, end());
  assert.deepEqual(result.metadata.categories, []);
});

test('buffering evidence distinguishes explicit values and a typed notification without copying its contents', () => {
  const typed = { use_cases: [secret], reasons: [secret], retry_model: secret };
  for (const [value, expected] of [
    [false, ['false']],
    [null, ['null']],
    [true, ['true']],
    [typed, ['notification']],
    [{ ...typed, private_extension: id }, ['notification', 'opaque']],
    [{ ...typed, reasons: [1] }, ['opaque']],
    [{ ...typed, use_cases: {} }, ['opaque']],
    [{ ...typed, retry_model: [] }, ['opaque']],
    [secret, ['opaque']],
  ]) {
    for (const fields of [{ safety_buffering: value }, { metadata: { safety_buffering: value } }]) {
      for (const frame of [
        { type: 'response.metadata', ...fields },
        { type: 'response.in_progress', response: { id, ...fields } },
      ]) {
        const result = observe(opened, frame, end());
        assert.deepEqual(
          result.metadata.categories.filter((label) => label.startsWith('safety_buffering_')),
          expected.map((suffix) => 'safety_buffering_' + suffix),
        );
        assert.deepEqual(result.metadata.unknown_names_sha256, {});
        assert.ok(!JSON.stringify(result).includes(secret));
      }
    }
  }
  const mixed = observe(
    opened,
    {
      type: 'response.metadata',
      safety_buffering: false,
      metadata: { type: 'safety_buffering', ...typed, private_extension: secret },
    },
    end(),
  );
  assert.deepEqual(
    mixed.metadata.categories.filter((label) => label.startsWith('safety_buffering_')),
    ['safety_buffering_false', 'safety_buffering_notification', 'safety_buffering_opaque'],
  );
  assert.deepEqual(mixed.metadata.unknown_names_sha256, {});
});

test('control shape belonging to another response cannot be attributed to this request', () => {
  const controls = {
    metadata: { openai_chatgpt_moderation_metadata: { prompt: {} } },
    safety_buffering: true,
  };
  for (const frame of [
    { type: 'response.metadata', response_id: 'foreign', ...controls },
    { type: 'response.in_progress', response_id: id, response: { id: 'foreign', ...controls } },
  ]) {
    const result = observe(opened, frame, end());
    assert.equal(result.evidence, 'unbound');
    assert.deepEqual(result.metadata.categories, []);
  }
});

for (const status of ['failed', 'incomplete']) {
  test('bound ' + status + ' retains valid usage independently of native completion', () => {
    const result = observe(opened, end(status, { input_tokens: 17, output_tokens: 0, total_tokens: 17 }));
    assert.equal(result.evidence, 'bound');
    assert.equal(result.terminal, status);
    assert.equal(result.usage_status, 'observed');
    assert.equal(result.usage.output_tokens, 0);
  });
}

test('native refusal or a tool-bearing output does not become native qualification', () => {
  const marker = { type: 'response.refusal.done', refusal: secret };
  const terminal = end();
  terminal.response.output = [{ type: 'function_call', name: secret, arguments: secret }];
  assert.throws(() => parseResponse(wire(opened, marker, terminal), 'unused', 64), {
    message: 'UPSTREAM_REFUSED',
  });
  const result = observe(opened, marker, terminal);
  assert.equal(result.evidence, 'bound');
  assert.equal(result.terminal, 'completed');
  assert.deepEqual(Object.keys(result).sort(), ['evidence', 'metadata', 'terminal', 'usage', 'usage_status']);
  assert.ok(!JSON.stringify(result).includes(secret));
});

for (const [name, events] of [
  ['no creation', [end()]],
  [
    'control before creation',
    [{ type: 'response.metadata', headers: { 'openai-model': 'other' } }, opened, end()],
  ],
  ['another response ID', [opened, { ...end(), response: { ...end().response, id: 'other' } }]],
  ['another terminal model', [opened, { ...end(), response: { ...end().response, model: 'other' } }]],
  [
    'disagrees about terminal status',
    [opened, { ...end(), response: { ...end().response, status: 'incomplete' } }],
  ],
  ['two creation events', [opened, opened, end()]],
  [
    'conflicting intermediate response ID',
    [opened, { type: 'response.metadata', response_id: 'other' }, end()],
  ],
  [
    'pre-creation metadata belongs to another response',
    [{ type: 'response.metadata', response_id: 'other' }, opened, end()],
  ],
  [
    'in-progress event names a different model',
    [opened, { type: 'response.in_progress', response: { id, model: 'other' } }, end()],
  ],
  [
    'effective model conflicts despite other metadata',
    [
      opened,
      { type: 'response.metadata', metadata: { opaque: secret }, headers: { 'OpenAI-Model': 'other' } },
      end(),
    ],
  ],
  [
    'metadata inside terminal response changes model',
    [opened, { ...end(), response: { ...end().response, headers: { 'x-openai-model': 'other' } } }],
  ],
]) {
  test('unbound evidence when ' + name, () => {
    const observation = observe(...events);
    assert.equal(observation.evidence, 'unbound');
    assert.equal(observation.terminal, null);
    assert.equal(observation.usage_status, 'unobserved');
    assert.equal(observation.usage, null);
  });
}

test('invalid, absent and measured zero counters stay distinct', () => {
  for (const denied of [
    { input_tokens: 1, output_tokens: 1, total_tokens: 1 },
    { input_tokens: 1, output_tokens: -1, total_tokens: 0 },
    { input_tokens: 1, output_tokens: true, total_tokens: 2 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { input_tokens: 1, output_tokens: 1 },
  ]) {
    const r = observe(opened, end('completed', denied));
    assert.equal(r.terminal, 'completed');
    assert.equal(r.usage_status, 'invalid');
    assert.equal(r.usage, null);
  }
  assert.equal(observe(opened, end('failed', null)).usage_status, 'absent');
  const zero = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  assert.deepEqual(observe(opened, end('failed', zero)).usage, zero);
  assert.equal(observe(opened).evidence, 'missing_terminal');
});

test('rejects ambiguous, extra, truncated and oversized transcripts even after a candidate terminal', () => {
  const complete = wire(opened, end());
  for (const transcript of [
    complete + 'data: {"type":"response.metadata","type":"response.created"}\n\n',
    wire(opened) + 'data: {"type":"response.completed","response":{"id":"r","id":"other"}}\n\n',
    complete + 'data: [DONE]\n\ndata: [DONE]\n\n',
    wire(opened, end(), end('failed')),
    complete.slice(0, -1),
    ' '.repeat(frameByteLimit + 1),
  ]) {
    const r = observeSubscription(transcript, model);
    assert.equal(r.evidence, 'invalid_stream');
    assert.equal(r.terminal, null);
    assert.equal(r.usage, null);
  }
});

test('bounds distinct unknown diagnostics and ignores arbitrary text and values as name candidates', () => {
  const event = {
    type: 'response.metadata',
    headers: { 'Human Private Text': secret, 'sk-secret': secret },
    metadata: { 'private field not a name': secret },
    'private text': secret,
  };
  const result = observe(opened, event, end());
  assert.deepEqual(result.metadata.unknown_names_sha256, {});
  const crowded = observe(
    opened,
    { type: 'response.metadata', headers: { 'X-First': secret, 'X-Second': secret } },
    end(),
  );
  assert.deepEqual(crowded.metadata.unknown_names_sha256, { header: hash('x-first') });
});

test('a fatal transport error precludes attributing a later terminal to this call', () => {
  const error = { type: 'error', code: 'server_error', message: secret };
  assert.equal(observe(error).evidence, 'stream_error');
  assert.equal(observe(opened, error).usage, null);
  for (const events of [
    [error, opened, end()],
    [opened, error, end()],
  ]) {
    const evidence = observe(...events);
    assert.equal(evidence.evidence, 'invalid_stream');
    assert.equal(evidence.usage, null);
  }
});

test('a native one-value model header may be metered, ambiguous values may not', () => {
  for (const headers of [{ 'openai-model': [model] }, { 'OpenAI-Model': model, 'x-openai-model': [model] }]) {
    assert.deepEqual(observe(opened, { type: 'response.metadata', headers }, end()).usage, usage);
  }
  for (const headers of [
    null,
    { 'openai-model': [model, model] },
    { 'OpenAI-Model': model, 'openai-model': model },
  ]) {
    assert.equal(observe(opened, { type: 'response.metadata', headers }, end()).evidence, 'unbound');
  }
});
