// Run from this repository with ./aos -- node bench/sbx/codex.mjs <0.170.0-linux-arm64.tgz>.
// The Linux tarball is @openai/codex@0.170.0-linux-arm64 from the npm registry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';
import { codexGuest, installCodex, verifyArchive } from './codex-client.mjs';
import { withOfflineSbx } from './runtime.mjs';
import { createWitness, readWitness } from './witness.mjs';

const expectedMarker = 'architect-os-sbx-b0\n';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function run(archive) {
  await verifyArchive(archive);
  const start = performance.now();
  await using resources = new AsyncDisposableStack();
  let witness;
  let beforeHash;
  const evidence = await withOfflineSbx(
    {
      limitMs: 180_000,
      async prepare(workspace) {
        witness = resources.use(await createWitness(workspace));
        beforeHash = sha256(await readWitness(workspace, witness, Buffer.alloc(0)));
      },
      async verify(workspace, receipt) {
        const after = await readWitness(workspace, witness, Buffer.from(expectedMarker));
        return { guest: receipt, external_witness_before: beforeHash, external_witness_after: sha256(after) };
      },
    },
    async ({ workspace, copyIn, exec }) => {
      await installCodex({ copyIn, exec }, archive);
      const result = await exec(codexGuest('probe'), { user: '65534:65534', cwd: workspace });
      if (result.code !== 0) throw new Error('Codex fixture failed');
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.client_version, 'codex-cli 0.170.0');
      assert.equal(receipt.requests, 2);
      assert.equal(receipt.tool_reply, true);
      assert.equal(receipt.rejected_request, false);
      assert.equal(receipt.terminal, true);
      assert.equal(receipt.client_exit, 0);
      assert.deepEqual(receipt.usage, { input_tokens: 8, output_tokens: 4 });
      return receipt;
    },
  );
  return { ...evidence, elapsed_ms: Math.round(performance.now() - start) };
}

requireAdmittedRun();
if (process.argv.length !== 3) throw new Error('usage: sbx-codex.mjs <codex-0.170.0-linux-arm64.tgz>');
console.log(JSON.stringify(await run(resolve(process.argv[2]))));
