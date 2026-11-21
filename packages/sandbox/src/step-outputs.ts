import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmdirSync,
  statSync,
} from 'node:fs';
import { basename, join, sep } from 'node:path';
import { hasAdmittedRun } from './runtime-context.js';
import { checkPrivateDirectory, privateStateDirectory } from './state-journal.js';

export interface StepOutputs {
  retained: string;
  streams: string;
}

/** The caller has validated the Step name. The intake supplies no output path. */
export function reserveStepOutputs(
  env: NodeJS.ProcessEnv,
  name: string,
  intake: string,
  worktree: string,
): StepOutputs {
  if (!hasAdmittedRun(env)) throw new Error('RUNTIME_ENTRY_REQUIRED');
  const root = env.ARCHITECT_OS_RUNTIME_ROOT!;
  const run = env.ARCHITECT_OS_RUN_DIR!;
  const id = basename(run);
  const retained = join(root, 'state', 'steps', id, name);
  const tmp = join(run, 'tmp');
  const streamGroup = join(tmp, 'steps');
  const streams = join(streamGroup, name);
  for (const input of [intake, worktree]) {
    const physical = realpathSync(input);
    for (const output of [retained, streams]) {
      if (
        output === physical ||
        output.startsWith(join(physical, sep)) ||
        physical.startsWith(join(output, sep))
      )
        throw new Error('Step outputs overlap an input tree');
    }
  }
  privateStateDirectory(root, ['steps', id]);
  const device = statSync(root, { bigint: true }).dev;
  checkPrivateDirectory(tmp, device);
  mkdirSync(streamGroup, { recursive: true, mode: 0o700 });
  checkPrivateDirectory(streamGroup, device);
  // A retry or concurrent caller cannot replace a previous attempt, even when it was interrupted.
  mkdirSync(retained, { mode: 0o700 });
  // Pin the new inode through stream reservation so a replacement cannot reuse its number.
  const directory = openSync(retained, constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    mkdirSync(streams, { mode: 0o700 });
  } catch (error) {
    try {
      const own = fstatSync(directory, { bigint: true });
      const current = lstatSync(retained, { bigint: true });
      if (current.dev === own.dev && current.ino === own.ino) rmdirSync(retained);
    } catch {
      // Preserve the original failure and any entries added in the meantime. rmdir only removes an empty directory.
    }
    throw error;
  } finally {
    closeSync(directory);
  }
  return { retained, streams };
}
