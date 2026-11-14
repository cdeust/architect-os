// Cost baseline, pilot (docs/design/platform-v3-srt.md, brick 0): `npm run baseline:pilot`.
// Every task of baseline/tasks.json runs once in each of three configurations, on a fresh disposable checkout:
//   host       the owner's Claude Code as usual (plugins, MCP servers, hooks, memory, CLAUDE.md read by itself);
//   host-bare  the same Claude Code with --bare and every input explicit, through the auth proxy, without srt;
//   srt        the code tool of packages/sandbox (code.json): --bare under srt, through the auth proxy.
// The three get the same model, prompt, permission mode and allowed command. Metrics come from
// `--output-format json` (usage, total_cost_usd at public prices, turns, durations); the check runs on the host after
// the session. Checkouts are local clones of a cache, never pushed; the remote refs are compared before and after.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandCredential, startAuthProxy } from '../packages/sandbox/src/auth-proxy.js';
import { authProxyOptions, loadTool } from '../packages/sandbox/src/tool.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = join(ROOT, 'packages', 'sandbox');
const ALL = ['host', 'host-bare', 'srt'] as const;
type Config = (typeof ALL)[number];
// BASELINE_CONFIGS=srt,host runs those configurations only.
const wanted = process.env['BASELINE_CONFIGS']?.split(',');
const CONFIGS: readonly Config[] =
  wanted === undefined ? ALL : ALL.filter((config) => wanted.includes(config));

interface Task {
  id: string;
  repo: string;
  commit: string;
  setup: string[][];
  defect: { file: string; from: string; to: string };
  failing: string[];
  check: string[];
  allow: string;
}
const spec = JSON.parse(readFileSync(join(ROOT, 'baseline', 'tasks.json'), 'utf8')) as {
  model: string;
  timeoutMs: number;
  tasks: Task[];
};

const work = mkdtempSync(join(tmpdir(), 'aos-baseline-'));
const results = join(ROOT, 'baseline', 'results');
mkdirSync(results, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
// BASELINE_REPEATS=3 repeats every (task, configuration) cell: a campaign, named apart from the pilot.
const repeats = Number(process.env['BASELINE_REPEATS'] ?? '1');
const kind = repeats > 1 ? 'campaign' : 'pilot';
const out = join(results, `${kind}-${stamp}.jsonl`);
const usageLog = join(results, `${kind}-${stamp}.usage.jsonl`);

/** A synchronous command that must succeed; its standard output. */
function must(command: string, args: string[], cwd: string): string {
  const run = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (run.status !== 0)
    throw new Error(`${command} ${args.join(' ')} (${cwd}) : ${run.stderr || run.stdout}`);
  return run.stdout;
}

const checkPasses = (task: Task, cwd: string): boolean => {
  const [command, ...args] = task.check;
  return spawnSync(command as string, args, { cwd, encoding: 'utf8' }).status === 0;
};

/** The environment of a login shell of the owner, without this session's own Claude Code variables. */
const loginEnv = (): Record<string, string> => {
  const keep = ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR'];
  return Object.fromEntries(
    keep.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]])),
  );
};

/** A clone of the cache at the pinned commit, its worktree at .claude/worktrees/bench (the code tool needs one). */
function checkout(task: Task, cache: string): { dir: string; worktree: string } {
  const dir = mkdtempSync(join(work, `${task.id}-`));
  const repo = join(dir, 'repo');
  must('git', ['clone', '--quiet', '--no-checkout', cache, repo], work);
  const worktree = join(repo, '.claude', 'worktrees', 'bench');
  must('git', ['worktree', 'add', '--quiet', '--detach', worktree, task.commit], repo);
  for (const [command, ...args] of task.setup) must(command as string, args, worktree);
  if (!checkPasses(task, worktree)) throw new Error(`${task.id} : le contrôle échoue au commit épinglé`);
  const file = join(worktree, task.defect.file);
  const source = readFileSync(file, 'utf8');
  if (source.split(task.defect.from).length !== 2)
    throw new Error(`${task.id} : défaut introuvable ou ambigu`);
  writeFileSync(file, source.replace(task.defect.from, task.defect.to));
  if (checkPasses(task, worktree)) throw new Error(`${task.id} : le contrôle passe avec le défaut`);
  return { dir, worktree };
}

