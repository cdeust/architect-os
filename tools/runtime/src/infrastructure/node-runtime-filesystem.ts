// The RuntimeFilesystem of the host: Node built-ins only (the admission runs before any install). Declarations read:
// node_modules/@types/node/fs.d.ts (lstatSync and statSync with `bigint` and `throwIfNoEntry`, realpathSync.native,
// openSync, fstatSync, readSync, writeFileSync on a descriptor, closeSync, statfsSync with `bigint: true`, mkdtempSync,
// mkdirSync, rmdirSync, unlinkSync, constants.O_NOFOLLOW, O_NONBLOCK, O_EXCL; an error's `code`, such as EEXIST) and
// os.d.ts (userInfo, which reads the account record of the system, not the variable HOME). The failures the port names
// are values (an absent or unreadable marker, a sample that cannot be taken, a directory or a file not made, a run not
// discarded); an error nobody foresaw (a root whose real path cannot be read once it was found) reaches the entry,
// which exits 3.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { MARKER_MAX_BYTES, MARKER_NAME } from '#runtime/domain/marker.js';
import type {
  DirectoryIdentity,
  DirectoryOutcome,
  MarkerState,
  RootState,
  RunAllocation,
  RuntimeFilesystem,
  SharedDirectory,
} from '#runtime/domain/ports.js';
import { isComponent, type Below } from '#runtime/domain/root.js';
import type { SpaceSample } from '#runtime/domain/space.js';

/** The prefix of a run directory; `mkdtemp` adds six characters of its own. */
const RUN_PREFIX = 'r';
const PRIVATE_DIRECTORY = 0o700;
const PRIVATE_FILE = 0o600;
const NEW_FILE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
// O_NOFOLLOW: a link in place of the marker is refused, not followed; O_NONBLOCK: a pipe does not block the open.
const MARKER_OPEN = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * The calls this adapter makes on an open descriptor, the stat of a directory it measures and the lstat of a shared
 * directory it made or found: those of node:fs, which a scenario replaces to stage what a real disk does not do on
 * demand (an I/O error once open, a short read, a write that fails, a directory replaced while it is measured, a
 * shared directory removed as soon as it is made).
 */
export interface HostCalls {
  readonly fstat: (descriptor: number) => BigIntStats;
  readonly read: (descriptor: number, buffer: Uint8Array, offset: number, length: number) => number;
  readonly write: (descriptor: number, text: string) => void;
  readonly close: (descriptor: number) => void;
  readonly stat: (path: string) => BigIntStats;
  /** What is at a path, without following a link; none when nothing is there. */
  readonly lstat: (path: string) => BigIntStats | undefined;
}

export const HOST_CALLS: HostCalls = {
  fstat: (descriptor) => fstatSync(descriptor, { bigint: true }),
  // `null`: from the current position, which each read advances.
  read: (descriptor, buffer, offset, length) => readSync(descriptor, buffer, offset, length, null),
  write: (descriptor, text) => writeFileSync(descriptor, text),
  close: (descriptor) => closeSync(descriptor),
  stat: (path) => statSync(path, { bigint: true }),
  lstat: (path) => lstatSync(path, { bigint: true, throwIfNoEntry: false }),
};

const codeOf = (error: unknown): unknown => (error as { code?: unknown }).code;

/** The path of components below a directory, or none when one of them is not a plain component. */
function pathBelow(directory: string, below: Below): string | undefined {
  return below.length > 0 && below.every(isComponent) ? join(directory, ...below) : undefined;
}

/**
 * Whether a directory is reached by its own path, with no link on the way: O_NOFOLLOW and an exclusive mkdir guard the
 * last component only. Throws when the directory does not exist.
 */
const physical = (directory: string): boolean => realpathSync.native(directory) === directory;

/** The path of components inside an allocated run, `run/<id>/...`, or none. */
function pathInRun(root: string, below: Below): string | undefined {
  return below[0] === 'run' && below.length > 2 ? pathBelow(root, below) : undefined;
}

export class NodeRuntimeFilesystem implements RuntimeFilesystem {
  private readonly calls: HostCalls;

  constructor(calls: HostCalls = HOST_CALLS) {
    this.calls = calls;
  }

  inspectRoot(root: string): RootState {
    let stats;
    try {
      stats = lstatSync(root, { bigint: true });
    } catch (error) {
      return codeOf(error) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unsafe' };
    }
    // A link anywhere on the way, or a spelling that is not the real path, makes the two differ.
    if (!stats.isDirectory() || !physical(root)) return { kind: 'unsafe' };
    return { kind: 'directory', device: stats.dev, inode: stats.ino };
  }

  readMarker(root: string): MarkerState {
    let descriptor: number;
    try {
      descriptor = openSync(join(root, MARKER_NAME), MARKER_OPEN);
    } catch (error) {
      return codeOf(error) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable' };
    }
    let state: MarkerState;
    try {
      state = this.readOpened(descriptor);
    } catch {
      // An I/O error once the marker is open: it cannot be read.
      state = { kind: 'unreadable' };
    }
    try {
      this.calls.close(descriptor);
    } catch {
      return { kind: 'unreadable' };
    }
    return state;
  }

