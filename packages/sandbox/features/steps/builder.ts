import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mock } from 'node:test';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { SbxInterrupted, type withSbxVm, type SbxPolicy } from '../../src/sbx-vm.js';
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

function fixtureVm(
  request: BuildRequest,
  policy: SbxPolicy,
  archive: string,
  kind: string,
): typeof withSbxVm {
  return async (work, pins, deadline, use) => {
    assert.equal(work, request.worktree);
    assert.deepEqual(pins, policy);
    assert.equal(deadline, request.config.limitSeconds);
    const name = 'fixture-vm',
      controller = new AbortController();
    const actions: unknown[] = [];
    let closedInput: PassThrough | undefined;
    let killed = false;
    const result = await use({
      name,
      signal: controller.signal,
      copy: async (...args) => {
        actions.push(args);
      },
      setup: async (args) => {
        actions.push(args);
      },
      pipes: (args) => {
        assert.deepEqual(actions, [
          [archive, '/tmp/aos-client.tgz'],
          [join(PKG, 'sbx/codex-guest.py'), '/tmp/aos-guest.py'],
          ['/usr/bin/python3', '-I', '/tmp/aos-guest.py', 'install', policy.archiveSha512],
          [
            '/usr/bin/install',
            '-o',
            '0',
            '-g',
            '0',
            '-m',
            '0444',
            '--',
            '/tmp/aos-guest.py',
            '/opt/aos-builder/guest.py',
          ],
        ]);
        assert.deepEqual(args, [
          '/usr/bin/env',
          '-i',
          'PATH=/usr/bin:/bin',
          '/usr/bin/python3',
          '-I',
          '/opt/aos-builder/guest.py',
          'build',
        ]);
        const stdin = new PassThrough(),
          stdout = new PassThrough(),
          stderr = new PassThrough(),
          emitter = new EventEmitter();
        closedInput = stdin;
        if (kind === 'broken pipe') stdin.destroy();
        let closed = false;
        const close = (code = 0) => {
          if (!closed) {
            closed = true;
            stdout.end();
            queueMicrotask(() => emitter.emit('close', code));
          }
        };
        const send = (o: unknown) => stdout.write(JSON.stringify(o) + '\n');
        const guest = {
          kind: 'result',
          guest: {
            report:
              kind === 'long report'
                ? 'é'.repeat(600)
                : kind === 'boundary report'
                  ? 'é'.repeat(512)
                  : 'fixture report',
            exitCode: kind === 'nonzero' ? 9 : 0,
            completed: kind !== 'no completion',
            version: kind === 'version' ? 'unexpected' : policy.clientVersion,
            uid: kind === 'root' ? 0 : 65534,
          },
        };
        let token = '',
          phase = 0;
        let repeat: unknown;
        stdin.on('data', (buf: Buffer) => {
          assert.equal(buf.at(-1), 10);
          assert.ok(stderr.readableFlowing);
          assert.ok(stdin.listenerCount('error') > 0);
          const f = JSON.parse(buf.toString());
          if (!token) {
            token = f.token;
            assert.match(token, /^[a-zA-Z0-9_-]{43}$/);
            assert.deepEqual(f, {
              model: request.config.model,
              effort: request.config.effort,
              brief: request.brief,
              systemPrompt: request.systemPrompt,
              version: policy.clientVersion,
              digest: policy.clientSha256,
              token,
            });
            const frame = {
              kind: 'request',
              method: 'POST',
              path: '/v1/responses',
              headers: {},
              token,
              body: Buffer.from(
                JSON.stringify({ model: request.config.model, stream: true, store: false, input: [] }),
              ).toString('base64'),
            };
            if (kind === 'empty') {
              close();
              return;
            }
            if (kind === 'oversize') {
              stdout.write('x'.repeat(4097));
              return;
            }
            if (kind === 'invalid UTF8') {
              const raw = Buffer.from(
                JSON.stringify({ ...frame, headers: { 'x-unused': 'placeholder' } }) + '\n',
              );
              raw[raw.indexOf('placeholder')] = 255;
              stdout.write(raw);
              return;
            }
            if (kind === 'null frame') {
              send(null);
              return;
            }
            if (kind === 'frame boundary') {
              stdout.write(JSON.stringify(frame).padEnd(4096, ' ') + '\n');
              return;
            }
            if (kind === 'invalid JSON') {
              stdout.write('bad\n');
              return;
            }
            if (kind === 'cut frame') {
              stdout.write('{');
              close();
              return;
            }
            if (kind === 'extra field') {
              send({ ...guest, removed: true });
              return;
            }
            if (kind === 'bad request') {
              send({ ...frame, body: '%%%' });
              return;
            }
            if (kind === 'no requests') {
              send(guest);
              close();
              return;
            }
            if (kind === 'bad token') frame.token = 'bad';
            if (kind === 'abort during run') controller.abort();
            if (kind === 'mixed terminals') repeat = frame;
            const msg = JSON.stringify(frame) + '\n';
            stdout.write(msg.slice(0, 5));
            stdout.write(msg.slice(5));
            return;
          }
          if (f.kind === 'headers') {
            assert.equal(phase++, 0);
            assert.deepEqual(f, {
              kind: 'headers',
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            });
            return;
          }
          if (f.kind === 'chunk') {
            assert.equal(phase++, 1);
            assert.ok(Buffer.from(f.data, 'base64').toString().includes('response.'));
            return;
          }
          assert.equal(phase, 2);
          assert.deepEqual(f, { kind: 'end' });
          if (repeat) {
            phase = 0;
            send(repeat);
            repeat = undefined;
            return;
          }
          send(guest);
          if (kind === 'extra frame') send(guest);
          close(kind === 'bad child exit' ? 1 : 0);
        });
        return Object.assign(emitter, {
          stdin,
          stdout,
          stderr,
          kill: (sig: string) => {
            assert.equal(sig, 'SIGKILL');
            killed = true;
            close();
            return true;
          },
        }) as unknown as ChildProcessWithoutNullStreams;
      },
    });
    assert.ok(killed);
    assert.ok(closedInput?.destroyed);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    if (kind === 'completed' || kind === 'stopped') assert.ok(closedInput.writableEnded);
    if (kind === 'stopped' || controller.signal.aborted) throw new SbxInterrupted(name);
    return { name, result };
  };
}
Given('the {string} builder receives a {string} native session', function (adapter: string, session: string) {
  const stopped = session === 'stopped';
  if (adapter === 'Codex') {
    const root = mkdtempSync(join(tmpdir(), 'builder-contract-'));
    this.state['builderFixture'] = root;
    this.state['fixtureKind'] = session;
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
    const terminalStatus = session === 'failed terminal' ? 'failed' : 'completed';
    const terminal = {
      type: 'response.' + terminalStatus,
      response: {
        model,
        status: terminalStatus,
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
      },
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
        report: stopped ? '' : 'fixture report',
        completed: !stopped,
        durationSeconds: 0,
        answers: 1,
        turns: 1,
        models: [model],
        inputTokens: 5,
        outputTokens: 2,
      },
    };
    if (session === 'hardlink') linkSync(archive, join(worktree, 'alias'));
    if (session === 'wrong digest') policy.archiveSha512 = '0'.repeat(88);
    if (session === 'archive symlink') symlinkSync(archive, join(root, 'alias'));
    if (session === 'archive inside') writeFileSync(join(worktree, 'archive'), 'fixture');
    const observed: AbortSignal[] = [];
    let journalCount = 0,
      now = Date.now();
    if (session === 'elapsed') this.state['fixtureClock'] = () => now;
    const builder = new SbxBuilder(
      {
        policy,
        archive:
          session === 'archive symlink'
            ? join(root, 'alias')
            : session === 'archive inside'
              ? join(worktree, 'archive')
              : archive,
        guestSource: join(PKG, 'sbx/codex-guest.py'),
        budget: { requests: 2, bytes: 4096, tokens: 14 },
        access: async (signal) => {
          observed.push(signal);
          return 'fixture';
        },
        record: (r) => {
          journalCount++;
          assert.deepEqual(r, {
            ...receipt,
            request: r.request,
            terminal: session === 'mixed terminals' && r.request === 2 ? 'failed' : terminalStatus,
          });
        },
        upstream: async () => {
          now += 550;
          const failed = session === 'mixed terminals' && observed.length === 2;
          return new Response(
            'data: ' +
              JSON.stringify(
                failed
                  ? { type: 'response.failed', response: { ...terminal.response, status: 'failed' } }
                  : terminal,
              ) +
              '\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          );
        },
      },
      fixtureVm(request, policy, archive, session),
    );
    this.state['builderContract'] = { builder, request, output, stream, expected } satisfies Contract;
    this.state['verifyRun'] = () => {
      assert.equal(journalCount, observed.length);
      assert.ok(observed.every((s) => s.aborted));
      if (session === 'abort during run') assert.equal(observed.length, 0);
      if (session === 'mixed terminals') assert.equal(journalCount, 2);
    };
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
  (this.state['verifyRun'] as (() => void) | undefined)?.();
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

Then('the native pipe run finishes with {string}', async function (outcome: string) {
  const { builder, request } = this.state['builderContract'] as Contract;
  const clock = this.state['fixtureClock'] as (() => number) | undefined;
  const patch = clock ? mock.method(Date, 'now', clock) : undefined;
  try {
    const attempt = builder.build({
      ...request,
      ...(outcome === 'BUILDER_PROVIDER'
        ? { config: { model: 'claude-opus-5-5', effort: 'high' as const, limitSeconds: 10 } }
        : {}),
      maxBytes:
        outcome === 'BUILDER_OUTPUT_LIMIT' || this.state['fixtureKind'] === 'boundary report' ? 1024 : 8192,
    });
    if (outcome.startsWith('SBX_') || outcome.startsWith('BUILDER_'))
      await assert.rejects(attempt, { message: outcome });
    else {
      const result = await attempt;
      assert.equal(result.measure.completed, ['accepted', 'elapsed'].includes(outcome));
      assert.equal(result.stopped, outcome === 'stopped');
      if (outcome === 'elapsed') assert.equal(result.measure.durationSeconds, 1);
    }
    (this.state['verifyRun'] as () => void)();
  } finally {
    patch?.mock.restore();
  }
});
