// `Approvals` over the owner's directory (docs/design/trusted-gate.md, « Step 1 as built »): one file per kind,
// `delivery-<kind>.json`, written by `tools/deliver/approve` run as the owner of the directory (root, under sudo).
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ApprovalKind, ApprovalRecord } from '../domain/approval.js';
import type { Approvals } from '../domain/ports.js';

/** A record is a few hundred bytes; more is not one. */
const MAX_BYTES = 4096;

function recordSchema(kind: ApprovalKind) {
  const seconds = z.number().int().positive();
  return z.strictObject({
    kind: z.literal(kind),
    repository: z.string(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    approvedAt: seconds,
    expiresAt: seconds,
    // A maintenance record says what the owner means the change of the judge to do; a publication record says nothing more.
    ...(kind === 'maintenance' ? { intent: z.string().trim().min(1) } : {}),
  });
}

/** Written by `owner` alone: a uid no confined session holds, and no write bit for the group or the others. */
function ownedBy(stat: Stats, owner: number): boolean {
  return stat.uid === owner && (stat.mode & 0o022) === 0;
}

export class FileApprovals implements Approvals {
  /**
   * `directory` is the owner's (`/etc/architect-os`), `owner` the uid that alone may write it and its files (0). A
   * scenario gives a temporary directory and its own uid: what is checked does not change.
   */
  constructor(
    private readonly directory: string,
    private readonly owner: number,
  ) {}

  read(kind: ApprovalKind): ApprovalRecord {
    const path = join(this.directory, `delivery-${kind}.json`);
    let fd: number;
    try {
      // The directory itself, not what a link would name: whoever can write it can replace the file.
      const directory = lstatSync(this.directory);
      if (!directory.isDirectory() || !ownedBy(directory, this.owner)) return { state: 'untrusted' };
      // Opened once, without following a link and without waiting on a pipe; every check is of what was opened.
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? { state: 'absent' }
        : { state: 'untrusted' };
    }
    try {
      const file = fstatSync(fd);
      // A second name could be another file's: one link only.
      if (!file.isFile() || file.nlink !== 1 || !ownedBy(file, this.owner) || file.size > MAX_BYTES) {
        return { state: 'untrusted' };
      }
      // Text that is not JSON, or JSON not of the form of its kind, throws: the `catch` makes it untrusted.
      const record = recordSchema(kind).parse(JSON.parse(String(readFileSync(fd))));
      const { repository, commit, approvedAt, expiresAt } = record;
      return { state: 'present', repository, commit, approvedAt, expiresAt };
    } catch {
      return { state: 'untrusted' };
    } finally {
      closeSync(fd);
    }
  }
}
