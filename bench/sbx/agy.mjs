import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';
import { withOfflineSbx } from './runtime.mjs';

const release = {
  version: '1.5.14',
  platform: 'linux_arm64',
  url: 'https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14-5302690847260672/linux-arm/cli_linux_arm64.tar.gz',
  sha512:
    'c9b29bba475f63a1a80161ae93ba72b221c7a586d9851e4d0061546704bab66d6b2760b25d716d191724fc7564f3246456ee151e28aa37af48dbcd72bdc6c463',
  executableSha256: '702b888abddc7d482ee30592fa153cda5785afae3188179d38b511b6ec360286',
};
const guestArchive = '/tmp/sbx-agy-release.tar.gz';

async function preflight(archive, limitMs) {
  const digest = createHash('sha512');
  for await (const bytes of createReadStream(archive)) digest.update(bytes);
  if (digest.digest('hex') !== release.sha512) throw new Error('Google archive SHA-512 mismatch');
  const witness = await readFile(new URL('./agy-guest.py', import.meta.url), 'utf8');
  return withOfflineSbx({ limitMs }, async ({ copyIn, exec }) => {
    await copyIn(archive, guestArchive);
    const access = await exec(['/bin/chmod', '0444', guestArchive], { user: '0:0', cwd: '/tmp' });
    if (access.code !== 0) throw new Error('cannot make the pinned archive readable to the probe');
    const run = await exec(
      [
        '/usr/bin/env',
        '-i',
        '/usr/bin/python3',
        '-I',
        '-c',
        witness,
        guestArchive,
        release.sha512,
        release.executableSha256,
      ],
      { user: '65534:65534', cwd: '/tmp' },
    );
    if (run.code !== 0) throw new Error('agy initialization failed');
    const receipt = JSON.parse(run.stdout);
    if (receipt.session?.created !== false || receipt.session.errorCode !== -32000)
      throw new Error('SBX_EXPECTED_OFFLINE_SESSION_REFUSAL');
    return { release, guest: receipt };
  });
}

requireAdmittedRun();
const [archive, timeout] = process.argv.slice(2);
const limitMs = Number(timeout);
if (process.argv.length !== 4 || !archive || !Number.isSafeInteger(limitMs) || limitMs <= 0)
  throw new Error('usage: sbx-agy.mjs <official Linux arm64 archive> <timeout ms>');
const receipt = await preflight(archive, limitMs);
console.log(JSON.stringify(receipt, null, 2));
process.exitCode = 1;
