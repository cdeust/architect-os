import { codexModelSchema } from './step-file.js';
import { realpathSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SbxBuilder, type SbxSettings } from './sbx-builder.js';
import { sbxPolicySchema } from './sbx-vm.js';
import { privateStateDirectory, StateJournal } from './state-journal.js';
import { registrationSchema, type HostAccount } from './sbx-account.js';
import { storedAccount } from './sbx-keychain.js';
import { readPrivateText } from './private-text.js';
import type { Builder, BuildRequest } from './builder.js';

function readSetting(path: string): string {
  return readPrivateText(path, process.getuid!(), 'SBX_HOST_SETTING');
}
function optionalSetting(path: string) {
  try {
    return readSetting(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
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
export function accountHost(dir: string, notice?: (url: string) => void): HostAccount {
  const hostIdPath = join(dir, 'host-id');
  if (optionalSetting(hostIdPath) === undefined) publishOnce(hostIdPath, 'urn:uuid:' + randomUUID());
  const hostId = z
    .string()
    .regex(/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    .parse(readSetting(hostIdPath).trim());
  const reg = join(dir, 'registration.json'),
    prior = optionalSetting(reg);
  const previous = prior === undefined ? undefined : registrationSchema.parse(settingJson(prior));
  return {
    hostId,
    previous,
    consentPage: notice,
    registered: (r) => {
      publishOnce(reg, JSON.stringify(r));
      const saved = registrationSchema.parse(settingJson(readSetting(reg)));
      if (saved.client_id !== r.client_id || saved.accountHash !== r.accountHash)
        throw Error('SBX_ACCOUNT_CHANGED');
    },
  };
}
const hostProxy = z.literal('127.0.0.1:${authProxyPort}');
const builderNetwork = z.object({
  srt: z.object({
    network: z.strictObject({
      allowedDomains: z.union([z.tuple([hostProxy]), z.tuple([hostProxy, z.literal('registry.npmjs.org')])]),
      deniedDomains: z.tuple([]),
    }),
  }),
});
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
  account: (
    host: HostAccount,
    model: import('./step-file.js').CodexModel,
    dir: string,
  ) => Pick<ReturnType<typeof storedAccount>, 'access' | 'close'> = storedAccount,
  builder: (settings: SbxSettings) => Builder = (settings) => new SbxBuilder(settings),
) {
  const launcherRelative = relative(request.worktree, realpathSync(launcher));
  if (launcherRelative.split(sep)[0] !== '..') throw Error('SBX_SEPARATE_LAUNCHER_REQUIRED');
  const dir = privateStateDirectory(runtime, ['sbx']);
  const budget = budgetSchema.parse(settingJson(readSetting(join(dir, 'limits.json'))));
  const policy = sbxPolicySchema.parse(settingJson(readSetting(join(snapshot, 'sbx/isolation.json'))));
  const profile = builderNetwork.parse(settingJson(readSetting(join(snapshot, 'profiles/builder.json'))));
  const journal = new StateJournal(runtime, '${state}/sbx/usage.jsonl');
  const model = codexModelSchema.parse(request.config.model);
  const host = accountHost(dir);
  const session = account(host, model, dir);
  try {
    return await builder({
      allowRegistry: profile.srt.network.allowedDomains[1] === 'registry.npmjs.org',
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
