import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { SbxBuilder } from '../../src/sbx-builder.js';
import { PKG } from '../../src/code-tool.js';
import { After, Given, Then } from '@cucumber/cucumber';
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
  if (adapter === 'Codex') {
    const root = mkdtempSync(join(tmpdir(), 'builder-contract-'));
    this.state['builderFixture'] = root;
    const worktree = join(root, 'work'),
      archive = join(root, 'client');
    mkdirSync(worktree);
    writeFileSync(archive, 'fixture');
    const policy = JSON.parse(readFileSync(join(PKG, 'sbx/isolation.json'), 'utf8'));
    policy.archiveSha512 = createHash('sha512').update('fixture').digest('base64');
    const model = 'gpt-6.2-sol';
    const guest = stopped
      ? undefined
      : { exitCode: 0, completed: true, version: policy.clientVersion, uid: 65534 as const };
    const terminal = {
      type: 'response.completed',
      response: { model, status: 'completed', usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } },
    };
    const receipt = { model, request: 1, terminal: 'completed', inputTokens: 5, outputTokens: 2 } as const;
    const output: Buffer[] = [];
    const stream = Buffer.from(
      JSON.stringify({
        vm: 'fixture-vm',
        removed: true,
        model,
        clientVersion: policy.clientVersion,
        clientSha256: policy.clientSha256,
        requests: 1,
        inputTokens: 5,
        outputTokens: 2,
        guest,
      }) + '\n',
    );
    const request: BuildRequest = {
      config: { provider: 'openai', model, effort: 'high', limitSeconds: 31 },
      worktree,
      systemPrompt: 'trusted',
      brief: 'task',
      maxBytes: stream.length,
      onOutput: (b) => output.push(Buffer.from(b)),
    };
    const expected: BuildOutcome = {
      provider: 'openai',
      exitCode: stopped ? 1 : 0,
      stopped,
      client: { version: policy.clientVersion, sha256: policy.clientSha256 },
      receipts: [receipt],
      measure: {
        ...measureSession(''),
        completed: !stopped,
        durationSeconds: 0,
        answers: 1,
        turns: 1,
        models: [model],
        inputTokens: 5,
        outputTokens: 2,
      },
    };
    const builder = new SbxBuilder(
      {
        policy,
        archive,
        guestSource: join(PKG, 'sbx/codex-guest.py'),
        budget: { requests: 1, bytes: 4096, tokens: 7 },
        access: async () => 'fixture',
        record: (r) => assert.deepEqual(r, receipt),
        upstream: async () =>
          new Response('data: ' + JSON.stringify(terminal) + '\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      },
      async (_s, _r, proxy) => {
        await proxy.relay(
          {
            method: 'POST',
            path: '/v1/responses',
            token: proxy.token,
            headers: {},
            body: Buffer.from(JSON.stringify({ model, store: false, stream: true, input: [] })),
          },
          { start: async () => {}, write: async () => {} },
        );
        return { name: 'fixture-vm', guest, stopped };
      },
    );
    this.state['builderContract'] = { builder, request, output, stream, expected } satisfies Contract;
    return;
  }
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

After(function () {
  const root = this.state['builderFixture'];
  if (typeof root === 'string') rmSync(root, { recursive: true, force: true });
});
Then('a Claude Builder rejects a Codex session before launch', async function () {
  const builder = new ClaudeBuilder(async () => assert.fail('unadmitted provider started'));
  await assert.rejects(
    builder.build({
      config: { provider: 'openai', model: 'gpt-6.2-astra', effort: 'high', limitSeconds: 1 },
      systemPrompt: '',
      brief: '',
      worktree: '/',
      maxBytes: 1,
      onOutput: () => {},
    }),
    { message: 'BUILDER_PROVIDER' },
  );
});
