import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { reserveStepOutputs } from '../../src/step-outputs.js';
import { Given, Then, stored, type SandboxWorld } from './helpers.js';

function paths(world: SandboxWorld) {
  const { root, run, env } = stored<{ root: string; run: string; env: NodeJS.ProcessEnv }>(
    world,
    'runtime fixture',
  );
  const intake = join(root, 'stat'),
    worktree = join(root, 'worktree'),
    state = join(root, 'state'),
    tmp = join(run, 'tmp');
  const retained = join(state, 'steps', basename(run)),
    streams = join(tmp, 'steps');
  function allocate(name: string, input = intake, candidate = worktree, environment = env) {
    return reserveStepOutputs(environment, name, input, candidate);
  }
  return { allocate, intake, worktree, state, tmp, retained, streams };
}

Given('private directories for an admitted step', function () {
  const p = paths(this);
  for (const path of [p.state, p.intake, p.worktree, p.tmp]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
});

Then('the host reserves private retained and disposable directories for distinct steps', function () {
  const p = paths(this);
  const previousMask = process.umask(0o022);
  try {
    for (const name of ['first', 'second']) {
      assert.deepEqual(p.allocate(name), {
        retained: join(p.retained, name),
        streams: join(p.streams, name),
      });
      for (const dir of [p.retained, p.streams, join(p.retained, name), join(p.streams, name)])
        assert.equal(statSync(dir).mode & 0o777, 0o700);
    }
  } finally {
    process.umask(previousMask);
  }
});
Then('repeating the step refuses and preserves its evidence', function () {
  const p = paths(this),
    file = join(p.retained, 'first', 'record.json');
  writeFileSync(file, 'original');
  assert.throws(() => p.allocate('first'), { code: 'EEXIST' });
  assert.equal(readFileSync(file, 'utf8'), 'original');
});

Then('a step refuses an unbound allocation', function () {
  const p = paths(this);
  assert.throws(() => p.allocate('first', p.intake, p.worktree, {}), { message: 'RUNTIME_ENTRY_REQUIRED' });
  assert.ok(!existsSync(p.retained) && !existsSync(p.streams));
});

Then('a step refuses outputs below or equal to the intake or candidate', function () {
  const p = paths(this);
  for (const parent of [p.state, p.tmp]) {
    assert.throws(() => p.allocate('first', parent), { message: 'Step outputs overlap an input tree' });
    assert.throws(() => p.allocate('first', p.intake, parent), {
      message: 'Step outputs overlap an input tree',
    });
  }
  for (const dir of [join(p.retained, 'first'), join(p.streams, 'first')]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    assert.throws(() => p.allocate('first', dir), { message: 'Step outputs overlap an input tree' });
    const child = join(dir, 'nested');
    mkdirSync(child);
    assert.throws(() => p.allocate('first', child), { message: 'Step outputs overlap an input tree' });
    assert.throws(() => p.allocate('first', p.intake, child), {
      message: 'Step outputs overlap an input tree',
    });
  }
});

Then('an existing link in the stream path refuses the step', function () {
  const p = paths(this);
  symlinkSync(p.intake, p.streams);
  assert.throws(() => p.allocate('first'), /unsafe private state directory/);
  assert.deepEqual(readdirSync(p.intake), []);
});

Then('existing stream evidence survives a partial reservation and its retry', function () {
  const p = paths(this),
    dir = join(p.streams, 'first'),
    file = join(dir, 'saved');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, 'original');
  assert.throws(() => p.allocate('first'), { code: 'EEXIST' });
  assert.ok(!existsSync(join(p.retained, 'first')));
  assert.throws(() => p.allocate('first'), { code: 'EEXIST' });
  assert.equal(readFileSync(file, 'utf8'), 'original');
  fs.renameSync(dir, join(p.streams, 'previous'));
  assert.equal(p.allocate('first').retained, join(p.retained, 'first'));
});

Then('a shared run temporary directory refuses the step', function () {
  const p = paths(this);
  chmodSync(p.tmp, 0o755);
  assert.throws(() => p.allocate('first'), { message: 'unsafe private state directory: ' + p.tmp });
  assert.ok(!existsSync(p.streams));
});

Then('a failed stream reservation preserves a retained directory that was {word}', function (action: string) {
  const p = paths(this),
    retained = join(p.retained, 'first'),
    stream = join(p.streams, 'first');
  const make = fs.mkdirSync;
  const error = new Error('stream reservation failed');
  const before = readdirSync('/dev/fd');
  const mkdir = mock.method(fs, 'mkdirSync', (path: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
    if (path === stream) {
      if (action === 'replaced') {
        fs.renameSync(retained, retained + '.original');
        make(retained, { mode: 0o700 });
      } else if (action === 'populated') {
        writeFileSync(join(retained, 'receipt'), 'another owner');
      } else if (action === 'removed') {
        fs.rmdirSync(retained);
      }
      throw error;
    }
    return make(path, options);
  });
  const stat = fs.fstatSync;
  const observed = mock.method(fs, 'fstatSync', (fd: number, options?: fs.StatOptions) => {
    const result = stat(fd, options);
    if (action === 'remounted' && result.isDirectory()) return { ...result, dev: BigInt(result.dev) + 1n };
    return result;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => p.allocate('first'),
      (e) => e === error,
    );
  } finally {
    mkdir.mock.restore();
    observed.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(readdirSync('/dev/fd'), before);
  if (action === 'removed') assert.ok(!existsSync(retained));
  else assert.ok(statSync(retained).isDirectory());
  if (action === 'populated') assert.equal(readFileSync(join(retained, 'receipt'), 'utf8'), 'another owner');
});