const prompt = (task: Task) =>
  [
    'These tests fail:',
    ...task.failing.map((test) => `- ${test}`),
    `Find the cause in the code and fix it. Do not modify the tests. Verify with: ${task.check.join(' ')}`,
  ].join('\n');

/** Runs a command with a time limit; standard output and the wall time. */
function timed(command: string, args: string[], cwd: string, env: Record<string, string>) {
  return new Promise<{ stdout: string; stderr: string; code: number | null; wallMs: number }>((done) => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: spec.timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) =>
      done({ stdout, stderr, code, wallMs: Math.round(performance.now() - started) }),
    );
  });
}

const tool = loadTool(join(SANDBOX, 'code.json'));
const profile = JSON.parse(readFileSync(join(SANDBOX, 'profiles', 'builder.json'), 'utf8'));

/** The host's Claude Code with --bare and the inputs of the code tool, through the auth proxy, without srt. */
async function hostBare(args: string[], worktree: string, dir: string) {
  const token = randomBytes(32).toString('hex');
  const options = {
    ...authProxyOptions(tool, token, commandCredential(tool.authProxy.credentialCommand)),
    usageLog,
  };
  const proxy = await startAuthProxy(options);
  const config = join(dir, 'config');
  mkdirSync(config, { mode: 0o700 });
  const vars: Record<string, string> = {
    home: homedir(),
    repo: join(worktree, '..', '..', '..'),
    worktree,
    config,
  };
  const resolveVars = (text: string) =>
    text.replace(/\$\{([A-Za-z]+)\}/g, (_, key: string) => vars[key] ?? '');
  writeFileSync(
    join(config, 'settings.json'),
    resolveVars(JSON.stringify(profile.files['${config}/settings.json'])),
  );
  writeFileSync(
    join(config, '.claude.json'),
    resolveVars(JSON.stringify(profile.files['${config}/.claude.json'])),
  );
  const [command, ...base] = tool.command.map(resolveVars);
  const prompts = ['--append-system-prompt-file', join(SANDBOX, tool.launcherPromptFile)];
  try {
    return await timed(command as string, [...base, ...prompts, ...args], worktree, {
      ...loginEnv(),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
      ANTHROPIC_API_KEY: token,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    });
  } finally {
    proxy.revoke();
    await proxy.close();
  }
}

async function session(config: Config, task: Task, worktree: string, dir: string) {
  const args = [
    '-p',
    prompt(task),
    '--model',
    spec.model,
    '--output-format',
    'json',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    task.allow,
  ];
  if (config === 'host') return timed('claude', args, worktree, loginEnv());
  if (config === 'host-bare') return hostBare(args, worktree, dir);
  // The documented launch (packages/sandbox/README.md): npm sets INIT_CWD to the target worktree, and tsx resolves
  // from the launcher's checkout, not from the target.
  return timed('npm', ['--prefix', ROOT, 'run', '--silent', 'code', '--', ...args], worktree, loginEnv());
}

/** The branches and tags of a remote, ref -> commit. Pull request refs move with any review activity: not read. */
const lsRemote = (repo: string): Map<string, string> =>
  new Map(
    must('git', ['ls-remote', '--heads', '--tags', repo], work)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commit, ref] = line.split('\t');
        return [ref as string, commit as string];
      }),
  );
