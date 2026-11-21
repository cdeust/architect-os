import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { record, readAgyTurn } from '../../src/application/agy-response.js';
Then('the imported Antigravity events must form one tool-free turn', () => {
  const model = 'gemini-test',
    id = 'one';
  const init = { event: 'init', conversation_id: id, init: { model, permission_mode: 'strict' } };
  const result = { conversation_id: id, num_turns: 1, status: 'SUCCESS', response: 'proposal' };
  const end = { event: 'result', result };
  const step = { conversation_id: id, state: 'DONE', step_type: 'agent_response' };
  const update = (details: object) => ({ event: 'step_update', step_update: details });
  const parse = (...rows: object[]) => readAgyTurn(rows.map((e) => JSON.stringify(e)).join('\n'), model);
  for (const value of [null, '', false, [], 1]) assert.throws(() => record(value), /invalid_object/);
  for (const [a, b] of [
    [end, end],
    [init, init],
  ])
    assert.throws(() => parse(a!, b!), /incomplete_stream/);
  for (const badId of [1, ''])
    assert.throws(
      () =>
        parse({ ...init, conversation_id: badId }, { ...end, result: { ...result, conversation_id: badId } }),
      /unexpected_invocation/,
    );
  for (const config of [{ model: 'wrong' }, { permission_mode: 'auto' }])
    assert.throws(() => parse({ ...init, init: { ...init.init, ...config } }, end), /unexpected_invocation/);
  for (const changed of [{ num_turns: 2 }, { conversation_id: 'another' }])
    assert.throws(() => parse(init, { ...end, result: { ...result, ...changed } }), /unexpected_invocation/);
  assert.throws(() => parse(init, { event: 'other' }, end), /unexpected_event/);
  for (const changed of [
    { conversation_id: 'other' },
    { state: 'ERROR' },
    { step_type: 'tool' },
    { tool_name: 'read_file' },
    { tool_info: {} },
    { subagent_info: {} },
  ])
    assert.throws(() => parse(init, update({ ...step, ...changed }), end), /unexpected_step/);
  for (const state of ['ACTIVE', 'DONE'])
    for (const step_type of ['user_input', 'checkpoint', 'agent_response'])
      assert.deepEqual(parse(init, update({ ...step, state, step_type }), end), result);
});
