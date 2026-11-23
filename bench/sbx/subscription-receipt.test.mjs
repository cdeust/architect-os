import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { clientSha256, clientVersion } from './codex-client.mjs';
import { readSubscriptionWorkerFrames, verifyNativeSubscriptionResult } from './subscription-receipt.mjs';
import { frameByteLimit } from './json-frame.mjs';
import { fixtureResponse, model } from './text-response.mjs';

const challenge = 'AOS-8ec061f1-6e29-4968-a070-21c072110c57';
const prompt = 'Reply with exactly this value: ' + challenge;
const usage = { input_tokens: 8, output_tokens: 4 };
const receipt = {
  route: 'host_broker',
  model,
  client_version: clientVersion,
  client_sha256: clientSha256,
  native_exit: 0,
  terminal: 'completed',
  requests: 1,
  provider_requests: null,
  usage,
  cost_usd: null,
  workspace_empty_after_shutdown: true,
  challenge_sha256: createHash('sha256').update(challenge).digest('hex'),
};

test('the private operator parses exactly two bounded, unique-key worker frames', async () => {
  async function read(chunks, delivered) {
    for await (const frame of readSubscriptionWorkerFrames(chunks.map((c) => Buffer.from(c))))
      delivered.push(frame);
  }
  const delivered = [];
  await read(['{"k', 'ind":"request"}\n', '{"kind":"result"}\n'], delivered);
  assert.deepEqual(delivered, [{ kind: 'request' }, { kind: 'result' }]);
  for (const bad of [
    ['{"kind":0,"k\\u0069nd":1}\n'],
    ['{}\n{}\n'],
    ['{}\nx'],
    [Buffer.from([255, 10])],
    [Buffer.alloc(frameByteLimit + 1)],
  ]) {
    const seen = [];
    await assert.rejects(read(bad, seen));
    assert.deepEqual(seen, []);
  }
  for (const bad of [
    ['{}\n'],
    ['{}\n', '{}'],
    ['{}\n', '{}\nextra'],
    ['{}\n', '{}\n{}\n'],
    ['{}\n', '{"nested":{"x":0,"x":1}}\n'],
  ]) {
    await assert.rejects(read(bad, []));
  }
});

test('the account operator binds the whole native receipt to its own accepted response', () => {
  const plain = fixtureResponse(challenge);
  const inline = { ...plain, moderation_presentation: 'inline' };
  const frame = { kind: 'result', result: receipt };
  const served = { kind: 'result', result: { ...receipt, served_moderation_presentation: 'inline' } };
  assert.deepEqual(verifyNativeSubscriptionResult(frame, prompt, plain), usage);
  assert.deepEqual(verifyNativeSubscriptionResult(served, prompt, inline), usage);
  for (const [accepted, proof] of [
    [plain, frame],
    [inline, served],
  ]) {
    const marked = { ...accepted, reasoning_included: true };
    const servedHeader = { kind: 'result', result: { ...proof.result, served_reasoning_included: true } };
    assert.deepEqual(verifyNativeSubscriptionResult(servedHeader, prompt, marked), usage);
    assert.throws(() => verifyNativeSubscriptionResult(proof, prompt, marked), /RECEIPT_MISMATCH/);
    assert.throws(() => verifyNativeSubscriptionResult(servedHeader, prompt, accepted), /RECEIPT_MISMATCH/);
    for (const value of [false, 'true', null, 1]) {
      assert.throws(
        () =>
          verifyNativeSubscriptionResult(
            { kind: 'result', result: { ...proof.result, served_reasoning_included: value } },
            prompt,
            marked,
          ),
        /RECEIPT_MISMATCH/,
      );
    }
  }
  for (const [input, accepted] of [
    [frame, inline],
    [served, plain],
    [frame, fixtureResponse(challenge + 'extra')],
    [frame, { ...plain, metadata: {} }],
    [{ ...frame, extra: true }, plain],
  ])
    assert.throws(() => verifyNativeSubscriptionResult(input, prompt, accepted));
  for (const change of [
    { workspace_empty_after_shutdown: false },
    { usage: { ...usage, output_tokens: 3 } },
    { client_sha256: 'other' },
    { client_version: 'other' },
    { model: 'other' },
    { requests: 2 },
    { provider_requests: 1 },
    { cost_usd: 0 },
    { native_exit: 1 },
    { route: 'fixture' },
    { terminal: 'failed' },
    { served_moderation_presentation: 'other' },
  ])
    assert.throws(() =>
      verifyNativeSubscriptionResult({ ...frame, result: { ...receipt, ...change } }, prompt, plain),
    );
  const nextChallenge = 'AOS-f19d1c0b-2a38-44be-876c-2bb528e54725';
  assert.throws(
    () =>
      verifyNativeSubscriptionResult(served, 'Reply with exactly this value: ' + nextChallenge, {
        ...fixtureResponse(nextChallenge),
        moderation_presentation: 'inline',
      }),
    /RECEIPT_MISMATCH/,
  );
});
