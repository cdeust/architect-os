import type { Entry } from '@napi-rs/keyring';
import { createRequire } from 'node:module';
import { closeSync, constants, lstatSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { hostAccountSession, savedGrantSchema, type HostAccount } from './sbx-account.js';
import type { CodexModel } from './step-file.js';

export function keychainEntry(id: string): Pick<Entry, 'getPassword' | 'setPassword' | 'deletePassword'> {
  const { Entry } = createRequire(import.meta.url)('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
  return new Entry('architect-os.siwc', id, { linux: { store: 'secret-service' } });
}

async function exclusive<T>(dir: string, signal: AbortSignal, operation: () => Promise<T>) {
  const path = join(dir, 'rotation.lock');
  try {
    closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const st = lstatSync(path);
  if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid!() || (st.mode & 0o777) !== 0o600)
    throw Error('SBX_ACCOUNT_LOCK');
  const db = new DatabaseSync(path);
  try {
    for (;;) {
      signal.throwIfAborted();
      try {
        db.exec('BEGIN EXCLUSIVE');
        break;
      } catch (e) {
        if ((e as { errcode?: number }).errcode !== 5) throw e;
        // sqliteDefaultBusyCallback's steady-state retry interval (SQLite src/main.c).
        await delay(100, undefined, { signal });
      }
    }
    return await operation();
  } finally {
    db.close();
  }
}

/** Each operation reads the latest OS item after acquiring the interprocess lock. */
export function storedAccount(
  host: HostAccount,
  model: CodexModel,
  dir: string,
  entry = keychainEntry,
  io: typeof fetch = fetch,
) {
  const life = new AbortController();
  async function use(signal: AbortSignal, signIn: boolean) {
    const active = AbortSignal.any([life.signal, signal]);
    return exclusive(dir, active, async () => {
      let item, grant;
      try {
        item = entry(host.hostId);
        const value = item.getPassword();
        grant = value === null ? undefined : savedGrantSchema.parse(JSON.parse(value));
      } catch {
        throw Error('SBX_KEYCHAIN_UNAVAILABLE');
      }
      const session = hostAccountSession(host, model, io, undefined, Date.now, grant, {
        saved(g) {
          item.setPassword(JSON.stringify(g));
        },
        revoked() {
          item.deletePassword();
        },
      });
      try {
        if (signIn) await session.signIn(active);
        return await session.access(active);
      } finally {
        session.close();
      }
    });
  }
  return {
    close: () => life.abort(),
    access: (signal: AbortSignal) => use(signal, false),
    signIn: async (signal: AbortSignal) => {
      await use(signal, true);
    },
  };
}
