import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function createWitness(workspace) {
  return open(join(workspace, 'witness.txt'), 'wx+', 0o600);
}

// Called after the VM is gone. Only the original host descriptor supplies bytes.
export async function readWitness(workspace, handle, expected) {
  const entries = await readdir(workspace);
  if (entries.length !== 1 || entries[0] !== 'witness.txt') throw Error('SBX_WITNESS_DIRECTORY_CHANGED');
  const original = await handle.stat({ bigint: true });
  const current = await lstat(join(workspace, 'witness.txt'), { bigint: true });
  if (
    !current.isFile() ||
    original.dev !== current.dev ||
    original.ino !== current.ino ||
    original.nlink !== 1n
  )
    throw Error('SBX_WITNESS_REPLACED');
  if (original.size !== BigInt(expected.length)) throw Error('SBX_WITNESS_SIZE_MISMATCH');
  const bytes = Buffer.alloc(expected.length + 1);
  const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
  const actual = bytes.subarray(0, bytesRead);
  if (!actual.equals(expected)) throw Error('SBX_WITNESS_CONTENT_MISMATCH');
  return actual;
}
