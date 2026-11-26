// A tree of files the host pins and then runs from a private copy: the producer of Define and Plan is the first user
// (tools/define/src/infrastructure/producer.ts). The host reads each pinned file once, never through a link, hashes
// those bytes, and writes the same bytes into a fresh private directory: what runs is what was hashed.
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export interface PinnedTreeRule {
  /** The directories pinned, relative to the root, `/`-separated. */
  readonly include: readonly string[];
  /** Directories inside them that are neither read nor copied. */
  readonly skip: readonly string[];
  /** Files that must be present. */
  readonly required: readonly string[];
  readonly maxFiles: number;
  readonly maxBytes: number;
}

export interface PinnedFile {
  readonly path: string;
  readonly bytes: Buffer;
}

// Never follow a link, never wait on a pipe: what an entry is comes from its descriptor.
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function open(absolute: string): number {
  try {
    return openSync(absolute, OPEN_FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw Error('PINNED_TREE_INCOMPLETE');
    if (code === 'ELOOP') throw Error('PINNED_TREE_LINK');
    // A socket cannot be opened at all (ENXIO on Linux, EOPNOTSUPP on macOS).
    throw Error('PINNED_TREE_FILE');
  }
}

/**
 * Read the pinned files once, sorted by the bytes of their paths. A link, a file that is neither regular nor a
 * directory, a name with a newline or a backslash (the listing below could not say it), a missing required file, or
 * more files or bytes than the rule allows is refused with a `PINNED_TREE_` name.
 */
export function readPinnedTree(root: string, rule: PinnedTreeRule): PinnedFile[] {
  const base = realpathSync(root);
  const skipped = new Set(rule.skip);
  const files: PinnedFile[] = [];
  let total = 0;
  // A directory, or the bytes of a regular file read through the descriptor that judged it.
  const entry = (absolute: string): 'directory' | Buffer => {
    const descriptor = open(absolute);
    try {
      const stat = fstatSync(descriptor);
      if (stat.isDirectory()) return 'directory';
      if (!stat.isFile()) throw Error('PINNED_TREE_FILE');
      return readFileSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  };
  const walk = (path: string) => {
    if (skipped.has(path)) return;
    if (/[\\\n]/.test(path)) throw Error('PINNED_TREE_PATH');
    const absolute = join(base, path);
    const bytes = entry(absolute);
    if (bytes === 'directory') {
      for (const name of readdirSync(absolute)) walk(`${path}/${name}`);
      return;
    }
    total += bytes.length;
    files.push({ path, bytes });
    if (files.length > rule.maxFiles || total > rule.maxBytes) throw Error('PINNED_TREE_TOO_LARGE');
  };
  for (const top of rule.include) walk(top);
  const paths = new Set(files.map(({ path }) => path));
  if (!rule.required.every((path) => paths.has(path))) throw Error('PINNED_TREE_INCOMPLETE');
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * The SHA-256 of what `shasum -a 256` prints for the files in that order, so that an operator can recompute it with
 * `find … -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256`.
 */
export function pinnedTreeDigest(files: readonly PinnedFile[]): string {
  return sha256(files.map(({ path, bytes }) => `${sha256(bytes)}  ${path}\n`).join(''));
}

export interface StagedTree {
  /** A fresh directory of the host, mode 0700, that holds the pinned bytes and nothing else, each file 0400. */
  readonly root: string;
  dispose(): void;
}

/**
 * Write the bytes that were hashed into a new private directory under `parent`. The umask is 0 meanwhile, so the modes
 * written here are the modes the copy has, whatever the umask of the host.
 */
export function stagePinnedTree(files: readonly PinnedFile[], parent: string, prefix: string): StagedTree {
  const copy = realpathSync(mkdtempSync(join(parent, prefix)));
  const dispose = () => rmSync(copy, { recursive: true, force: true });
  const mask = process.umask(0);
  try {
    for (const { path, bytes } of files) {
      mkdirSync(dirname(join(copy, path)), { recursive: true, mode: 0o700 });
      writeFileSync(join(copy, path), bytes, { flag: 'wx', mode: 0o400 });
    }
  } catch (error) {
    dispose();
    throw error;
  } finally {
    process.umask(mask);
  }
  return { root: copy, dispose };
}
