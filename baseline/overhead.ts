// Measure A, the overhead of the platform structure (baseline/README.md, protocol pre-registered): `npm run
// baseline:overhead`. A fake model on the loopback answers every recall with the same script, so no token is spent;
// what is timed is the structure: the isolation of a process, then a recall in process, under srt with its module
// warm, and under srt on a fresh platform. One JSON line per measure in baseline/results/overhead-<date>.jsonl, after
// a header line describing the host. OVERHEAD_N changes the number of measures per configuration (30 by default).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, homedir, release, tmpdir, type } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SrtSandboxRunner } from '@architect-os/sandbox';
import { startFakeModel, type ModelTurn } from '../features/support/fake-model.js';
import { serveInProcess } from '../features/support/inproc-worker.js';
import { ROOT, runnerOptions, startSrtPlatform, type SrtPlatform } from '../features/support/srt-platform.js';

const N = Number(process.env['OVERHEAD_N'] ?? 30);
/** `cold`: only srt against a cold Docker (amendment of H1, baseline/README.md); otherwise the protocol of measure A. */
const ONLY = process.env['OVERHEAD_ONLY'];
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
  only: ONLY ?? null,
  warmup: WARMUP,
});

/** Runs `command` to its end; resolves its exit code. */
const exitOf = (command: string, args: string[]) =>
  new Promise<number | null>((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code));
  });

/**
 * The cold Docker of iso-docker-cold, by host (baseline/README.md): under macOS the dedicated Colima VM `aos-bench`,
 * distinct from the profiles of other sessions, started then stopped; under Linux the daemon, started then stopped.
 */
