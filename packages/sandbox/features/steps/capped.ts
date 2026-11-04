import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readCapped } from '../../src/capped.js';
import { Then, When, stored } from './helpers.js';

type Outcome = { text: string } | { error: Error };

const read = async (world: { state: Record<string, unknown> }, stream: PassThrough, bound: number) => {
  world.state['stream'] = stream;
  world.state['capped'] = await readCapped(stream, bound).then(
    (text): Outcome => ({ text }),
    (error: Error): Outcome => ({ error }),
  );
};

When(
  'I read capped at {int} a stream of the chunks {string}',
  async function (bound: number, chunks: string) {
    const stream = new PassThrough();
    const done = read(this, stream, bound);
    for (const chunk of chunks.split(', ')) stream.write(Buffer.from(chunk));
    stream.end();
    await done;
  },
);

When(
  'I read capped at {int} a stream whose two chunks split the character {string}',
  async function (bound: number, character: string) {
    const stream = new PassThrough();
    const done = read(this, stream, bound);
    const bytes = Buffer.from(character);
    stream.write(bytes.subarray(0, 1));
    stream.end(bytes.subarray(1));
    await done;
  },
);

When(
  'I read capped at {int} a stream that fails with {string}',
  async function (bound: number, message: string) {
    const stream = new PassThrough();
    const done = read(this, stream, bound);
    stream.destroy(new Error(message));
    await done;
  },
);

Then('the capped read gives {string}', function (text: string) {
  assert.deepEqual(stored<Outcome>(this, 'capped'), { text });
});

Then('the capped read is refused with {string}', function (message: string) {
  const outcome = stored<Outcome>(this, 'capped');
  assert.ok('error' in outcome, 'the read was not refused');
  assert.equal(outcome.error.message, message);
});

Then('the capped stream is destroyed', function () {
  assert.equal(stored<PassThrough>(this, 'stream').destroyed, true);
});
