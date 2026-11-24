import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, realpathSync } from 'node:fs';
import { once } from 'node:events';
import { relative, isAbsolute, sep } from 'node:path';
import { z } from 'zod';
import type { Builder, BuildRequest, BuildOutcome } from './builder.js';
import { measureSession } from './measure.js';
import {
  ResponsesProxy,
  type ProxyBudget,
  type ResponseReceipt,
  type CodexModel,
} from './responses-proxy.js';
import { withSbxVm, SbxInterrupted, checkSbxWorktree, type SbxPolicy, type SbxVm } from './sbx-vm.js';

const resultSchema = z.strictObject({
  kind: z.literal('result'),
  guest: z.strictObject({
    exitCode: z.int().nonnegative(),
    completed: z.boolean(),
    version: z.string(),
    uid: z.literal(65534),
  }),
});
const requestSchema = z.strictObject({
  kind: z.literal('request'),
  method: z.string(),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  token: z.string(),
  body: z.base64(),
});
async function* frames(stream: NodeJS.ReadableStream, limit: number) {
  let parts: Buffer[] = [];
  let bytes = 0;
  for await (const raw of stream) {
    const chunk = Buffer.from(raw);
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      bytes += end - start;
      if (bytes > limit) throw Error('SBX_FRAME_LIMIT');
      parts.push(chunk.subarray(start, end));
      if (newline === -1) break;
      try {
        yield JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(parts)));
      } catch {
        throw Error('SBX_FRAME_INVALID');
      }
      parts = [];
      bytes = 0;
      start = end + 1;
    }
  }
  if (bytes) throw Error('SBX_FRAME_INCOMPLETE');
}
async function nativeTurn(vm: SbxVm, proxy: ResponsesProxy, request: BuildRequest, policy: SbxPolicy) {
  const child = vm.pipes([
    '/usr/bin/env',
    '-i',
    'PATH=/usr/bin:/bin',
    '/usr/bin/python3',
    '-I',
    '/opt/aos-builder/guest.py',
    'build',
  ]);
  const exit = once(child, 'close').then(([code]) => code);
  void exit.catch(() => {});
  child.stdin.on('error', () => {});
  child.stderr.resume();
  const send = (data: unknown) =>
    new Promise<void>((done, fail) =>
      child.stdin.write(JSON.stringify(data) + '\n', (error) =>
        error ? fail(Error('SBX_PIPE_WRITE')) : done(),
      ),
    );
  try {
    await send({
      model: request.config.model,
      effort: request.config.effort,
      brief: request.brief,
      systemPrompt: request.systemPrompt,
      version: policy.clientVersion,
      digest: policy.clientSha256,
      token: proxy.token,
    });
    let guest: z.infer<typeof resultSchema>['guest'] | undefined;
    for await (const frame of frames(child.stdout, request.maxBytes)) {
      if (guest) throw Error('SBX_EXTRA_FRAME');
      if (frame?.kind === 'result') {
        const parsed = resultSchema.safeParse(frame);
        if (!parsed.success) throw Error('SBX_RESULT_INVALID');
        guest = parsed.data.guest;
        child.stdin.end();
        continue;
      }
      const r = requestSchema.safeParse(frame);
      if (!r.success) throw Error('SBX_FRAME_INVALID');
      const body = Buffer.from(r.data.body, 'base64');
      const receipt = await proxy.relay(
        { ...r.data, body },
        {
          start: (status, headers) => send({ kind: 'headers', status, headers }),
          write: (chunk) => send({ kind: 'chunk', data: Buffer.from(chunk).toString('base64') }),
        },
      );
      await send({ kind: 'end' });
      if (receipt.terminal !== 'completed') proxy.revoke();
    }
    if ((await exit) !== 0 || !guest || guest.version !== policy.clientVersion)
      throw Error('SBX_CLIENT_FAILED');
    return guest;
  } finally {
    child.stdin.destroy();
    child.kill('SIGKILL');
    await exit.catch(() => {});
  }
}
export interface SbxSettings {
  policy: SbxPolicy;
  archive: string;
  guestSource: string;
  budget: Pick<ProxyBudget, 'requests' | 'tokens' | 'bytes'>;
  access: (signal: AbortSignal) => Promise<string>;
  record: (r: ResponseReceipt) => void;
  upstream?: typeof fetch;
}
type NativeOutcome = {
  name: string;
  guest?: z.infer<typeof resultSchema>['guest'];
  stopped: boolean;
};
async function runNative(
  { policy, archive, guestSource }: SbxSettings,
  request: BuildRequest,
  proxy: ResponsesProxy,
): Promise<NativeOutcome> {
  try {
    const { name, result: guest } = await withSbxVm(
      request.worktree,
      policy,
      request.config.limitSeconds,
      async (vm) => {
        await vm.copy(archive, '/tmp/aos-client.tgz');
        await vm.copy(guestSource, '/tmp/aos-guest.py');
        await vm.setup(['/usr/bin/python3', '-I', '/tmp/aos-guest.py', 'install', policy.archiveSha512]);
        await vm.setup([
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
        ]);
        const revoke = () => proxy.revoke();
        vm.signal.addEventListener('abort', revoke, { once: true });
        try {
          return await nativeTurn(vm, proxy, request, policy);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('RESPONSES_')) return undefined;
          throw error;
        } finally {
          vm.signal.removeEventListener('abort', revoke);
        }
      },
    );

    return { name, guest, stopped: false };
  } catch (error) {
    if (error instanceof SbxInterrupted) return { name: error.vm, stopped: true };
    throw error;
  }
}
export class SbxBuilder implements Builder {
  constructor(
    private readonly settings: SbxSettings,
    private readonly run = runNative,
  ) {}
  async build(request: BuildRequest): Promise<BuildOutcome> {
    const { policy, archive, guestSource, budget, access, record, upstream } = this.settings;
    if (request.config.provider !== 'openai') throw Error('BUILDER_PROVIDER');
    const model = z.enum(['gpt-6.2-astra', 'gpt-6.2-sol']).parse(request.config.model) as CodexModel;
    for (const outside of [archive, guestSource, process.env.ARCHITECT_OS_RUNTIME_ROOT!]) {
      const path = relative(request.worktree, realpathSync(outside));
      if (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
        throw Error('SBX_HOST_ASSET_IN_WORKTREE');
    }
    checkSbxWorktree(request.worktree);
    if (!lstatSync(archive).isFile()) throw Error('SBX_ARCHIVE_REQUIRED');
    const hasher = createHash('sha512');
    for await (const chunk of createReadStream(archive)) hasher.update(chunk);
    if (hasher.digest('base64') !== policy.archiveSha512) throw Error('SBX_ARCHIVE_DIGEST');
    const receipts: ResponseReceipt[] = [];
    const proxy = new ResponsesProxy(
      model,
      { ...budget, seconds: request.config.limitSeconds },
      access,
      (r) => {
        record(r);
        receipts.push(r);
      },
      upstream,
    );
    const start = Date.now();
    try {
      const { name, guest, stopped } = await this.run(this.settings, request, proxy);
      const accepted =
        guest?.completed === true &&
        guest.exitCode === 0 &&
        receipts.length > 0 &&
        receipts.every((r) => r.terminal === 'completed');
      const inputTokens = receipts.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
        outputTokens = receipts.reduce((n, r) => n + (r.outputTokens ?? 0), 0);
      const evidence = {
        vm: name,
        removed: true,
        model,
        clientVersion: policy.clientVersion,
        clientSha256: policy.clientSha256,
        requests: receipts.length,
        inputTokens,
        outputTokens,
        guest,
      };
      const output = Buffer.from(JSON.stringify(evidence) + '\n');
      if (output.length > request.maxBytes) throw Error('BUILDER_OUTPUT_LIMIT');
      request.onOutput(output);
      return {
        provider: 'openai',
        exitCode: guest?.exitCode ?? 1,
        stopped,
        measure: {
          ...measureSession(''),
          completed: accepted,
          durationSeconds: Math.round((Date.now() - start) / 1000),
          answers: receipts.length,
          turns: receipts.length,
          models: [model],
          inputTokens,
          outputTokens,
        },
        client: { version: policy.clientVersion, sha256: policy.clientSha256 },
        receipts,
      };
    } finally {
      proxy.revoke();
    }
  }
}