// BASELINE_TASKS=<id>,<id> runs those tasks only.
const selected = process.env['BASELINE_TASKS']?.split(',');
const chosen = spec.tasks.filter((task) => selected === undefined || selected.includes(task.id));
// The cache of a repository holds its pinned commits only, at depth 1: never its whole history.
const caches = new Map<string, string>();
const remotes = new Map<string, string>();
for (const task of chosen) {
  let cache = caches.get(task.repo);
  if (cache === undefined) {
    cache = join(work, `cache-${caches.size}`);
    must('git', ['init', '--quiet', '--bare', cache], work);
    caches.set(task.repo, cache);
    remotes.set(task.repo, lsRemote(task.repo));
  }
  // A branch per pinned commit: a local clone of the cache carries only what a ref points at.
  must(
    'git',
    ['fetch', '--quiet', '--depth', '1', task.repo, `${task.commit}:refs/heads/pin-${task.commit}`],
    cache,
  );
}

const version = must('claude', ['--version'], work).trim();
// BASELINE_DRY=1 prepares every checkout and checks its preconditions, without any session.
const dry = process.env['BASELINE_DRY'] === '1';
for (const [index, task] of chosen.entries()) {
  for (let rep = 0; rep < repeats; rep++) {
    // The order of the configurations rotates with the task and the repetition, so that none always runs first.
    const order = CONFIGS.map((_, i) => CONFIGS[(i + index + rep) % CONFIGS.length] as Config);
    for (const config of order) {
      const { dir, worktree } = checkout(task, caches.get(task.repo) as string);
      if (dry) {
        process.stdout.write(`${task.id} ${config} prêt : contrôle vert au commit, rouge avec le défaut\n`);
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      const run = await session(config, task, worktree, dir);
      let report: Record<string, unknown> = {};
      try {
        report = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>;
      } catch {
        report = { unparsed: run.stdout.slice(-500) };
      }
      const changed = must('git', ['diff', '--name-only', task.commit], worktree).split('\n').filter(Boolean);
      const record = {
        task: task.id,
        rep,
        config,
        claude: version,
        model: spec.model,
        exit: run.code,
        wallMs: run.wallMs,
        solved: checkPasses(task, worktree),
        testsTouched: changed.filter((file) =>
          /(^|\/)(tests?|__tests__)\/|\.test\.|_test\.py$|^test_/.test(file),
        ),
        changed,
        costUsd: report['total_cost_usd'] ?? null,
        usage: report['usage'] ?? null,
        turns: report['num_turns'] ?? null,
        durationMs: report['duration_ms'] ?? null,
        durationApiMs: report['duration_api_ms'] ?? null,
        isError: report['is_error'] ?? null,
        result: typeof report['result'] === 'string' ? report['result'].slice(-1500) : null,
        diff: must('git', ['diff', task.commit], worktree).slice(0, 4000),
        stderrTail: run.code === 0 ? '' : run.stderr.slice(-400),
      };
      appendFileSync(out, `${JSON.stringify(record)}\n`);
      process.stdout.write(
        `${task.id} ${config} solved=${record.solved} cost=${String(record.costUsd)} wall=${run.wallMs}ms\n`,
      );
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// Every changed branch or tag, with its commits before and after. The checkouts' origin is the local cache and the
// sessions may run only the check command: a change here is a push from elsewhere, named so that it can be told apart.
const changes = [...remotes].flatMap(([repo, before]) => {
  const after = lsRemote(repo);
  const refs = new Set([...before.keys(), ...after.keys()]);
  return [...refs]
    .filter((ref) => before.get(ref) !== after.get(ref))
    .map((ref) => ({ repo, ref, before: before.get(ref) ?? null, after: after.get(ref) ?? null }));
});
// A dry run writes no results file.
if (!dry) {
  appendFileSync(
    out,
    `${JSON.stringify({ remotesUntouched: changes.length === 0, remoteChanges: changes })}\n`,
  );
}
process.stdout.write(`remotes untouched: ${changes.length === 0} ${JSON.stringify(changes)} -> ${out}\n`);
rmSync(work, { recursive: true, force: true });
