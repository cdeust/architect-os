import { spawnSync } from 'node:child_process';
import { fstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';

/** The fixed POSIX adapter is shared by the native CLI, the local shell and hosted jobs. */
const helper = join(
  dirname(createRequire(import.meta.url).resolve('@architect-os/test-gate/package.json')),
  'with-tree-lock.py',
);

function native(args: string[], input?: string): number {
  const fd = Number(process.env.AOS_GATE_LEASE_FD);
  const inherited = process.env.AOS_GATE_LEASE_FD !== undefined;
  if (inherited && (!Number.isSafeInteger(fd) || fd <= 2)) throw new Error('GATE_ACTIVE_LEASE_REQUIRED');
  const env = { ...process.env };
  delete env.AOS_GATE_LEASE_FD;
  const stdio: ('inherit' | 'pipe' | number)[] = [
    input === undefined ? 'inherit' : 'pipe',
    'inherit',
    'inherit',
  ];
  if (inherited) {
    // Never pass an unrelated stream or credential descriptor to the helper.
    if (!fstatSync(fd).isDirectory()) throw new Error('GATE_ACTIVE_LEASE_REQUIRED');
    stdio.push(fd);
    env.AOS_GATE_LEASE_FD = '3';
  }
  const child = spawnSync('/usr/bin/python3', ['-I', helper, ...args], { env, stdio, input });
  if (child.error) throw child.error;
  return child.status ?? 1;
}

export function runGateWithLease(mode: 'local' | 'hosted', args: string[]): number {
  const ext = extname(new URL(import.meta.url).pathname);
  const entry = new URL('./locked-command' + ext, import.meta.url).href;
  const invoke =
    'import {runLocked} from ' +
    JSON.stringify(entry) +
    ';process.exitCode = await runLocked(' +
    JSON.stringify(mode) +
    ', process.argv.slice(1));';
  return native([
    'exec',
    process.execPath,
    '--import',
    import.meta.resolve('tsx'),
    '--input-type=module',
    '-e',
    invoke,
    '--',
    ...args,
  ]);
}

export function changeReplayFile(file: string, source: string, mutated: string): void {
  if (native(['begin'], JSON.stringify({ file, source, mutated })) !== 0)
    throw new Error('GATE_MUTATION_REFUSED');
}

export function restoreReplayFile(): void {
  if (native(['restore']) !== 0) throw new Error('GATE_RESTORATION_REFUSED');
}

export function clearGateReceipt(): void {
  if (native(['discard']) !== 0) throw new Error('GATE_RECEIPT_INVALIDATION_FAILED');
}

export function requireCheckedCommit(sha: string): void {
  if (native(['verify', sha]) !== 0) throw new Error('GATE_RECEIPT_TREE_CHANGED');
}