const COLD_PROFILE = 'aos-bench';
const LINUX = process.platform === 'linux';
const COLD_HOST = LINUX ? [] : ['-H', `unix://${join(homedir(), '.colima', COLD_PROFILE, 'docker.sock')}`];
// Colima switches the Docker context when it starts: its own config folder keeps the context of the host unchanged.
const coldEnv = { ...process.env, DOCKER_CONFIG: mkdtempSync(join(tmpdir(), 'aos-bench-docker-')) };
/** Under Linux the whole engine: containerd, which dockerd runs on, and dockerd with its socket. */
const LINUX_UNITS = {
  start: ['containerd.service', 'docker.socket', 'docker.service'],
  stop: ['docker.service', 'docker.socket', 'containerd.service'],
};
const engine = (verb: 'start' | 'stop' | 'reset-failed') =>
  new Promise<boolean>((resolve) => {
    const units = verb === 'reset-failed' ? LINUX_UNITS.start : LINUX_UNITS[verb];
    const [command, args] = LINUX
      ? ['sudo', ['-n', 'systemctl', verb, ...units]]
      : ['colima', [verb, '--profile', COLD_PROFILE]];
    const child = spawn(command as string, args as string[], {
      stdio: 'ignore',
      env: coldEnv,
      cwd: tmpdir(),
    });
    child.on('exit', (code) => resolve(code === 0));
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

/** Both cold (amendment of H1): a fresh srt sandbox, and a container in a cold Docker of the host. */
const cold: Record<string, () => Promise<{ ms: number; ok: boolean; steps?: unknown } | boolean>> = {
  'iso-srt': isolation['iso-srt']!,
  'iso-docker-cold': async () => {
    // Untimed, under Linux only: systemd refuses a unit started 3 times within 60 s (start-limit-hit), a guard of
    // systemd and no cost of Docker; its counter is reset before each start.
    const reset = LINUX ? await engine('reset-failed') : true;
    const clock = performance.now();
    const started = await engine('start');
    const args = [...COLD_HOST, 'run', '--rm', '--network', 'none', IMAGE, 'node', '-e', '0'];
    const ran = started && (await exitOf('docker', args)) === 0;
    const stopped = await engine('stop');
    return { ms: performance.now() - clock, ok: reset && started && ran && stopped };
  },
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

// The model and the warm platform of measure A, started only when its families run.
const MEASURE_A = ONLY === undefined;
const model = MEASURE_A ? await startFakeModel(SCRIPT, { cycle: true }) : undefined;
const warm = MEASURE_A ? await startSrtPlatform(MEMORY, SCRIPT, { cycle: true }) : undefined;

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
      modelUrl: model!.url,
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
  'recall-srt-warm': () => recallOn(warm!),
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
async function family(
  configs: Record<string, () => Promise<{ ms: number; ok: boolean; steps?: unknown } | boolean>>,
) {
  const names = Object.keys(configs);
  for (let i = 0; i < WARMUP + N; i++) {
    for (let k = 0; k < names.length; k++) {
      const name = names[(i + k) % names.length]!;
      const started = performance.now();
      const outcome = await configs[name]!();
      const ms = performance.now() - started;
      const measure = typeof outcome === 'boolean' ? { ms, ok: outcome } : outcome;
      const steps = 'steps' in measure ? { steps: measure.steps } : {};
      write({
        config: name,
        i,
        warmup: i < WARMUP,
        ms: Math.round(measure.ms * 10) / 10,
        ok: measure.ok,
        ...steps,
      });
      process.stderr.write(`${name} ${i} ${Math.round(measure.ms)} ms ${measure.ok ? 'ok' : 'FAILED'}\n`);
    }
  }
}

/** The isolated delegation (baseline/README.md): the same `claude -p` in srt and in a cold Docker. */
const KEY = 'fake-not-a-key';
const PROMPT = 'Answer with the single word ok.';
/** The Linux binary of Claude Code in the image of a delegation: the package of the lockfile, its sha512 checked. */
const LINUX_PACKAGE = '@anthropic-ai/claude-agent-sdk-linux-arm64';

/**
 * The build context of the delegations, made once and untimed: the Dockerfile and the binary. Under Linux the binary
 * is the one npm ci installed from the lockfile; under macOS the package is fetched by npm pack and refused unless its
 * sha512 is the one of the lockfile. Each delegation writes its own configuration there before its build.
 */
function delegationContext(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aos-bench-context-'));
  let binary = join(ROOT, 'node_modules', LINUX_PACKAGE, 'claude');
  if (!LINUX) {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version: string; integrity: string }>;
    };
    const entry = lock.packages[`node_modules/${LINUX_PACKAGE}`]!;
    const packed = spawnSync('npm', ['pack', `${LINUX_PACKAGE}@${entry.version}`, '--silent'], {
      cwd: dir,
      encoding: 'utf8',
    });
    const tarball = join(dir, packed.stdout.trim());
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (integrity !== entry.integrity)
      throw new Error(`${LINUX_PACKAGE}: sha512 is not the one of the lockfile`);
    spawnSync('tar', ['-xzf', tarball, '-C', dir]);
    binary = join(dir, 'package', 'claude');
  }
  cpSync(binary, join(dir, 'claude'));
  const dockerfile = [
    `FROM ${IMAGE}`,
    'COPY claude /opt/claude/claude',
    'COPY delegation.json /opt/delegation/config.json',
  ];
  writeFileSync(join(dir, 'Dockerfile'), `${dockerfile.join('\n')}\n`);
  writeFileSync(join(dir, '.dockerignore'), '*\n!claude\n!Dockerfile\n!delegation.json\n');
  return dir;
}
let delegations = 0;
const CLAUDE = join(
  ROOT,
  'node_modules',
  '@anthropic-ai',
  LINUX ? 'claude-agent-sdk-linux-arm64' : 'claude-agent-sdk-darwin-arm64',
  'claude',
);
const CLAUDE_ARGS = ['-p', PROMPT, '--output-format', 'json', '--bare'];
// In a Linux VM the container reaches the model through the gateway of its host; under macOS through the address of
// the host as the Colima VM sees it, which reaches its loopback.
const context = ONLY === 'deleg' ? delegationContext() : undefined;
const delegationModel =
  ONLY === 'deleg'
    ? await startFakeModel([{ text: 'ok' }], { cycle: true, host: LINUX ? '0.0.0.0' : '127.0.0.1' })
    : undefined;
const dockerModelUrl = () =>
  LINUX ? `http://model.internal:${delegationModel!.port}` : `http://192.168.5.2:${delegationModel!.port}`;

/** Runs `command` to its end; resolves its exit code and its stdout. */
const outputOf = (command: string, args: string[]) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += String(chunk)));
    child.on('exit', (code) => resolve({ code, out }));
  });

