import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

// Same input bound as the native Plan receipt. An appended byte also invalidates the read.
const maxBytes = 1024 * 1024;
export function readPrivateText(path: string, uid: number, refusal: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== uid ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > maxBytes
    )
      throw new Error(refusal);
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    for (;;) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
      if (offset === buffer.length) throw new Error(refusal);
    }
    if (offset !== stat.size) throw new Error(refusal);
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
  } finally {
    closeSync(fd);
  }
}
