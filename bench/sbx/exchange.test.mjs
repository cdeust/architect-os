import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { exchangeFrames } from './exchange.mjs';

const initial = { model: 'fixture-model', prompt: 'fixed prompt' };
const response = { kind: 'response', body: 'fixed reply' };
const request = { kind: 'request', model: initial.model };
const receipt = { kind: 'receipt', text: 'vérifié avec "model": dans le texte' };

function guest(t, afterInitial, afterReply = '') {
  const program = `
    import assert from 'node:assert/strict';
    import { createInterface } from 'node:readline';
    const input = createInterface({input: process.stdin})[Symbol.asyncIterator]();
    const read = async () => JSON.parse((await input.next()).value);
    const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
    const request = ${JSON.stringify(request)};
    const receipt = ${JSON.stringify(receipt)};
    assert.deepEqual(await read(), ${JSON.stringify(initial)});
    ${afterInitial}
    ${afterReply ? `assert.deepEqual(await read(), ${JSON.stringify(response)}); ${afterReply}` : ''}
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: 'pipe' });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  return child;
}

test('one model-bound guest request receives one reply and returns its UTF-8 receipt after exit', async (t) => {
  const child = guest(
    t,
    'send(request);',
    `const bytes = Buffer.from(JSON.stringify(receipt) + '\\n');
     const cut = bytes.indexOf(0xc3) + 1;
     process.stdout.write(bytes.subarray(0, cut));
     await new Promise(setImmediate);
     process.stdout.write(bytes.subarray(cut));`,
  );
  let calls = 0;
  const result = await exchangeFrames(
    child,
    initial,
    (frame, signal) => {
      calls++;
      assert.deepEqual(frame, request);
      assert.equal(signal.aborted, false);
      return response;
    },
    5000,
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, receipt);
  assert.equal(child.exitCode, 0);
});

for (const [title, first] of [
  ['another model', "send({...request, model: 'other'});"],
  ['an unexpected guest parameter', "send({...request, url: 'untrusted'});"],
  ['a receipt before any request', 'send(receipt);'],
  ['two request frames in one write', "process.stdout.write((JSON.stringify(request) + '\\n').repeat(2));"],
  [
    'a duplicate model field',
    `process.stdout.write('{"kind":"request","model":"other","model":"fixture-model"}\\n');`,
  ],
  ['an oversized stderr', 'process.stderr.write(Buffer.alloc(1024 * 1024 + 1, 65));'],
  ['an oversized stdout', 'process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 65));'],
  ['malformed UTF-8', 'process.stdout.write(Buffer.of(0xc0, 0xae, 10));'],
]) {
  test('refuses ' + title + ' before invoking the host', async (t) => {
    let calls = 0;
    await assert.rejects(
      exchangeFrames(
        guest(t, first),
        initial,
        () => {
          calls++;
          return response;
        },
        5000,
      ),
      /SBX_EXCHANGE_(PROTOCOL|OUTPUT_LIMIT)/,
    );
    assert.equal(calls, 0);
  });
}

for (const [title, last] of [
  ['a duplicate request after the reply', 'send(request);'],
  ['a duplicate receipt', 'send(receipt); send(receipt);'],
  [
    'a duplicate field in a nested receipt',
    `process.stdout.write('{"kind":"receipt","usage":{"count":1,"count":2}}\\n');`,
  ],
  ['a truncated receipt', 'process.stdout.write(JSON.stringify(receipt));'],
  ['a trailing partial frame', "send(receipt); process.stdout.write('{');"],
  ['a client failure after the receipt', 'send(receipt); process.exitCode = 7;'],
]) {
  test('refuses ' + title, async (t) => {
    await assert.rejects(
      exchangeFrames(guest(t, 'send(request);', last), initial, () => response, 5000),
      /SBX_EXCHANGE_(PROTOCOL|INCOMPLETE|EXIT)/,
    );
  });
}

test('guest interruption aborts the outstanding host request', async (t) => {
  const child = guest(t, 'send(request);');
  let aborted = false;
  const result = exchangeFrames(
    child,
    initial,
    (_frame, signal) => {
      child.kill('SIGTERM');
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(Error('sensitive provider diagnostic'));
          },
          { once: true },
        );
      });
    },
    5000,
  );
  await assert.rejects(result, /^(Error: SBX_EXCHANGE_(EXIT|INCOMPLETE))$/);
  assert.equal(aborted, true);
});

test('a deadline aborts a pending host callback and reaps the guest', async (t) => {
  const child = guest(t, 'send(request);');
  let signal;
  const result = exchangeFrames(
    child,
    initial,
    (_frame, pendingSignal) => {
      signal = pendingSignal;
      return new Promise(() => {});
    },
    2000,
  );
  await assert.rejects(result, { message: 'SBX_EXCHANGE_TIMEOUT' });
  assert.equal(signal.aborted, true);
  assert.equal(child.signalCode, 'SIGKILL');
});

test('deadline reaps a silent child', async (t) => {
  const child = guest(t, 'setInterval(() => {}, 1000);');
  await assert.rejects(
    exchangeFrames(child, initial, () => response, 100),
    /SBX_EXCHANGE_TIMEOUT/,
  );
  assert.equal(child.signalCode, 'SIGKILL');
});

test('host errors do not relay provider diagnostics to callers', async (t) => {
  await assert.rejects(
    exchangeFrames(
      guest(t, 'send(request);'),
      initial,
      () => {
        throw Error('private');
      },
      5000,
    ),
    { message: 'SBX_EXCHANGE_REPLY' },
  );
});

test('extra fields in either host message are refused', async (t) => {
  await assert.rejects(
    exchangeFrames(guest(t, ''), { ...initial, metadata: 'private' }, () => response, 5000),
    { message: 'SBX_EXCHANGE_INITIAL' },
  );
  await assert.rejects(
    exchangeFrames(guest(t, 'send(request);'), initial, () => ({ ...response, metadata: 'private' }), 5000),
    { message: 'SBX_EXCHANGE_REPLY' },
  );
});
