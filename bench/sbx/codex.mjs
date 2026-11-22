// Run from this repository with ./aos -- node bench/sbx/codex.mjs <0.170.0-linux-arm64.tgz>.
// The Linux tarball is @openai/codex@0.170.0-linux-arm64 from the npm registry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';
import { withOfflineSbx } from './runtime.mjs';

const expectedArchive =
  'mJLm5eia/GcukCrRfVEnYVD5dOXGE7cmpd9dJ/ixkSiKifzDAPaGq83ZEmwVhk3PxbdTPUSLRpnXZQKbNS5HoA==';
const expectedMarker = 'architect-os-sbx-b0\n';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function run(archive) {
  if (!archive) throw new Error('expected the pinned Codex Linux ARM64 npm tarball');
  const digest = createHash('sha512');
  for await (const bytes of createReadStream(archive)) digest.update(bytes);
  assert.equal(digest.digest('base64'), expectedArchive, 'unexpected Codex archive digest');
  const guest = fileURLToPath(new URL('./codex-guest.py', import.meta.url));
  const start = performance.now();
  const evidence = await withOfflineSbx(
    {
      limitMs: 180_000,
      async prepare(workspace) {
        await chmod(workspace, 0o700);
        await writeFile(join(workspace, 'witness.txt'), '', { flag: 'wx', mode: 0o600 });
      },
    },
    async ({ workspace, copyIn, exec }) => {
      await copyIn(archive, '/tmp/aos-b0-codex.tgz');
      await copyIn(guest, '/tmp/aos-b0-codex-guest.py');
      const argv = [
        '/usr/bin/env',
        '-i',
        'PATH=/usr/bin:/bin',
        'LANG=C.UTF-8',
        '/usr/bin/python3',
        '/tmp/aos-b0-codex-guest.py',
      ];
      const setup = await exec([...argv, 'install'], { user: '0:0' });
      if (setup.code !== 0) throw new Error('Codex fixture installation failed: ' + setup.stderr);
      const witness = join(workspace, 'witness.txt');
      const before = await readFile(witness);
      assert.equal(before.length, 0);
      const original = await lstat(witness);
      const result = await exec([...argv, 'probe'], { user: '65534:65534', cwd: workspace });
      const after = await readFile(witness);
      const current = await lstat(witness);
      assert.deepEqual(await readdir(workspace), ['witness.txt'], 'unexpected external workspace delta');
      assert.ok(
        current.isFile() && current.dev === original.dev && current.ino === original.ino,
        'witness replaced',
      );
      if (result.code !== 0) throw new Error('Codex fixture failed: ' + result.stdout + result.stderr);
      assert.equal(after.toString(), expectedMarker);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.client_version, 'codex-cli 0.170.0');
      assert.equal(receipt.requests, 2);
      assert.equal(receipt.tool_reply, true);
      assert.equal(receipt.rejected_request, false);
      assert.equal(receipt.terminal, true);
      assert.equal(receipt.client_exit, 0);
      assert.deepEqual(receipt.usage, { input_tokens: 8, output_tokens: 4 });
      return { ...receipt, external_witness_before: sha256(before), external_witness_after: sha256(after) };
    },
  );
  return { ...evidence, elapsed_ms: Math.round(performance.now() - start) };
}

requireAdmittedRun();
if (process.argv.length !== 3) throw new Error('usage: sbx-codex.mjs <codex-0.170.0-linux-arm64.tgz>');
console.log(JSON.stringify(await run(resolve(process.argv[2]))));
