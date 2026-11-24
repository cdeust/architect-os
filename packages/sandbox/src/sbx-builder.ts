import { codexModelSchema } from './step-file.js';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, realpathSync } from 'node:fs';
import { once } from 'node:events';
import { relative, sep } from 'node:path';
import { z } from 'zod';
import type { Builder, BuildRequest, BuildOutcome } from './builder.js';
import { measureSession } from './measure.js';
import { withResponsesHttp, type SbxNetwork } from './responses-http.js';
import { ResponsesProxy, type ProxyBudget, type ResponseReceipt } from './responses-proxy.js';
import {
  guestEndpoints,
  withSbxVm,
  SbxInterrupted,
  checkSbxWorktree,
  type SbxPolicy,
  type SbxVm,
} from './sbx-vm.js';

const resultSchema = z.strictObject({
  kind: z.literal('result'),
  guest: z.strictObject({
    exitCode: z.int().nonnegative(),
    completed: z.boolean(),
    version: z.string(),
    uid: z.literal(65534),
    report: z.string(),
  }),
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
async function nativeTurn(
  vm: SbxVm,
  endpoint: { port: number; token: string },
  request: BuildRequest,
  policy: SbxPolicy,
  wireLimit: number,
) {
  const child = vm.pipes(['/usr/bin/python3', '-I', '/opt/aos-builder/guest.py', 'build']);
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
      ...guestEndpoints,
      port: endpoint.port,
      token: endpoint.token,
    });
    let guest: z.infer<typeof resultSchema>['guest'] | undefined;
    for await (const frame of frames(child.stdout, wireLimit)) {
      if (guest) throw Error('SBX_EXTRA_FRAME');
      const parsed = resultSchema.safeParse(frame);
      if (!parsed.success) throw Error('SBX_RESULT_INVALID');
      guest = parsed.data.guest;
      child.stdin.end();
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
  allowRegistry: boolean;
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
  { policy, archive, guestSource, budget, allowRegistry }: SbxSettings,
  request: BuildRequest,
  proxy: ResponsesProxy,
  vmRunner: typeof withSbxVm,
  network: SbxNetwork,
): Promise<NativeOutcome> {
  try {
    const { name, result: guest } = await vmRunner(
      request.worktree,
      policy,
      request.config.limitSeconds,
      { ...network, allowRegistry },
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
        vm.signal.addEventListener('abort', revoke);
        try {
          return await nativeTurn(
            vm,
            { port: network.port, token: proxy.token },
            request,
            policy,
            Math.min(64 * 1024 * 1024, budget.bytes),
          );
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
    private readonly vm = withSbxVm,
  ) {}
  async build(request: BuildRequest): Promise<BuildOutcome> {
    const { policy, archive, guestSource, budget, access, record, upstream } = this.settings;
    if (request.config.provider !== 'openai') throw Error('BUILDER_PROVIDER');
    const model = codexModelSchema.parse(request.config.model);
    for (const outside of [archive, guestSource, process.env.ARCHITECT_OS_RUNTIME_ROOT!]) {
      const path = relative(request.worktree, realpathSync(outside));
      if (path.split(sep)[0] !== '..') throw Error('SBX_HOST_ASSET_IN_WORKTREE');
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
    const {
      result: { name, guest, stopped },
      refused,
    } = await withResponsesHttp(proxy, budget.bytes, (port) =>
      runNative(this.settings, request, proxy, this.vm, port),
    );
    const accepted =
      !refused &&
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
      guest: guest && {
        exitCode: guest.exitCode,
        completed: guest.completed,
        version: guest.version,
        uid: guest.uid,
      },
    };
    const output = Buffer.from(JSON.stringify(evidence) + '\n');
    const report = guest?.report ?? '';
    if (output.length > request.maxBytes || Buffer.byteLength(report) > request.maxBytes)
      throw Error('BUILDER_OUTPUT_LIMIT');
    request.onOutput(output);
    return {
      provider: 'openai',
      exitCode: guest?.exitCode ?? 1,
      stopped,
      measure: {
        ...measureSession(''),
        report,
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
  }
}
