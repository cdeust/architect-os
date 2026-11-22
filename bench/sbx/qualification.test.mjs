import assert from 'node:assert/strict';
import { access, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runOfflineProbe, stopOwnedVm, useUntilInterrupted } from './lifecycle.mjs';
import { createWitness, readWitness } from './witness.mjs';
import isolation from './isolation.json' with { type: 'json' };
import { requireSbxBindings } from './runtime.mjs';

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

test('a timed-out creation and an empty list retain the named mount for recovery', async (t) => {
  const dir = await workspace(t);
  const failure = Error('creation RPC timed out');
  await assert.rejects(
    runOfflineProbe({
      name: 'delayed-vm',
      workspace: dir,
      run: async () => {
        throw failure;
      },
      stop: () =>
        stopOwnedVm(
          'delayed-vm',
          'requested',
          async () => [],
          () => assert.fail('unknown VM removed'),
        ),
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], failure);
      assert.equal(error.errors[1].message, 'SBX_CREATE_UNCONFIRMED');
      assert.ok(error.message.includes(dir) && error.message.includes('delayed-vm'));
      return true;
    },
  );
  await access(dir);
});

test('a visible VM after an ambiguous creation is removed by its exact name and checked again', async () => {
  let present = true;
  let lists = 0;
  await stopOwnedVm(
    'owned-vm',
    'requested',
    async () => {
      lists++;
      return present ? ['another-vm', 'owned-vm'] : ['another-vm'];
    },
    async (name) => {
      assert.equal(name, 'owned-vm');
      present = false;
    },
  );
  assert.equal(lists, 2);
});

test('cancellation revokes an idle consumer and waits for the active command to settle', async () => {
  const controller = new AbortController();
  const ready = Promise.withResolvers();
  const command = Promise.withResolvers();
  const reason = Error('interrupted');
  let capability;
  const running = useUntilInterrupted(controller.signal, 5000, (start) => {
    capability = start;
    start(() => command.promise);
    ready.resolve();
    return new Promise(() => {});
  });
  await ready.promise;
  controller.abort(reason);
  assert.throws(
    () => capability(() => assert.fail('ran after interruption')),
    (error) => error === reason,
  );
  let released = false;
  const rejected = assert.rejects(running, (error) => {
    released = true;
    return error === reason;
  });
  await new Promise(setImmediate);
  assert.equal(released, false);
  command.resolve();
  await rejected;
});

test('a retained capability cannot dispatch work after a successful probe', async () => {
  const capability = await useUntilInterrupted(new AbortController().signal, 5000, (start) => start);
  assert.throws(() => capability(() => assert.fail('ran after probe')), { message: 'SBX_CAPABILITY_CLOSED' });
});

test('a consumer blocked after VM creation expires, cancels its pending work and releases the mount', async (t) => {
  const dir = await workspace(t);
  const phases = [];
  await assert.rejects(
    runOfflineProbe({
      name: 'owned',
      workspace: dir,
      run: () =>
        useUntilInterrupted(new AbortController().signal, 35, (start, signal) => {
          start(
            () =>
              new Promise((resolve) =>
                signal.addEventListener(
                  'abort',
                  () => {
                    phases.push('cancelled');
                    resolve();
                  },
                  { once: true },
                ),
              ),
          );
          return new Promise(() => {});
        }),
      stop: async () => {
        phases.push('stopped');
      },
      verify: () => assert.fail('expired consumer was accepted'),
    }),
    { message: 'SBX_USE_TIMEOUT' },
  );
  assert.deepEqual(phases, ['cancelled', 'stopped']);
  await assert.rejects(access(dir), { code: 'ENOENT' });
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

test('the runtime attests the installed base image and shell kit independently', () => {
  const name = 'probe';
  const workspace = '/admitted/workspace';
  const required = {
    name,
    workspace,
    agent: 'shell',
    image_digest: isolation.shellTemplate.split('@')[1],
    kits: [isolation.shellKit],
    mcp_mode: 'static',
    mcp_servers: [],
    runtime_mounts: [],
    host_mounts: [{ host_path: workspace, container_target: workspace, read_only: false }],
  };
  requireSbxBindings(required, name, workspace);
  for (const change of [
    { agent: 'other' },
    { image_digest: undefined },
    { image_digest: 'sha256:' + '0'.repeat(64) },
    { image: isolation.shellTemplate, image_digest: null },
    { kits: [isolation.shellTemplate] },
    { kits: [] },
    { kits: [isolation.shellKit, 'extra'] },
    { host_mounts: [] },
  ]) {
    assert.throws(() => requireSbxBindings({ ...required, ...change }, name, workspace), {
      message: 'SBX_FIXTURE_BINDING_MISMATCH',
    });
  }
});
