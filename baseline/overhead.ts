// Measure A, the overhead of the platform structure (baseline/README.md, protocol pre-registered): `npm run
// baseline:overhead`. A fake model on the loopback answers every recall with the same script, so no token is spent;
// what is timed is the structure: the isolation of a process, then a recall in process, under srt with its module
// warm, and under srt on a fresh platform. One JSON line per measure in baseline/results/overhead-<date>.jsonl, after
// a header line describing the host. OVERHEAD_N changes the number of measures per configuration (30 by default).
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { arch, cpus, release, type } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SrtSandboxRunner } from '@architect-os/sandbox';
import { startFakeModel, type ModelTurn } from '../features/support/fake-model.js';
import { serveInProcess } from '../features/support/inproc-worker.js';
import { ROOT, runnerOptions, startSrtPlatform, type SrtPlatform } from '../features/support/srt-platform.js';

const N = Number(process.env['OVERHEAD_N'] ?? 30);
const WARMUP = 2;
/** The image of iso-docker, pinned by digest: the Node 26 of the worker image of v2 (services/memory/worker/Dockerfile). */
const IMAGE = 'node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9';
const MEMORY = 'alpha fact';
const OUTPUT = { summary: 'one fact', memories: [] };
const SCRIPT: ModelTurn[] = [
  { tool: 'mcp__platform__memory_search', input: { query: 'alpha', limit: 5 } },
  { tool: 'StructuredOutput', input: OUTPUT },
];

const out = join(
  ROOT,
  'baseline',
  'results',
  `overhead-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.jsonl`,
);
mkdirSync(join(ROOT, 'baseline', 'results'), { recursive: true });
const write = (line: unknown) => appendFileSync(out, `${JSON.stringify(line)}\n`);

const version = (pkg: string, field = 'version'): string =>
  String(
    (
      JSON.parse(readFileSync(join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >
    )[field],
  );
const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });

write({
  header: true,
  at: new Date().toISOString(),
  os: `${type()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model,
  cpus: cpus().length,
  node: process.version,
  srt: version('@anthropic-ai/sandbox-runtime'),
  docker: docker.status === 0 ? docker.stdout.trim() : null,
  claudeCode: version('@anthropic-ai/claude-agent-sdk', 'claudeCodeVersion'),
  n: N,
  warmup: WARMUP,
});

/** Runs `command` to its end; resolves its exit code. */
const exitOf = (command: string, args: string[]) =>
  new Promise<number | null>((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code));
  });

const srt = new SrtSandboxRunner(runnerOptions({ callbackPort: '9' }));
const isolation: Record<string, () => Promise<boolean>> = {
  'iso-none': async () => (await exitOf(process.execPath, ['-e', '0'])) === 0,
  'iso-srt': async () => {
    const sandbox = await srt.start({ profile: 'module', cwd: ROOT, command: ['node', '-e', '0'] });
    sandbox.stdin.end();
    sandbox.stdout.resume();
    sandbox.stderr.resume();
    return (await sandbox.exited).code === 0;
  },
  'iso-docker': async () =>
    (await exitOf('docker', ['run', '--rm', '--network', 'none', IMAGE, 'node', '-e', '0'])) === 0,
};

/** Whether a recall answered ok with the scripted data and the inserted memory as its evidence. */
const okRecall = (
  result: { status?: unknown; data?: unknown; evidence?: unknown },
  memory: string,
  excerpt = MEMORY,
) =>
  result.status === 'ok' &&
  JSON.stringify(result.data) === JSON.stringify(OUTPUT) &&
  JSON.stringify(result.evidence) === JSON.stringify([{ source: 'memory', ref: memory, excerpt }]);

const model = await startFakeModel(SCRIPT, { cycle: true });
const warm = await startSrtPlatform(MEMORY, SCRIPT, { cycle: true });

async function recallOn(platform: SrtPlatform): Promise<{ ms: number; ok: boolean }> {
  const { task } = await platform.router.open('overhead-owner', 'owner');
  const started = performance.now();
  const answer = await platform.router.call({ task }, 'memory.recall', { query: 'alpha' });
  const ms = performance.now() - started;
  await platform.router.complete(task);
  return { ms, ok: !answer.isError && okRecall(answer.structured ?? {}, platform.memory) };
}

const recall: Record<string, () => Promise<{ ms: number; ok: boolean }>> = {
  'recall-inproc': async () => {
    const started = performance.now();
    const run = await serveInProcess({
      modelUrl: model.url,
      tool: 'recall',
      input: { query: 'alpha' },
      turns: 4,
      relay: async () => ({
        text: JSON.stringify([{ id: 'm1', content: MEMORY }]),
        structured: undefined,
        isError: false,
      }),
    });
    const ms = performance.now() - started;
    run.remove();
    return { ms, ok: run.exit === 0 && okRecall(run.session.result(), 'm1') };
  },
  'recall-srt-warm': () => recallOn(warm),
  'recall-srt-cold': async () => {
    const fresh = await startSrtPlatform(MEMORY, SCRIPT, { cycle: true });
    try {
      return await recallOn(fresh);
    } finally {
      await fresh.close();
    }
  },
};

/** The configurations of one family, their order rotated at each repetition. */
async function family(configs: Record<string, () => Promise<{ ms: number; ok: boolean } | boolean>>) {
  const names = Object.keys(configs);
  for (let i = 0; i < WARMUP + N; i++) {
    for (let k = 0; k < names.length; k++) {
      const name = names[(i + k) % names.length]!;
      const started = performance.now();
      const outcome = await configs[name]!();
      const ms = performance.now() - started;
      const measure = typeof outcome === 'boolean' ? { ms, ok: outcome } : outcome;
      write({ config: name, i, warmup: i < WARMUP, ms: Math.round(measure.ms * 10) / 10, ok: measure.ok });
      process.stderr.write(`${name} ${i} ${Math.round(measure.ms)} ms ${measure.ok ? 'ok' : 'FAILED'}\n`);
    }
  }
}

try {
  await family(isolation);
  await family(recall);
} finally {
  await warm.close();
  await model.close();
}
process.stderr.write(`${out}\n`);
process.exit(0);
