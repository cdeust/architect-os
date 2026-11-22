import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const archiveSha512 =
  'mJLm5eia/GcukCrRfVEnYVD5dOXGE7cmpd9dJ/ixkSiKifzDAPaGq83ZEmwVhk3PxbdTPUSLRpnXZQKbNS5HoA==';
export const clientSha256 = '6a95492ca9d85ee76bd9fc5a4d8f72dd98a6130d1bb409bcfc50e61573106616';
export const clientVersion = 'codex-cli 0.170.0';
const guestPath = '/tmp/aos-b0-codex-guest.py';

export async function verifyArchive(archive) {
  const digest = createHash('sha512');
  for await (const bytes of createReadStream(archive)) digest.update(bytes);
  if (digest.digest('base64') !== archiveSha512) throw Error('SBX_CODEX_ARCHIVE_MISMATCH');
}

export function codexGuest(mode) {
  return ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8', '/usr/bin/python3', guestPath, mode];
}

export async function installCodex({ copyIn, exec }, archive) {
  await copyIn(archive, '/tmp/aos-b0-codex.tgz');
  const source = '/tmp/aos-b0-codex-source.py';
  await copyIn(fileURLToPath(new URL('./codex-guest.py', import.meta.url)), source);
  // sbx cp preserves a private checkout's 0600 mode. Install a root-owned, read-only guest entry point.
  const staged = await exec(
    ['/usr/bin/install', '-o', '0', '-g', '0', '-m', '0444', '--', source, guestPath],
    {
      user: '0:0',
    },
  );
  if (staged.code !== 0) throw Error('SBX_CODEX_GUEST_INSTALLATION_FAILED');
  const setup = await exec(codexGuest('install'), { user: '0:0' });
  if (setup.code !== 0) throw Error('SBX_CODEX_INSTALLATION_FAILED');
}
