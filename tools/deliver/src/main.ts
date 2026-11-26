// The composition root of `npm run deliver` (docs/design/orchestration-fable-5-2.md §14): the one place that builds
// objects. The entry `cli.ts` only hands it the process. Every dependency of the process is injected.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deliver } from './application/deliver.js';
import type { DeliverConfig } from './domain/config.js';
import { parseDeliverConfig } from './infrastructure/deliver-schema.js';
import { FileLog } from './infrastructure/file-log.js';
import { GhForge } from './infrastructure/gh-forge.js';
import { GitRepository } from './infrastructure/git-repository.js';
import { ProcessGate } from './infrastructure/process-gate.js';
import { parseStepRecord } from './infrastructure/step-record.js';
import { StreamProgress } from './infrastructure/stream-progress.js';
import { TimerClock } from './infrastructure/timer-clock.js';

function usage(): string {
  return 'usage: deliver <name> [--until ci]';
}

/** What the command needs from its process; every one of them is injected. */
export interface DeliverDependencies {
  /** The arguments after the script. */
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  /** The program that runs git. */
  readonly git: string;
  /** The program that runs the GitHub client, and what goes before `api` in its argv. */
  readonly gh: { readonly program: string; readonly prefix: readonly string[] };
  readonly setTimer: (handler: () => void, milliseconds: number) => unknown;
  /** The descriptive file `deliver.json`. */
  readonly config: string;
}

export interface Arguments {
  name: string;
  until: 'end' | 'ci';
}

/** One name, and `--until ci` once, in any place; anything else is undefined. */
export function parseArguments(argv: readonly string[]): Arguments | undefined {
  const rest = [...argv];
  const at = rest.indexOf('--until');
  let until: Arguments['until'] = 'end';
  if (at !== -1) {
    if (rest[at + 1] !== 'ci') return undefined;
    rest.splice(at, 2);
    until = 'ci';
  }
  const [name, ...others] = rest;
  if (name === undefined || others.length > 0 || name.startsWith('-')) return undefined;
  return { name, until };
}

/**
 * The variable by which the shell entry `./aos` hands over the XDG_CONFIG_HOME of its caller, `set:<value>` or `unset`,
 * before it gives its command the one of the run it admitted (docs/design/orchestration-fable-5-2.md §14, « Un seul
 * lieu d'écriture »): the identity of git and of the client of the forge is configured in the caller's.
 */
export const HANDED_XDG_CONFIG_HOME = 'ARCHITECT_OS_HOST_XDG_CONFIG_HOME';

/**
 * The environment from which git and the client of the forge take the names of the list: the one of the process when
 * nothing is handed over (a delivery started without `./aos`); else the same, with the XDG_CONFIG_HOME the caller of
 * `./aos` had, set, empty or absent as it was. None when what is handed over has neither form. The nested Gate separately receives its admitted paths and no forge identity.
 */
export function hostEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> | undefined {
  const handed = env[HANDED_XDG_CONFIG_HOME];
  if (handed === undefined) return env;
  const given: Record<string, string | undefined> = { ...env };
  delete given['XDG_CONFIG_HOME'];
  if (handed === 'unset') return given;
  if (!handed.startsWith('set:')) return undefined;
  return { ...given, XDG_CONFIG_HOME: handed.slice('set:'.length) };
}

function loadConfig(path: string): { ok: true; config: DeliverConfig } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(String(readFileSync(path)));
  } catch {
    return { ok: false, reason: 'the descriptive file cannot be read' };
  }
  return parseDeliverConfig(raw);
}

/** Runs the command and gives its exit code: 0 delivered or ready, 1 stopped, 2 refused before any act, 3 a port threw. */
export async function runDeliver(deps: DeliverDependencies): Promise<number> {
  const refuse = (reason: string): number => {
    deps.stderr.write(`architect-os deliver: ${reason}\n`);
    return 2;
  };
  const options = parseArguments(deps.argv);
  if (options === undefined) return refuse(usage());
  const loaded = loadConfig(deps.config);
  if (!loaded.ok) return refuse(loaded.reason);
  const { config } = loaded;

  const env = hostEnvironment(deps.env);
  if (env === undefined) return refuse(`${HANDED_XDG_CONFIG_HOME} is neither "unset" nor "set:<value>"`);
  const worktree = deps.env['INIT_CWD'] ?? deps.cwd;
  const host = { names: config.environment, env };
  try {
    // Built inside the `try`: an adapter that refuses what it is given says so like a port that throws.
    const ports = {
      repository: new GitRepository(worktree, config.remote, deps.git, host),
      forge: new GhForge(config.repository, deps.gh.program, deps.gh.prefix, worktree, host),
      gate: new ProcessGate(worktree, config.gateCommand, config.gateLog, deps.env),
      clock: new TimerClock(deps.setTimer),
      log: new FileLog(config.log, deps.env['ARCHITECT_OS_RUNTIME_ROOT']),
      progress: new StreamProgress(deps.stderr),
      parseRecord: parseStepRecord,
    };
    const result = await deliver(options, config, ports);
    // The line the log keeps of a run that got past the preconditions, and the refusal of one that did not.
    deps.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.outcome !== 'stopped') return 0;
    deps.stderr.write(`stopped at ${result.phase}: ${result.reason}\n`);
    return 1;
  } catch (error) {
    deps.stderr.write(`architect-os deliver: ${(error as Error).message}\n`);
    return 3;
  }
}

/** The process, as far as the command reads it. */
export interface DeliverProcess {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  cwd(): string;
}

/** The real dependencies: the streams of the process, git and gh, the timer, the file of this package. */
export function deliverDependencies(proc: DeliverProcess): DeliverDependencies {
  return {
    argv: proc.argv.slice(2),
    cwd: proc.cwd(),
    env: proc.env,
    stdout: proc.stdout,
    stderr: proc.stderr,
    git: 'git',
    gh: { program: 'gh', prefix: [] },
    setTimer: setTimeout,
    config: fileURLToPath(new URL('../deliver.json', import.meta.url)),
  };
}
