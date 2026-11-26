import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * What the git of the fingerprint, of the gate, of its guard and of the delivery is given: the whole of what precedes
 * its subcommand and the whole of its environment (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé
 * pour git »). One descriptive file, packages/sandbox/git-closed.json, is the only place where what they share is
 * written; this module is its only TypeScript reader and adds what each caller asks for itself. The guard of the
 * checkout, which /bin/sh starts before any Node (tools/test-gate/gate.sh), reads the same file
 * (tools/test-gate/with-tree-lock.py, `closed_git`); packages/sandbox/features/git-closed.feature runs the same copies
 * of the file through both readers.
 *
 * What this closes, and what it does not. The options and variables make a fingerprint and a verdict independent of
 * the machine, and are a second barrier behind the one the boundary rests on: a session cannot write the git directory
 * of its repository (`denyWrite` of packages/sandbox/profiles/builder.json). They do not make a writable git directory
 * harmless: its `core.excludesFile` still hides an untracked file, its `core.sshCommand` still runs on a push, and
 * `url.*.insteadOf`, `include.path` and `credential.helper` are read as well.
 *
 * The rules below are of shape. What the file must hold is not written a second time here: a constant that restated
 * it would be a copy to keep in step, and would stop no one the pinned scenario of the committed file does not stop.
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

// Each rule is one anchored pattern over printable ASCII, written the same in the guard (`re.fullmatch`): the two
// languages agree on nothing wider (what `.` and `$` match, which characters are spaces).
const OPTION = /^--[a-z][!-~]*$/;
const CONFIGURATION = /^[A-Za-z][A-Za-z0-9.]*=[!-~]+$/;
const VARIABLE = /^GIT_[A-Z_]+$/;
const VALUE = /^[!-~]+$/;
const HOST = /^(?!GIT_|HOME$|XDG_CONFIG_HOME$)[A-Z][A-Z_]*$/;

/** Each option is `--name…`, or `-c` followed by its `name=value`: nothing that git would read as a subcommand. */
function precedesSubcommand(options: readonly string[]): boolean {
  return options.every((option, at) =>
    options[at - 1] === '-c'
      ? CONFIGURATION.test(option)
      : option === '-c'
        ? at + 1 < options.length
        : OPTION.test(option),
  );
}

/** An object whose own keys are all variables of git with a value; the keys are read as JSON gave them. */
function areVariables(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([name, text]) => VARIABLE.test(name) && typeof text === 'string' && VALUE.test(text),
    )
  );
}

const ClosedGitSchema = z
  .object({
    options: z.array(z.string()).min(1).refine(precedesSubcommand),
    environment: z.custom<Record<string, string>>(areVariables),
    machineIndependent: z.custom<Record<string, string>>(areVariables),
    host: z
      .array(z.string().regex(HOST))
      .min(1)
      .refine((names) => new Set(names).size === names.length),
  })
  .strict();

/** What the bytes of a file give the git of the host, or the reason they are refused. */
export function parseClosedGit(bytes: Uint8Array): ClosedGit | { failure: string } {
  let json: unknown;
  try {
    // UTF-8 and nothing else, a byte order mark included: what the guard decodes too.
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return { failure: 'git-closed.json : JSON invalide' };
  }
  const parsed = ClosedGitSchema.safeParse(json);
  return parsed.success ? parsed.data : { failure: 'git-closed.json : schéma refusé' };
}

/** What the bytes of a file give the git of the host; refused bytes throw, and no git is started. */
export function loadClosedGit(bytes: Uint8Array): ClosedGit {
  const parsed = parseClosedGit(bytes);
  if ('failure' in parsed) throw new Error(parsed.failure);
  return parsed;
}

/**
 * The committed file of the package this module is loaded from: the launcher's for the fingerprint and the delivery,
 * the candidate's own for the gate a candidate runs on itself, as the code of that gate is. A refused file throws.
 */
export function closedGit(): ClosedGit {
  const path = fileURLToPath(
    new URL('../git-closed.json', import.meta.resolve('@architect-os/sandbox/runtime-context')),
  );
  return loadClosedGit(readFileSync(path));
}

/**
 * What precedes the subcommand of a call: the closed options, then the configuration values the caller adds for
 * itself, each as `-c name=value` (the gate reads the paths of a diff as they are, `core.quotePath=false`).
 */
export function closedGitOptions(
  own: readonly `${string}=${string}`[] = [],
  closed: ClosedGit = closedGit(),
): string[] {
  return [...closed.options, ...own.flatMap((value) => ['-c', value])];
}

/**
 * `given`, then what the caller sets for itself. A variable the caller sets is its own to decide (the private index of
 * the fingerprint, the prompt of the delivery): a file that names it too is refused, never silently preferred.
 */
function withOwn(
  given: Readonly<Record<string, string>>,
  own: Readonly<Record<string, string>>,
): Record<string, string> {
  if (Object.keys(own).some((name) => Object.hasOwn(given, name)))
    throw new Error("git-closed.json : variable que l'appelant pose lui-même");
  return { ...given, ...own };
}

/**
 * The whole environment of a git that reads no configuration of the machine (the fingerprint, the gate): the names of
 * the file that the process sets, the variables of the file, and what the caller sets for itself (the private index of
 * the fingerprint). No `HOME`, and no global nor system configuration: the result depends on the repository alone.
 */
export function machineIndependentGitEnvironment(
  own: Readonly<Record<string, string>> = {},
  closed: ClosedGit = closedGit(),
): Record<string, string> {
  const given: Record<string, string> = {};
  for (const name of closed.host) {
    const value = process.env[name];
    if (value !== undefined) given[name] = value;
  }
  return withOwn({ ...given, ...closed.machineIndependent, ...closed.environment }, own);
}

/**
 * The whole environment of the git of the delivery, which keeps the configuration of the host, where the helper that
 * identifies it to the forge lives: `taken`, the variables the delivery took from the host by the names of its own
 * descriptive file (tools/deliver/deliver.json), the variables of the file, and what the delivery sets for itself.
 */
export function hostConfiguredGitEnvironment(
  taken: Readonly<Record<string, string>>,
  own: Readonly<Record<string, string>>,
  closed: ClosedGit = closedGit(),
): Record<string, string> {
  return withOwn({ ...taken, ...closed.environment }, own);
}
