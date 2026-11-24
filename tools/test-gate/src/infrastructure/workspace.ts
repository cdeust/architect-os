import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  globSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FileSet } from '../domain/layout.js';

// Darwin's <sys/fcntl.h> O_NOFOLLOW_ANY is not exported by Node (node_modules/@types/node/fs.d.ts).
const DARWIN_NOFOLLOW_ANY = 0x20000000;

/** Linux exposes the pinned directory for each relative open through procfs (proc_pid_fd(5)). */
function openOnLinux(path: string, flags: number): number {
  const names = path.slice(1).split('/');
  const leaf = names.pop() as string;
  const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let directory = openSync('/', directoryFlags);
  try {
    for (const name of names) {
      const next = openSync('/proc/self/fd/' + directory + '/' + name, directoryFlags);
      closeSync(directory);
      directory = next;
    }
    return openSync('/proc/self/fd/' + directory + '/' + leaf, flags);
  } finally {
    closeSync(directory);
  }
}

/** Open flags differ by kernel. Darwin rejects O_NOFOLLOW combined with O_NOFOLLOW_ANY. */
export function openWorkspaceFile(file: string, platform = process.platform, openDarwin = openSync): number {
  const flags = constants.O_RDONLY | constants.O_NONBLOCK;
  return platform === 'darwin'
    ? openDarwin(file, flags | DARWIN_NOFOLLOW_ANY)
    : openOnLinux(file, flags | constants.O_NOFOLLOW);
}

/** The working tree, paths relative to its root (absolute paths are taken as they are). */
export interface ReplayReplacement {
  begin(file: string, original: string, mutated: string): void;
  restore(): void;
}

export class Workspace {
  private readonly physicalRoot: string;

  constructor(
    private readonly root: string,
    private readonly reportPath?: (path: string) => string,
    readonly replacement?: ReplayReplacement,
  ) {
    this.physicalRoot = realpathSync(root);
  }

  path(path: string): string {
    return path.startsWith('reports/') && this.reportPath ? this.reportPath(path) : resolve(this.root, path);
  }

  /** Sorted relative paths; `exclude` also prunes the walk (fs.globSync options: node_modules/@types/node/fs.d.ts). */
  glob(set: FileSet): string[] {
    return globSync([...set.include], { cwd: this.root, exclude: [...set.exclude] }).sort();
  }

  /** The text of a file, null when it does not exist. */
  read(path: string): string | null {
    return this.readBytes(path)?.toString('utf8') ?? null;
  }

  readBytes(path: string): Buffer | null {
    if (path.split('/').some((part) => part === '' || part === '.' || part === '..'))
      throw new Error('GATE_SOURCE_PATH_INVALID : ' + path);
    const file =
      path.startsWith('reports/') && this.reportPath
        ? this.reportPath(path)
        : resolve(this.physicalRoot, path);
    try {
      const fd = openWorkspaceFile(file);
      try {
        if (!fstatSync(fd).isFile()) throw new Error('GATE_SOURCE_NOT_REGULAR : ' + path);
        return readFileSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT') return null;
      // With O_DIRECTORY, Linux reports ENOTDIR for a symlink used as a directory.
      if (code === 'ELOOP' || code === 'ENOTDIR') throw new Error('GATE_SOURCE_LINK : ' + path);
      throw error;
    }
  }

  exists(path: string): boolean {
    return existsSync(this.path(path));
  }

  write(path: string, text: string): void {
    const file = this.path(path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  append(path: string, text: string): void {
    appendFileSync(this.path(path), text);
  }

  remove(path: string): void {
    rmSync(this.path(path), { force: true, recursive: true });
  }
}
