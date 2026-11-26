import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * What every git the host starts is given, whoever starts it (the fingerprint, the gate, its guard, the delivery): the
 * whole of what precedes its subcommand and the whole of its environment (docs/design/orchestration-fable-5-2.md §14,
 * « Un environnement fermé pour git »). One descriptive file, packages/sandbox/git-closed.json, is the only place
 * where an option, a variable or a name of the host is written; this module is its only TypeScript reader, and the
 * guard of the checkout, which /bin/sh starts before any Node (tools/test-gate/gate.sh), reads the same file with the
 * same rules (tools/test-gate/with-tree-lock.py, `closed_git`).
 *
 * What this closes, and what it does not. The options and variables make a fingerprint and a verdict independent of
 * the machine, and are a second barrier behind the one the boundary rests on: a session cannot write the git directory
 * of its repository (`denyWrite` of packages/sandbox/profiles/builder.json). They do not make a writable git directory
 * harmless: its `core.excludesFile` still hides an untracked file, its `core.sshCommand` still runs on a push, and
 * `url.*.insteadOf`, `include.path` and `credential.helper` are read as well.
 */
export interface ClosedGit {
  /** What precedes the subcommand of every call. */
  readonly options: readonly string[];
  /** The variables every call is given. */
  readonly environment: Readonly<Record<string, string>>;
  /** The variables of a call that reads no configuration of the machine: the fingerprint, the gate and its guard. */
  readonly machineIndependent: Readonly<Record<string, string>>;
  /** The names such a call takes from the host; `HOME` is never one, so git finds no configuration of the account. */
  readonly host: readonly string[];
}

/** Each option is `--name…`, or `-c` followed by its `name=value`: nothing that git would read as a subcommand. */
function precedesSubcommand(options: readonly string[]): boolean {
  return options.every((option, at) =>
    options[at - 1] === '-c'
      ? /^[A-Za-z][A-Za-z0-9.]*=./.test(option)
      : option === '-c'
        ? at + 1 < options.length
        : /^--[a-z]/.test(option),
  );
}

const variables = z.record(z.string().regex(/^GIT_[A-Z_]+$/), z.string().min(1));

const ClosedGitSchema = z
  .object({
    options: z.array(z.string()).min(1).refine(precedesSubcommand),
    environment: variables,
    machineIndependent: variables,
    host: z
      .array(z.string().regex(/^(?!GIT_|HOME$|XDG_CONFIG_HOME$)[A-Z][A-Z_]*$/))
      .min(1)
      .refine((names) => new Set(names).size === names.length),
  })
  .strict();

/** What `text` gives every git of the host, or the reason it is refused. */
export function parseClosedGit(text: string): ClosedGit | { failure: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { failure: 'git-closed.json : JSON invalide' };
  }
  const parsed = ClosedGitSchema.safeParse(json);
  return parsed.success ? parsed.data : { failure: 'git-closed.json : schéma refusé' };
}

/** What `text` gives every git of the host; a refused text throws, and no git is started. */
export function loadClosedGit(text: string): ClosedGit {
  const parsed = parseClosedGit(text);
  if ('failure' in parsed) throw new Error(parsed.failure);
  return parsed;
}

/** The committed file of the launcher package, never one of the checkout under inspection. A refused file throws. */
export function closedGit(): ClosedGit {
  const path = fileURLToPath(
    new URL('../git-closed.json', import.meta.resolve('@architect-os/sandbox/runtime-context')),
  );
  return loadClosedGit(new TextDecoder().decode(readFileSync(path)));
}

/**
 * What precedes the subcommand of a call: the closed options, then the configuration values the caller adds for
 * itself, each as `-c name=value` (the gate reads the paths of a diff as they are, `core.quotePath=false`).
 */
export function closedGitOptions(own: readonly `${string}=${string}`[] = []): string[] {
  return [...closedGit().options, ...own.flatMap((value) => ['-c', value])];
}

/** Each of `names` that `read` gives a value for. */
function taken(names: readonly string[], read: (name: string) => string | undefined): Record<string, string> {
  const given: Record<string, string> = {};
  for (const name of names) {
    const value = read(name);
    if (value !== undefined) given[name] = value;
  }
  return given;
}

/** Each of `names` that `env` has as an own property and sets: a closed list, never a whole environment. */
export function takenByName(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return taken(names, (name) => (Object.hasOwn(env, name) ? env[name] : undefined));
}

/**
 * The whole environment of a git that reads no configuration of the machine (the fingerprint, the gate): the names of
 * the file that the process sets, what the caller adds for itself (the private index of the fingerprint), then the
 * variables of the file, which win. No `HOME`, and the global and system configuration are an empty file: the result
 * depends on the repository alone.
 */
export function machineIndependentGitEnvironment(
  own: { GIT_INDEX_FILE?: string } = {},
): Record<string, string> {
  const closed = closedGit();
  return {
    ...taken(closed.host, (name) => process.env[name]),
    ...own,
    ...closed.machineIndependent,
    ...closed.environment,
  };
}

/**
 * The whole environment of the git of the delivery, which keeps the configuration of the host, where the helper that
 * identifies it to the forge lives: the names its own descriptive file lists (tools/deliver/deliver.json) that the
 * host sets, what the delivery adds for itself, then the variables of the file, which win.
 */
export function hostConfiguredGitEnvironment(
  host: { readonly names: readonly string[]; readonly env: Readonly<Record<string, string | undefined>> },
  own: { GIT_TERMINAL_PROMPT: '0' },
): Record<string, string> {
  return { ...takenByName(host.names, host.env), ...own, ...closedGit().environment };
}
