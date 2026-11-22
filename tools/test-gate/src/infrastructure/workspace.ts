import {
  appendFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FileSet } from '../domain/layout.js';

/** The working tree, paths relative to its root (absolute paths are taken as they are). */
export interface ReplayReplacement {
  begin(file: string, original: string, mutated: string): void;
  restore(): void;
}

export class Workspace {
  constructor(
    private readonly root: string,
    private readonly reportPath: (path: string) => string = (path) => resolve(root, path),
    readonly replacement?: ReplayReplacement,
  ) {}

  path(path: string): string {
    return path.startsWith('reports/') ? this.reportPath(path) : resolve(this.root, path);
  }

  /** Sorted relative paths; `exclude` also prunes the walk (fs.globSync options: node_modules/@types/node/fs.d.ts). */
  glob(set: FileSet): string[] {
    return globSync([...set.include], { cwd: this.root, exclude: [...set.exclude] }).sort();
  }

  /** The text of a file, null when it does not exist. */
  read(path: string): string | null {
    const file = this.path(path);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  readBytes(path: string): Buffer | null {
    const file = this.path(path);
    return existsSync(file) ? readFileSync(file) : null;
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
