// The in-memory RuntimeFilesystem of the scenarios: a tree of absolute paths with directories, files, links and
// special files, a device for each node, the free space of each device, the home of the account, directories that
// refuse a new entry, paths that cannot be made, a run substituted while it is set up, a sample that finds another
// directory and a change made between the two passes over the shared directories. It changes nothing on the disk of the host. A link is never followed: on the way to a root or below it, it
// is unsafe, as the host adapter finds it through the real path.
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

type MemoryNode =
  | {
      readonly kind: 'directory';
      readonly device: bigint;
      readonly inode: bigint;
      readonly unsafeForState?: true;
    }
  | { readonly kind: 'file'; readonly device: bigint; readonly bytes: Uint8Array }
  | { readonly kind: 'link' }
  | { readonly kind: 'special' };

/** `/a/b/c` -> `/a`, `/a/b`, `/a/b/c`. */
const prefixes = (path: string): string[] =>
  path
    .slice(1)
    .split('/')
    .map((_, index, parts) => `/${parts.slice(0, index + 1).join('/')}`);

export class MemoryRuntimeFilesystem implements RuntimeFilesystem {
  private readonly nodes = new Map<string, MemoryNode>();
  private readonly space = new Map<bigint, Omit<SpaceSample, 'device' | 'inode'>>();
  private readonly sealed = new Set<string>();
  private readonly failing = new Map<string, string | undefined>();
  private readonly sampled = new Map<string, DirectoryIdentity>();
  private readonly unsearchable = new Set<string>();
  private readonly betweenPasses: (() => void)[] = [];
  private home: string | undefined;
  private inodes = 0n;
  private runs = 0;
  /** Every path this adapter created through the port, in order. */
  readonly created: string[] = [];
  /** Every path this adapter removed through the port, in order. */
  readonly removed: string[] = [];

  /** A directory at this path, in place of what was there, and at each missing ancestor, on this device. */
  directory(path: string, device: bigint): this {
    for (const prefix of prefixes(path)) {
      if (prefix === path || !this.nodes.has(prefix))
        this.nodes.set(prefix, { kind: 'directory', device, inode: ++this.inodes });
    }
    return this;
  }

  /** A retained directory whose mode or owner would not protect the shared state on the host. */
  unprotectedDirectory(path: string, device: bigint): void {
    this.directory(path, device);
    const dir = this.nodes.get(path) as Extract<MemoryNode, { kind: 'directory' }>;
    this.nodes.set(path, { ...dir, unsafeForState: true });
  }

  file(path: string, bytes: Uint8Array, device: bigint): this {
    this.nodes.set(path, { kind: 'file', device, bytes });
    return this;
  }

  link(path: string): this {
    this.nodes.set(path, { kind: 'link' });
    return this;
  }

  special(path: string): this {
    this.nodes.set(path, { kind: 'special' });
    return this;
  }

  /** The blocks available on a device, and their unit. */
  free(device: bigint, availableBlocks: bigint, blockSize: bigint): this {
    this.space.set(device, { availableBlocks, blockSize });
    return this;
  }

  homeAt(path: string | undefined): this {
    this.home = path;
    return this;
  }

  /** No new entry can be made directly in this directory, as when it is not writable. */
  seal(path: string): this {
    this.sealed.add(path);
    return this;
  }

  /**
   * This one path cannot be made, as when an I/O error interrupts it. With `replaced`, the attempt first puts another
   * directory (another inode, on the same device) at that path, as when a run is substituted while it is set up; what
   * is below it stays.
   */
  failAt(path: string, replaced?: string): this {
    this.failing.set(path, replaced);
    return this;
  }

  /** No path directly in this directory can be inspected, as when it refuses to be searched. */
  cannotSearch(directory: string): this {
    this.unsearchable.add(directory);
    return this;
  }

  /** A sample of this path reports this identity, as when another directory is found there while it is measured. */
  sampleAs(path: string, identity: DirectoryIdentity): this {
    this.sampled.set(path, identity);
    return this;
  }

  /**
   * A change made once the shared directories have been judged without writing (`findDirectory`) and before the first
   * is made (`ensureDirectory`), as when another admission or another process changes a component meanwhile: applied
   * once, at the first `ensureDirectory`.
   */
  changeBetweenPasses(change: (filesystem: this) => void): this {
    this.betweenPasses.push(() => change(this));
    return this;
  }

  /** Nothing at this path nor below it any more, as when another process removed them. */
  erase(path: string): this {
    for (const known of [...this.nodes.keys()])
      if (known === path || known.startsWith(`${path}/`)) this.nodes.delete(known);
    return this;
  }

  /** What is at a path, for the scenarios. */
  at(path: string): MemoryNode | undefined {
    return this.nodes.get(path);
  }

  inspectRoot(root: string): RootState {
    for (const prefix of prefixes(root)) {
      const node = this.nodes.get(prefix);
      if (node === undefined) return { kind: 'absent' };
      if (node.kind !== 'directory') return { kind: 'unsafe' };
    }
    // The root is the last of its prefixes: here it is a directory.
    const { device, inode } = this.nodes.get(root) as Extract<MemoryNode, { kind: 'directory' }>;
    return { kind: 'directory', device, inode };
  }

  readMarker(root: string): MarkerState {
    const node = this.nodes.get(`${root}/${MARKER_NAME}`);
    if (node === undefined) return { kind: 'absent' };
    if (node.kind !== 'file' || node.bytes.length > MARKER_MAX_BYTES) return { kind: 'unreadable' };
    return { kind: 'file', device: node.device, bytes: node.bytes };
  }

  homeDirectory(): string | undefined {
    return this.home;
  }

