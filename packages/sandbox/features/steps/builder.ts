import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Given, Then } from '@cucumber/cucumber';
import {
  ClaudeBuilder,
  InMemoryBuilder,
  type BuildRequest,
  type Builder,
  type BuildOutcome,
} from '../../src/builder.js';
import { measureSession } from '../../src/measure.js';

interface Contract {
  builder: Builder;
  request: BuildRequest;
  output: Buffer[];
  stream: Buffer;
  expected: BuildOutcome;
}

Given('the {string} builder receives a {string} native session', function (adapter: string, session: string) {
  const stopped = session === 'stopped';
  const stream = readFileSync(
    new URL('../../fixtures/' + (stopped ? 'session-killed' : 'build-exact') + '.jsonl', import.meta.url),
  );
  const output: Buffer[] = [];
  const request: BuildRequest = {
    config: { model: 'example', effort: 'high', limitSeconds: 31 },
    worktree: '/work',
    systemPrompt: 'trusted',
    brief: 'task',
    maxBytes: stream.length,
    onOutput: (chunk) => output.push(Buffer.from(chunk)),
  };
  const expected: BuildOutcome = {
    provider: 'anthropic',
    exitCode: stopped ? 7 : 0,
    stopped,
    measure: measureSession(stream.toString()),
  };
  const builder =
    adapter === 'memory'
      ? new InMemoryBuilder(expected, stream)
      : new ClaudeBuilder(async (tool, argv, brief, limit, write) => {
          assert.equal(tool, 'code.json');
          assert.deepEqual(argv, [
            '-p',
            '--verbose',
            '--output-format',
            'stream-json',
            '--model',
            'example',
            '--effort',
            'high',
          ]);
          assert.equal(brief, 'task');
          assert.equal(limit, 31);
          write(stream.subarray(0, 1));
          write(stream.subarray(1));
          return { exitCode: expected.exitCode, stopped };
        });
  this.state['builderContract'] = { builder, request, output, stream, expected } satisfies Contract;
});
Then('the Builder port returns the native outcome and usage', async function () {
  const { builder, request, expected, output, stream } = this.state['builderContract'] as Contract;
  assert.deepEqual(await builder.build(request), expected);
  assert.deepEqual(Buffer.concat(output), stream);
});
Then('the Builder port refuses a stream one byte over its limit', async function () {
  const { builder, request, output, stream } = this.state['builderContract'] as Contract;
  output.length = 0;
  await assert.rejects(builder.build({ ...request, maxBytes: stream.length - 1 }), {
    message: 'BUILDER_OUTPUT_LIMIT',
  });
  assert.ok(Buffer.concat(output).length < stream.length);
});
