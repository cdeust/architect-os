import assert from 'node:assert/strict';
import { access, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runOfflineProbe } from './lifecycle.mjs';
import { createWitness, readWitness } from './witness.mjs';

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sbx-qualification-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the host verifies the retained witness after shutdown and before cleanup', async (t) => {
  const dir = await workspace(t);
  const marker = Buffer.from('sample');
  await using witness = await createWitness(dir);
  assert.deepEqual(await readWitness(dir, witness, Buffer.alloc(0)), Buffer.alloc(0));
  const phases = [];
  const result = await runOfflineProbe({
    name: 'fixture',
    workspace: dir,
    run: async () => {
      phases.push('run');
      await writeFile(join(dir, 'witness.txt'), marker);
      return 'receipt';
    },
    stop: async () => {
      phases.push('stop');
    },
    verify: async (path, receipt) => {
      assert.equal(receipt, 'receipt');
      phases.push('verify');
      return readWitness(path, witness, marker);
    },
  });
  assert.deepEqual(result, marker);
  assert.deepEqual(phases, ['run', 'stop', 'verify']);
  await assert.rejects(access(dir), { code: 'ENOENT' });
});

test('replacing the witness with another regular file containing the same bytes is refused', async (t) => {
  const dir = await workspace(t);
  const path = join(dir, 'witness.txt');
  await using witness = await createWitness(dir);
  const next = join(dir, 'replacement');
  await writeFile(next, '');
  await rename(next, path);
  await assert.rejects(readWitness(dir, witness, Buffer.alloc(0)), { message: 'SBX_WITNESS_REPLACED' });
});

test('size and content refusals disclose only a fixed diagnostic', async (t) => {
  const dir = await workspace(t);
  const path = join(dir, 'witness.txt');
  await using witness = await createWitness(dir);
  const expected = Buffer.from('marker');
  await writeFile(path, 'different length');
  await assert.rejects(readWitness(dir, witness, expected), { message: 'SBX_WITNESS_SIZE_MISMATCH' });
  await writeFile(path, 'absent');
  await assert.rejects(readWitness(dir, witness, expected), { message: 'SBX_WITNESS_CONTENT_MISMATCH' });
});

test('an unconfirmed stop retains the mount and both original failures', async (t) => {
  const dir = await workspace(t);
  const probe = Error('probe failure');
  const shutdown = Error('shutdown failure');
  await assert.rejects(
    runOfflineProbe({
      name: 'fixture',
      workspace: dir,
      run: async () => {
        throw probe;
      },
      stop: async () => {
        throw shutdown;
      },
      verify: () => assert.fail('verification ran with unknown VM state'),
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [probe, shutdown]);
      assert.ok(error.message.includes(dir) && error.message.includes('fixture'));
      return true;
    },
  );
  await access(dir);
});

for (const failedPhase of ['run', 'verify']) {
  test('a confirmed stop cleans the workspace after failure in ' + failedPhase, async (t) => {
    const dir = await workspace(t);
    const failure = Error(failedPhase);
    const succeed = async () => {};
    await assert.rejects(
      runOfflineProbe({
        name: 'fixture',
        workspace: dir,
        run: succeed,
        stop: succeed,
        verify: succeed,
        [failedPhase]: async () => {
          throw failure;
        },
      }),
      (error) => error === failure,
    );
    await assert.rejects(access(dir), { code: 'ENOENT' });
  });
}
