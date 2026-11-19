// The port of the admission on the filesystem. Two adapters: NodeRuntimeFilesystem (the host) and
// MemoryRuntimeFilesystem (the scenarios: missing nodes, links, devices, free space and failures, without touching the
// disk of the host). Every path below a root is given as components, never as a text to join.
import type { Below } from '#runtime/domain/root.js';
import type { SpaceSample } from '#runtime/domain/space.js';

/** What identifies a directory at one instant: its device and its inode. */
export interface DirectoryIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

/** A root: absent (a missing volume, nothing is created), unsafe (a link on its way, not a directory), or a directory. */
export type RootState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unsafe' }
  | ({ readonly kind: 'directory' } & DirectoryIdentity);

/**
 * The marker of a root, opened without following a link: absent, unreadable (a link, not a regular file, too long, a
 * read that ends before or after the size of the file, an I/O error once open), or its bytes.
 */
export type MarkerState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'file'; readonly device: bigint; readonly bytes: Uint8Array };

/**
 * A shared directory as it is found, without writing: every component there and a directory on the given device
 * (`found`), a component missing and none before it unsafe (`absent`), a component that is a link, not a directory, or on
 * another device (`unsafe`), or a component that cannot be inspected (`failed`).
 */
export type SharedDirectory = 'found' | 'absent' | 'unsafe' | 'failed';

/** A directory made or found: `unsafe` when what is there is a link, not a directory, or on another device. */
export type DirectoryOutcome = 'ok' | 'unsafe' | 'failed';

/** A run just allocated: its name, a direct child of `<root>/run`, and the identity of the directory made for it. */
export interface RunAllocation extends DirectoryIdentity {
  readonly name: string;
}

export interface RuntimeFilesystem {
  /** The state of a root given as a canonical absolute path: a directory only when its real path is itself. */
  inspectRoot(root: string): RootState;
  /** The marker of an inspected root. */
  readMarker(root: string): MarkerState;
  /** The actual home of the account, from the account record of the system, not from a variable; none if unknown. */
  homeDirectory(): string | undefined;
  /** One sample of the filesystem holding a directory; none when it cannot be measured, or the directory changed meanwhile. */
  sample(path: string): SpaceSample | undefined;
  /** A directory below the root as it is found, one component at a time, without creating anything. */
  findDirectory(root: string, device: bigint, below: Below): SharedDirectory;
  /**
   * A directory below the root, found or made one component at a time, each a directory on the given device; one that
   * another admission makes at the same instant is found, not a failure.
   */
  ensureDirectory(root: string, device: bigint, below: Below): DirectoryOutcome;
  /** A new direct child of `<root>/run`, made exclusively with a name the adapter generates and nothing holds; or none. */
  allocateRun(root: string): RunAllocation | undefined;
  /** A new directory below `<root>/run/<id>`, made exclusively; false if anything was there or it failed. */
  createDirectory(root: string, below: Below): boolean;
  /**
   * A new file below `<root>/run/<id>`, made exclusively with this text; false if anything was there or it failed, and
   * then no file of this call is left.
   */
  createFile(root: string, below: Below, text: string): boolean;
  /**
   * Removes a run this admission allocated and could not finish, when the root still has `root` as its identity, `run`
   * is still a directory and not a link, and the run still has the identity of its allocation: `made`, the paths below the
   * run that this admission created, in their order, are removed from the last, without following a link, then the run.
   * Anything else is left as it is: a replacement, a link, an entry this admission did not make. True when the run is gone.
   */
  discardRun(
    root: string,
    rootIdentity: DirectoryIdentity,
    run: RunAllocation,
    made: readonly Below[],
  ): boolean;
}
