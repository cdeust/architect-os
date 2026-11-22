import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { checkPrivateDirectory, privateStateDirectory } from '@architect-os/sandbox/state-journal';

const SHA = z.string().regex(/^[0-9a-f]{40}$/);
const identity = z.strictObject({ device: z.string(), inode: z.string() });
const receipt = z.strictObject({
  version: z.literal('architect-os-gate/v1'),
  job: z.literal('linux'),
  sha: SHA,
  root: identity,
  checkout: identity,
  run: z.string().regex(/^r[a-zA-Z0-9]{6}$/),
  base: z.string(),
  report: z.string(),
  digest: z.string(), // The reader compares the entire SHA-256 digest of both retained artifacts.
});
const base = z.strictObject({
  job: z.literal('linux'),
  sha: SHA,
  count: z.number().int().nonnegative(),
  pickles: z.array(z.string()),
});
function physical(path: string) {
  const st = lstatSync(realpathSync(path), { bigint: true });
  if (!st.isDirectory()) throw new Error('GATE_RECEIPT_DIRECTORY_INVALID');
  return { device: String(st.dev), inode: String(st.ino) };
}
function workspaceKey(id: { device: string; inode: string }) {
  return id.device + '-' + id.inode;
}
function digest(base: string, report: string) {
  return createHash('sha256')
    .update(JSON.stringify([base, report]))
    .digest('hex');
}
function validProof(sha: string, value: string, report: string) {
  const parsed = base.parse(JSON.parse(value));
  return (
    parsed.sha === sha &&
    parsed.count === parsed.pickles.length &&
    report.startsWith('# Porte de test, job linux : VERTE\n') &&
    report.split('\n').includes('- tête : ' + sha)
  );
}

/** Called by the checked Linux Gate before releasing its kernel lease. Both original artifacts survive run cleanup. */
export function publishGateReceipt(
  root: string,
  checkout: string,
  run: string,
  sha: string,
  value: string,
  report: string,
): void {
  const tree = physical(checkout);
  if (run !== join(root, 'run', basename(run)) || !validProof(sha, value, report))
    throw new Error('GATE_RECEIPT_PROOF_INVALID');
  const data = receipt.parse({
    version: 'architect-os-gate/v1',
    job: 'linux',
    sha,
    root: physical(root),
    checkout: tree,
    run: basename(run),
    base: value,
    report,
    digest: digest(value, report),
  });
  const directory = privateStateDirectory(root, ['gate', workspaceKey(tree)]);
  const file = join(directory, 'publish-' + randomUUID());
  const fd = openSync(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      writeFileSync(fd, JSON.stringify(data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(file, join(directory, 'latest.json'));
    const parent = openSync(directory, constants.O_DIRECTORY | constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  } finally {
    rmSync(file, { force: true });
  }
}

/** Read-only: never creates a directory, follows a substituted journal path, or consults checkout reports. */
export function readGateReceipt(root: string, checkout: string): string | undefined {
  try {
    const owner = physical(root),
      tree = physical(checkout);
    let directory = root;
    for (const part of ['state', 'gate', workspaceKey(tree)]) {
      directory = join(directory, part);
      checkPrivateDirectory(directory, BigInt(owner.device));
    }
    const path = join(directory, 'latest.json');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const st = fstatSync(fd, { bigint: true });
      if (
        !st.isFile() ||
        st.nlink !== 1n ||
        st.uid !== BigInt(process.getuid!()) ||
        st.dev !== BigInt(owner.device) ||
        (st.mode & 0o7777n) !== 0o600n
      )
        return undefined;
      const data = receipt.parse(JSON.parse(readFileSync(fd, 'utf8')));
      const named = lstatSync(path, { bigint: true });
      if (named.ino !== st.ino || named.dev !== st.dev || realpathSync(directory) !== directory)
        return undefined;
      if (
        data.root.device !== owner.device ||
        data.root.inode !== owner.inode ||
        data.checkout.device !== tree.device ||
        data.checkout.inode !== tree.inode ||
        data.digest !== digest(data.base, data.report) ||
        !validProof(data.sha, data.base, data.report)
      )
        return undefined;
      return data.sha;
    } finally {
      closeSync(fd);
    }
  } catch {
    // A missing, unreadable or invalidated receipt supplies no checked commit.
  }
}