/** Whether `claude -p` gave the answer of the model. */
const answered = (out: string): boolean => {
  try {
    return (JSON.parse(out) as { result?: unknown }).result === 'ok';
  } catch {
    return false;
  }
};

const delegation: Record<string, () => Promise<{ ms: number; ok: boolean; steps?: unknown } | boolean>> = {
  'deleg-srt': async () => {
    const runner = new SrtSandboxRunner(
      runnerOptions({ brokerPort: String(delegationModel!.port), taskToken: KEY }),
    );
    const sandbox = await runner.start({ profile: 'worker', cwd: ROOT, command: [CLAUDE, ...CLAUDE_ARGS] });
    sandbox.stdin.end();
    sandbox.stderr.resume();
    let out = '';
    sandbox.stdout.on('data', (chunk: Buffer) => (out += String(chunk)));
    return (await sandbox.exited).code === 0 && answered(out);
  },
  'deleg-docker-cold': async () => {
    const reset = LINUX ? await engine('reset-failed') : true;
    const tag = `aos-bench/claude-delegation:${(delegations += 1)}`;
    const clock = performance.now();
    // Its parameters and configuration, never its key (passed at run), as srt writes the files of its sandbox.
    const configuration = {
      delegation: delegations,
      tool: 'claude -p',
      prompt: PROMPT,
      model: dockerModelUrl(),
    };
    writeFileSync(join(context!, 'delegation.json'), `${JSON.stringify(configuration)}\n`);
    // The time of each step, to say where the time goes.
    const at: Record<string, number> = {};
    const lap = (step: string) => (at[step] = Math.round(performance.now() - clock));
    const started = await engine('start');
    lap('started');
    // Built without cache from the base pulled again (nothing survives a delegation), run, then destroyed.
    const build = [...COLD_HOST, 'build', '--no-cache', '--pull', '-q', '-t', tag, context!];
    const built = started && (await outputOf('docker', build)).code === 0;
    lap('built');
    const args = [
      ...COLD_HOST,
      'run',
      '--rm',
      ...(LINUX ? ['--add-host', 'model.internal:host-gateway'] : []),
      ...['-e', `ANTHROPIC_BASE_URL=${dockerModelUrl()}`, '-e', `ANTHROPIC_API_KEY=${KEY}`],
      ...[
        '-e',
        'HOME=/tmp',
        '-e',
        'CLAUDE_CONFIG_DIR=/tmp/claude',
        '-e',
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
      ],
      tag,
      '/opt/claude/claude',
      ...CLAUDE_ARGS,
    ];
    const ran = built ? await outputOf('docker', args) : { code: null, out: '' };
    lap('ran');
    // Every image and all the build cache, the base included: the next delegation finds nothing.
    const wiped = started && (await outputOf('docker', [...COLD_HOST, 'system', 'prune', '-af'])).code === 0;
    lap('wiped');
    const stopped = await engine('stop');
    lap('stopped');
    return {
      ms: performance.now() - clock,
      ok: reset && started && built && ran.code === 0 && answered(ran.out) && wiped && stopped,
      steps: { reset, started, built, ran: ran.code, answered: answered(ran.out), wiped, stopped, at },
    };
  },
};

// Before the campaign, untimed: the engine of the measure holds no image and no cache (baseline/README.md).
if (ONLY === 'deleg') {
  const emptied =
    (LINUX ? await engine('reset-failed') : true) &&
    (await engine('start')) &&
    (await outputOf('docker', [...COLD_HOST, 'system', 'prune', '-af'])).code === 0 &&
    (await engine('stop'));
  if (!emptied) throw new Error('the engine of the measure could not be emptied before the campaign');
}

try {
  if (ONLY === 'cold') await family(cold);
  else if (ONLY === 'deleg') await family(delegation);
  else {
    await family(isolation);
    await family(recall);
  }
} finally {
  await warm?.close();
  await model?.close();
  await delegationModel?.close();
}
process.stderr.write(`${out}\n`);
process.exit(0);
