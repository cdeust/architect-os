import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';

const statePrefix = '${state}/';

function component(part: string): boolean {
  return (
    part.length > 0 &&
    part !== '.' &&
    !part.includes('..') &&
    !part.includes('/') &&
    !part.includes('\\') &&
    !part.includes('\0')
  );
}

/** Only a relative sequence of components below the shared, host-owned state directory. */
export function isStateLogTemplate(template: string): boolean {
  return template.startsWith(statePrefix) && template.split('/').every(component);
}

export function checkPrivateDirectory(path: string, device: bigint): void {
  const stat = lstatSync(path, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.dev !== device ||
    stat.uid !== BigInt(process.getuid!()) ||
    (stat.mode & 0o7777n) !== 0o700n ||
    realpathSync(path) !== path
  )
    throw new Error('unsafe private state directory: ' + path);
}

/** Admission creates state; subsequent host operations may create only its private descendants. */
export function privateStateDirectory(root: string, components: readonly string[]): string {
  if (root === '/' || !isAbsolute(root) || realpathSync(root) !== root || !components.every(component))
    throw new Error('unsafe runtime state path');
  const device = lstatSync(root, { bigint: true }).dev;
  let dir = join(root, 'state');
  checkPrivateDirectory(dir, device);
  for (const part of components) {
    dir = join(dir, part);
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    checkPrivateDirectory(dir, device);
  }
  return dir;
}

/** An append-only host journal. Check the opened object before writing even when the path was previously valid. */
export class StateJournal {
  readonly path: string;
  private readonly parents: string[];
  private readonly root: string;
  private opened: { device: bigint; inode: bigint } | undefined;
  constructor(root: string | undefined, template: string) {
    if (!root || !isAbsolute(root)) throw new Error('the runtime root for the log is not an absolute path');
    if (!isStateLogTemplate(template)) throw new Error('invalid runtime state log path');
    this.root = root;
    const parts = template.slice(statePrefix.length).split('/');
    this.path = join(root, 'state', ...parts);
    this.parents = parts.slice(0, -1);
  }
  append(text: string): void {
    const dir = privateStateDirectory(this.root, this.parents);
    const parent = lstatSync(dir, { bigint: true });
    const descriptor = openSync(
      this.path,
      constants.O_WRONLY |
        constants.O_APPEND |
        (this.opened ? 0 : constants.O_CREAT) |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    try {
      const stat = fstatSync(descriptor, { bigint: true });
      if (
        !stat.isFile() ||
        stat.nlink !== 1n ||
        stat.uid !== parent.uid ||
        stat.dev !== parent.dev ||
        (stat.mode & 0o7777n) !== 0o600n
      )
        throw new Error('unsafe private state log: ' + this.path);
      // Revalidate the parent and final name after open. All bytes go through this checked descriptor.
      const current = lstatSync(this.path, { bigint: true });
      const now = lstatSync(dir, { bigint: true });
      if (
        current.dev !== stat.dev ||
        current.ino !== stat.ino ||
        now.dev !== parent.dev ||
        now.ino !== parent.ino ||
        realpathSync(dir) !== dir
      )
        throw new Error('runtime state log changed while opening');
      if (this.opened && (this.opened.device !== stat.dev || this.opened.inode !== stat.ino))
        throw new Error('runtime state log was replaced');
      writeFileSync(descriptor, text);
      this.opened = { device: stat.dev, inode: stat.ino };
    } finally {
      closeSync(descriptor);
    }
  }
}