  /** The bytes of an open marker, read to its end: exactly the size its stat gives, and no more than a marker can hold. */
  private readOpened(descriptor: number): MarkerState {
    const stats = this.calls.fstat(descriptor);
    // A pipe, a device or a directory, as the open descriptor shows it.
    if (!stats.isFile()) return { kind: 'unreadable' };
    // One byte more than a marker can hold: a file too long, or that grew after its stat, reads as too long.
    const buffer = new Uint8Array(MARKER_MAX_BYTES + 1);
    let length = 0;
    for (;;) {
      const read = this.calls.read(descriptor, buffer, length, buffer.length - length);
      if (read === 0) break;
      length += read;
    }
    // A file too long, or that shrank or grew after its stat, is not a marker read whole.
    if (BigInt(length) !== stats.size || length > MARKER_MAX_BYTES) return { kind: 'unreadable' };
    return { kind: 'file', device: stats.dev, bytes: buffer.subarray(0, length) };
  }

  homeDirectory(): string | undefined {
    try {
      return userInfo().homedir;
    } catch {
      // The account has no record: no home is known, and the admission refuses.
    }
  }

  sample(path: string): SpaceSample | undefined {
    try {
      // The directory is identified before and after it is measured: a sample whose directory changed meanwhile is none.
      const before = this.calls.stat(path);
      // Node's StatFs exposes one unit, bsize, in which it counts bavail, the blocks available to an unprivileged caller.
      const space = statfsSync(path, { bigint: true });
      const after = this.calls.stat(path);
      if (after.dev !== before.dev || after.ino !== before.ino) return undefined;
      return { device: after.dev, inode: after.ino, availableBlocks: space.bavail, blockSize: space.bsize };
    } catch {
      // A path that cannot be measured gives no sample.
    }
  }

  findDirectory(root: string, device: bigint, below: Below): SharedDirectory {
    if (pathBelow(root, below) === undefined) return 'unsafe';
    try {
      for (let depth = 1; depth <= below.length; depth++) {
        const stats = lstatSync(join(root, ...below.slice(0, depth)), {
          bigint: true,
          throwIfNoEntry: false,
        });
        if (stats === undefined) return 'absent';
        if (!stats.isDirectory() || stats.dev !== device) return 'unsafe';
      }
      return 'found';
    } catch {
      return 'failed';
    }
  }

  ensureDirectory(root: string, device: bigint, below: Below): DirectoryOutcome {
    if (pathBelow(root, below) === undefined) return 'unsafe';
    for (let depth = 1; depth <= below.length; depth++) {
      const path = join(root, ...below.slice(0, depth));
      try {
        mkdirSync(path, { mode: PRIVATE_DIRECTORY });
      } catch (error) {
        // EEXIST: it was there, or another admission made it at the same instant; it is judged below like any other.
        if (codeOf(error) !== 'EEXIST') return 'failed';
      }
      const stats = this.calls.lstat(path);
      if (stats?.isDirectory() !== true || stats.dev !== device) return 'unsafe';
    }
    return 'ok';
  }

  allocateRun(root: string): RunAllocation | undefined {
    const runs = join(root, 'run');
    if (lstatSync(runs, { throwIfNoEntry: false })?.isDirectory() !== true) return undefined;
    try {
      const directory = mkdtempSync(join(runs, RUN_PREFIX));
      const { dev, ino } = lstatSync(directory, { bigint: true });
      return { name: directory.slice(runs.length + 1), device: dev, inode: ino };
    } catch {
      // A run directory that refuses a new child allocates nothing.
    }
  }

  createDirectory(root: string, below: Below): boolean {
    const path = pathInRun(root, below);
    if (path === undefined) return false;
    // Outside the try: only what the disk does is a failure of this call, not a path that was never one.
    const parent = dirname(path);
    try {
      if (!physical(parent)) return false;
      mkdirSync(path, { mode: PRIVATE_DIRECTORY });
      return true;
    } catch {
      return false;
    }
  }

  createFile(root: string, below: Below, text: string): boolean {
    const path = pathInRun(root, below);
    if (path === undefined) return false;
    const parent = dirname(path);
    let descriptor: number;
    try {
      if (!physical(parent)) return false;
      // Exclusive and without following a link: nothing that was there is written through.
      descriptor = openSync(path, NEW_FILE, PRIVATE_FILE);
    } catch {
      return false;
    }
    let written = true;
    try {
      this.calls.write(descriptor, text);
    } catch {
      written = false;
    }
    try {
      this.calls.close(descriptor);
    } catch {
      written = false;
    }
    if (!written) {
      try {
        // The file this call made goes: a failed write leaves nothing of it.
        unlinkSync(path);
      } catch {
        // Already gone.
      }
    }
    return written;
  }

  discardRun(
    root: string,
    rootIdentity: DirectoryIdentity,
    run: RunAllocation,
    made: readonly Below[],
  ): boolean {
    const directory = join(root, 'run', run.name);
    // Every path is judged before the first removal: none may leave the run.
    if (!made.every((below) => pathBelow(directory, below) !== undefined)) return false;
    try {
      const top = lstatSync(root, { bigint: true });
      if (top.dev !== rootIdentity.device || top.ino !== rootIdentity.inode) return false;
      if (!lstatSync(dirname(directory)).isDirectory()) return false;
      const own = lstatSync(directory, { bigint: true });
      if (own.dev !== run.device || own.ino !== run.inode) return false;
      for (const below of [...made].reverse()) {
        const path = join(directory, ...below);
        // rmdir and unlink act on the entry itself, never through a link; a directory goes only when it is empty.
        const entry = lstatSync(path);
        if (entry.isDirectory()) rmdirSync(path);
        else if (entry.isFile()) unlinkSync(path);
      }
      rmdirSync(directory);
      return true;
    } catch {
      // Something this admission did not make is still there, or an entry is gone: the run is left as it is.
      return false;
    }
  }
}