  sample(path: string): SpaceSample | undefined {
    const node = this.nodes.get(path);
    if (node?.kind !== 'directory') return undefined;
    const space = this.space.get(node.device);
    const { device, inode } = this.sampled.get(path) ?? node;
    return space === undefined ? undefined : { ...space, device, inode };
  }

  findDirectory(root: string, device: bigint, below: Below): SharedDirectory {
    if (below.length === 0 || !below.every(isComponent)) return 'unsafe';
    for (let depth = 1; depth <= below.length; depth++) {
      const path = [root, ...below.slice(0, depth)].join('/');
      if (this.unsearchable.has(path.slice(0, path.lastIndexOf('/')))) return 'failed';
      const node = this.nodes.get(path);
      if (node === undefined) return 'absent';
      if (
        node.kind !== 'directory' ||
        node.device !== device ||
        (below[0] === 'state' && node.unsafeForState)
      )
        return 'unsafe';
    }
    return 'found';
  }

  ensureDirectory(root: string, device: bigint, below: Below): DirectoryOutcome {
    for (const change of this.betweenPasses.splice(0)) change();
    if (below.length === 0 || !below.every(isComponent)) return 'unsafe';
    for (let depth = 1; depth <= below.length; depth++) {
      const path = [root, ...below.slice(0, depth)].join('/');
      if (!this.nodes.has(path)) {
        if (!this.makeable(path)) return 'failed';
        this.make(path, { kind: 'directory', device: this.deviceOfParent(path), inode: ++this.inodes });
      }
      const node = this.nodes.get(path) as MemoryNode;
      if (
        node.kind !== 'directory' ||
        node.device !== device ||
        (below[0] === 'state' && node.unsafeForState)
      )
        return 'unsafe';
    }
    return 'ok';
  }

  allocateRun(root: string): RunAllocation | undefined {
    const runs = `${root}/run`;
    const parent = this.nodes.get(runs);
    if (parent?.kind !== 'directory') return undefined;
    // A name that something already holds is skipped: what is there keeps its identity and its contents.
    let name: string;
    do name = `r${String(++this.runs).padStart(6, '0')}`;
    while (this.nodes.has(`${runs}/${name}`));
    if (!this.makeable(`${runs}/${name}`)) return undefined;
    const inode = ++this.inodes;
    this.make(`${runs}/${name}`, { kind: 'directory', device: parent.device, inode });
    return { name, device: parent.device, inode };
  }

  createDirectory(root: string, below: Below): boolean {
    const path = this.inRun(root, below);
    if (path === undefined) return false;
    this.make(path, { kind: 'directory', device: this.deviceOfParent(path), inode: ++this.inodes });
    return true;
  }

  createFile(root: string, below: Below, text: string): boolean {
    const path = this.inRun(root, below);
    if (path === undefined) return false;
    this.make(path, {
      kind: 'file',
      device: this.deviceOfParent(path),
      bytes: new TextEncoder().encode(text),
    });
    return true;
  }

  discardRun(
    root: string,
    rootIdentity: DirectoryIdentity,
    run: RunAllocation,
    made: readonly Below[],
  ): boolean {
    // Every path is judged before the first removal: none may leave the run.
    if (!made.every((below) => below.length > 0 && below.every(isComponent))) return false;
    const directory = `${root}/run/${run.name}`;
    if (!this.identical(root, rootIdentity)) return false;
    if (this.nodes.get(`${root}/run`)?.kind !== 'directory') return false;
    if (!this.identical(directory, run)) return false;
    for (const below of [...made].reverse()) {
      const path = [directory, ...below].join('/');
      const node = this.nodes.get(path);
      if (node === undefined) return false;
      // As rmdir and unlink: a directory goes only when it is empty, a file always, a link or a special file stays.
      if (node.kind === 'directory') {
        if (!this.empty(path)) return false;
        this.remove(path);
      } else if (node.kind === 'file') this.remove(path);
    }
    if (!this.empty(directory)) return false;
    this.remove(directory);
    return true;
  }

  /** Whether the node at a path has this device and this inode, as only a directory of this adapter has. */
  private identical(path: string, identity: DirectoryIdentity): boolean {
    const node = (this.nodes.get(path) ?? {}) as Partial<DirectoryIdentity>;
    return node.device === identity.device && node.inode === identity.inode;
  }

  private empty(directory: string): boolean {
    return ![...this.nodes.keys()].some((path) => path.startsWith(`${directory}/`));
  }

  private remove(path: string): void {
    this.nodes.delete(path);
    this.removed.push(path);
  }

  /** The path of a new node inside an allocated run, when its parent is a directory, it is free, and it does not fail. */
  private inRun(root: string, below: Below): string | undefined {
    if (below[0] !== 'run' || below.length < 3 || !below.every(isComponent)) return undefined;
    const path = [root, ...below].join('/');
    const parent = this.nodes.get(path.slice(0, path.lastIndexOf('/')));
    if (parent?.kind !== 'directory' || this.nodes.has(path) || !this.makeable(path)) return undefined;
    return path;
  }

  /** Whether a new node can be made at a path: its parent is not sealed and the path does not fail. */
  private makeable(path: string): boolean {
    if (this.failing.has(path)) {
      const replaced = this.failing.get(path);
      if (replaced !== undefined) {
        const { device } = this.nodes.get(replaced) as { device: bigint };
        this.nodes.set(replaced, { kind: 'directory', device, inode: ++this.inodes });
      }
      return false;
    }
    return !this.sealed.has(path.slice(0, path.lastIndexOf('/')));
  }

  private deviceOfParent(path: string): bigint {
    return (this.nodes.get(path.slice(0, path.lastIndexOf('/'))) as { device: bigint }).device;
  }

  private make(path: string, node: MemoryNode): void {
    this.nodes.set(path, node);
    this.created.push(path);
  }
}
