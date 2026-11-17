import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Files } from '../domain/ports.js';

/** `Files` over a folder of the disk. Only paths the register or the tool derived reach it (no `..`, relative). */
export class FsFiles implements Files {
  constructor(private readonly root: string) {}

  /** A path that is not a file (absent, or a folder) reads as absent; any other failure throws. */
  read(path: string): string | undefined {
    const file = join(this.root, path);
    return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
  }

  exists(path: string): boolean {
    return existsSync(join(this.root, path));
  }

  write(path: string, text: string): void {
    const file = join(this.root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}
