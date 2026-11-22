import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { specHostJournal, type SpecHostJournal } from '@architect-os/contracts';

const hasCode = (error: unknown, code: string) =>
  error instanceof Error && 'code' in error && error.code === code;

function absent(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    throw error;
  }
}

function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readPrivate(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
      throw Error('SPEC_JOURNAL_FILE_UNSAFE');
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function persist(path: string, content: string, exclusive: boolean) {
  const parent = dirname(path);
  const temp = join(parent, `.write-${randomUUID()}`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (exclusive) linkSync(temp, path);
    else renameSync(temp, path);
    syncDirectory(parent);
  } finally {
    if (!absent(temp)) unlinkSync(temp);
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('SPEC_JOURNAL_LEASE_INVALID');
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, 'ESRCH')) return false;
    if (hasCode(error, 'EPERM')) return true;
    throw error;
  }
}

export function openPlanningJournal(directory: string) {
  const uid = process.getuid?.();
  if (uid === undefined) throw Error('SPEC_JOURNAL_PLATFORM_UNSUPPORTED');
  const target = resolve(directory);
  const parent = dirname(target);
  if (realpathSync(parent) !== parent) throw Error('SPEC_JOURNAL_DIRECTORY_UNSAFE');
  for (let path = target; ; path = dirname(path)) {
    if (!absent(join(path, '.git'))) throw Error('SPEC_JOURNAL_INSIDE_CHECKOUT');
    if (path !== target) {
      const ancestor = lstatSync(path);
      if (
        !ancestor.isDirectory() ||
        (ancestor.uid !== 0 && ancestor.uid !== uid) ||
        ((ancestor.mode & 0o022) !== 0 && (ancestor.mode & 0o1000) === 0)
      ) {
        throw Error('SPEC_JOURNAL_DIRECTORY_UNSAFE');
      }
    }
    if (dirname(path) === path) break;
  }
  try {
    mkdirSync(target, { mode: 0o700 });
    syncDirectory(parent);
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
    throw Error('SPEC_JOURNAL_DIRECTORY_UNSAFE');
  }

  // An exclusive generation makes acquisition atomic even when two hosts recover a dead owner.
  const generation = readdirSync(target).reduce((latest, name) => {
    const number = /^\.lease-([1-9][0-9]*)$/.exec(name)?.[1];
    return number ? Math.max(latest, Number(number)) : latest;
  }, 0);
  if (generation > 0) {
    const prior = join(target, `.lease-${generation}`);
    if (absent(`${prior}.done`) && processAlive(Number(readPrivate(prior))))
      throw Error('SPEC_JOURNAL_IN_USE');
  }
  if (!Number.isSafeInteger(generation + 1)) throw Error('SPEC_JOURNAL_LEASE_INVALID');
  const lease = join(target, `.lease-${generation + 1}`);
  try {
    persist(lease, String(process.pid), true);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) throw Error('SPEC_JOURNAL_IN_USE');
    throw error;
  }
  const journal = join(target, '.host.json');
  const artifact = (name: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw Error('SPEC_ARTIFACT_PATH_REFUSED');
    return join(target, name);
  };
  return {
    home: target,
    load: () =>
      absent(journal)
        ? undefined
        : specHostJournal.parse(
            JSON.parse(
              new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readPrivate(journal)),
            ),
          ),
    save: (state: SpecHostJournal) => persist(journal, JSON.stringify(state), false),
    readArtifact: (name: string) => readPrivate(artifact(name)),
    writeArtifact: (name: string, content: string) => {
      const path = artifact(name);
      if (absent(path)) persist(path, content, true);
      else if (!readPrivate(path).equals(Buffer.from(content))) throw Error('SPEC_ARTIFACT_CONFLICT');
    },
    release: () => persist(`${lease}.done`, '', true),
  };
}
