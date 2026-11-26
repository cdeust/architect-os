import { takenByName } from '@architect-os/sandbox/git-closed';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, ftruncateSync, openSync } from 'node:fs';

/**
 * The only file of tools/deliver that starts processes: named exception of the rule child-process-only-in-sandbox in
 * .dependency-cruiser.cjs. A program is always an argv, never a line given to a shell.
 */

/** What a program printed on its standard output, and the exit code it ended with. */
export interface Finished {
  status: number;
  out: string;
}

/**
 * The host variables a program is given, by name, and the environment those names are taken from. The rule is the one of
 * docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »: a closed list, never the whole
 * environment of the process.
 */
export interface HostEnvironment {
  readonly names: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** The environment of a program: each of `host.names` that `host.env` has as an own property and sets, then `added`, which wins. Nothing else. */
export function closedEnvironment(
  host: HostEnvironment,
  added: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...takenByName(host.names, host.env), ...added };
}

/**
 * Runs `program` in `cwd` and waits for its end, with `environment` as its whole environment: nothing of this process
 * is added to it. Its three streams are pipes of this call (the default of `spawnSync`): it reads nothing, its standard
 * error is captured and dropped, neither returned nor shown. `undefined`: the program did not run to its end (it could
 * not be started, or a signal ended it); a program that exited with a non-zero code is a `Finished` like another.
 */
export function runToEnd(
  program: string,
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
): Finished | undefined {
  const result = spawnSync(program, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    // The lists of a whole tree pass here: the default bound (1 MiB) would end git before its end.
    maxBuffer: 1 << 30,
  });
  return result.status === null ? undefined : { status: result.status, out: result.stdout };
}

/**
 * Runs `program` in `cwd` with both outputs written to the file `log` (created, or emptied) and no input, and gives its
 * exit code: 1 when a signal ended it or it could not be started, whether `spawn` says so by an event or by throwing.
 * Only the explicitly supplied environment reaches the Gate.
 */
export async function runToFile(
  program: string,
  args: readonly string[],
  cwd: string,
  log: string,
  environment: Readonly<Record<string, string>>,
): Promise<number> {
  const descriptor = openSync(
    log,
    constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  );
  try {
    const file = fstatSync(descriptor);
    if (!file.isFile() || file.nlink !== 1) return 1;
    ftruncateSync(descriptor, 0);
    return await new Promise<number>((resolve) => {
      const child = spawn(program, args, {
        cwd,
        env: environment,
        stdio: ['ignore', descriptor, descriptor],
      });
      child.on('error', () => resolve(1));
      child.on('close', (code) => resolve(code ?? 1));
    });
  } catch {
    // `spawn` threw instead of emitting `error` (an argument it refuses): the program could not be started.
    return 1;
  } finally {
    closeSync(descriptor);
  }
}
