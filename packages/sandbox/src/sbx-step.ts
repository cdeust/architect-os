import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
  linkSync,
  unlinkSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SbxBuilder, type SbxSettings } from './sbx-builder.js';
import { sbxPolicySchema } from './sbx-vm.js';
import { privateStateDirectory, StateJournal } from './state-journal.js';
import { registrationSchema, hostAccountSession } from './sbx-account.js';
import type { Builder, BuildRequest } from './builder.js';

function readPrivate(path: string, optional = false) {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    if (optional && (e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw Error('SBX_HOST_SETTING_REQUIRED');
  }
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid!() ||
      (s.mode & 0o077) !== 0 ||
      s.size > 1024 * 1024
    )
      throw Error('SBX_HOST_SETTING');
    const bytes = Buffer.alloc(s.size + 1);
    let offset = 0;
    for (;;) {
      const n = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!n) break;
      offset += n;
      if (offset === bytes.length) throw Error('SBX_HOST_SETTING');
    }
    if (offset !== s.size) throw Error('SBX_HOST_SETTING');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
  } finally {
    closeSync(fd);
  }
}
function settingJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw Error('SBX_INVALID_SETTING');
  }
}
function publishOnce(path: string, value: string) {
  const temp = path + '.' + randomUUID();
  writeFileSync(temp, value, { mode: 0o600, flag: 'wx' });
  try {
    try {
      linkSync(temp, path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  } finally {
    unlinkSync(temp);
  }
}
const budgetSchema = z.strictObject({
  bytes: z.int().positive(),
  requests: z.int().positive(),
  tokens: z.int().positive(),
});
export async function buildSbxStep(
  request: BuildRequest,
  snapshot: string,
  launcher: string,
  runtime: string,
  notice: (line: string) => void,
  account = hostAccountSession,
  builder: (settings: SbxSettings) => Builder = (settings) => new SbxBuilder(settings),
) {
  const launcherRelative = relative(request.worktree, realpathSync(launcher));
  if (launcherRelative !== '..' && !launcherRelative.startsWith('..' + sep))
    throw Error('SBX_SEPARATE_LAUNCHER_REQUIRED');
  const dir = privateStateDirectory(runtime, ['sbx']);
  const budget = budgetSchema.parse(settingJson(readPrivate(join(dir, 'limits.json'))!));
  const hostIdPath = join(dir, 'host-id');
  if (readPrivate(hostIdPath, true) === undefined) publishOnce(hostIdPath, 'urn:uuid:' + randomUUID());
  const hostId = z
    .string()
    .regex(/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    .parse(readPrivate(hostIdPath)?.trim());
  const reg = join(dir, 'registration.json'),
    prior = readPrivate(reg, true);
  const previous = prior === undefined ? undefined : registrationSchema.parse(settingJson(prior));
  const policy = sbxPolicySchema.parse(settingJson(readPrivate(join(snapshot, 'sbx/isolation.json'))!));
  const journal = new StateJournal(runtime, '${state}/sbx/usage.jsonl');
  const model = z.enum(['gpt-6.2-astra', 'gpt-6.2-sol']).parse(request.config.model);
  const session = account(
    {
      hostId,
      previous,
      consentPage: (url) => notice('Continue with ChatGPT: ' + url + '\n'),
      registered: (r) => {
        publishOnce(reg, JSON.stringify(r));
        const saved = registrationSchema.parse(settingJson(readPrivate(reg)!));
        if (saved.client_id !== r.client_id || saved.accountHash !== r.accountHash)
          throw Error('SBX_ACCOUNT_CHANGED');
      },
    },
    model,
  );
  try {
    return await builder({
      policy,
      archive: join(runtime, 'cache', 'sbx', policy.archive),
      guestSource: join(snapshot, 'sbx/codex-guest.py'),
      budget,
      access: session.access,
      record: (r) => journal.append(JSON.stringify(r) + '\n'),
    }).build(request);
  } finally {
    session.close();
  }
}
