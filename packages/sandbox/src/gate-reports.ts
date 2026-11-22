import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { hasAdmittedRun } from '@architect-os/sandbox/runtime-context';
import { checkPrivateDirectory } from '@architect-os/sandbox/state-journal';

/** Reports belong to the run issued to this host process, including a validated hosted job resumption. */
export function gateReportsDirectory(env: Readonly<NodeJS.ProcessEnv>): string {
  if (!hasAdmittedRun(env)) throw new Error('GATE_ADMISSION_REQUIRED');
  const run = env.ARCHITECT_OS_RUN_DIR!;
  const directory = join(run, 'reports');
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  checkPrivateDirectory(directory, lstatSync(run, { bigint: true }).dev);
  return directory;
}

/** Descriptors name reports relative to the repository vocabulary, never absolute locations on the host. */
export function gateReportPath(env: Readonly<NodeJS.ProcessEnv>, logical: string): string {
  const [prefix, ...parts] = logical.split('/');
  if (
    prefix !== 'reports' ||
    !parts.length ||
    parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))
  )
    throw new Error('GATE_REPORT_PATH_INVALID');
  let path = gateReportsDirectory(env);
  const device = lstatSync(path, { bigint: true }).dev;
  for (const part of parts) {
    path = join(path, part);
    const node = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (
      node &&
      (realpathSync(path) !== path ||
        node.dev !== device ||
        (!node.isDirectory() && (!node.isFile() || node.nlink !== 1n)))
    )
      throw new Error('GATE_REPORT_PATH_INVALID');
  }
  return path;
}
