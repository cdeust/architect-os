import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { Then } from '@cucumber/cucumber';
import type { SpecHostJournal } from '@architect-os/contracts';
import { openPlanningJournal } from '../../src/infrastructure/planning-journal.js';

function inDirectory(run: (parent: string, directory: string) => void) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'spec-journal-')));
  try {
    run(parent, join(parent, 'run'));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

function withWriter(run: (writer: ReturnType<typeof openPlanningJournal>) => void) {
  inDirectory((_parent, directory) => {
    const writer = openPlanningJournal(directory);
    try {
      run(writer);
    } finally {
      writer.release();
    }
  });
}

const state: SpecHostJournal = { version: 1, config_sha256: 'a'.repeat(64), history: [] };

Then('a released planning journal can be resumed from disk', function () {
  inDirectory((_parent, directory) => {
    const writer = openPlanningJournal(directory);
    assert.equal(writer.home, directory);
    assert.equal(writer.load(), undefined);
    writer.save(state);
    const resumedState = { ...state, run_id: 'run_local_fixture' };
    writer.save(resumedState);
    writer.writeArtifact('Plan_2.final-v1', 'révisé\n');
    writer.release();

    const resumed = openPlanningJournal(directory);
    assert.deepEqual(resumed.load(), resumedState);
    assert.deepEqual(resumed.readArtifact('Plan_2.final-v1'), Buffer.from('révisé\n'));
    assert.equal(fs.statSync(join(directory, '.host.json')).mode & 0o777, 0o600);
    resumed.release();
    assert.deepEqual(fs.readdirSync(directory).sort(), [
      '.host.json',
      '.lease-1',
      '.lease-1.done',
      '.lease-2',
      '.lease-2.done',
      'Plan_2.final-v1',
    ]);
    assert.equal(fs.readFileSync(join(directory, '.lease-2.done')).length, 0);
  });
});

Then('a planning journal refuses state containing {string}', function (content: string) {
  withWriter((writer) => {
    const valid = JSON.stringify(state);
    const bytes =
      content === 'malformed UTF-8'
        ? Buffer.concat([Buffer.from(valid.slice(0, -1)), Buffer.from([0xff])])
        : content === 'a byte order mark'
          ? Buffer.from('\uFEFF' + valid)
          : Buffer.from('{}');
    fs.writeFileSync(join(writer.home, '.host.json'), bytes, { mode: 0o600 });
    if (content === 'malformed UTF-8') assert.throws(() => writer.load(), TypeError);
    else if (content === 'a byte order mark') assert.throws(() => writer.load(), SyntaxError);
    else assert.throws(() => writer.load(), { name: 'ZodError' });
  });
});

Then(
  'the planning journal rejects a {string} directory with {string}',
  function (location: string, error: string) {
    inDirectory((parent, directory) => {
      let target = directory;
      if (location === 'checkout ancestor') {
        fs.writeFileSync(join(parent, '.git'), 'gitdir: example');
      } else if (location === 'symlinked parent') {
        fs.mkdirSync(join(parent, 'physical'));
        fs.writeFileSync(join(parent, 'physical', '.git'), 'gitdir: example');
        fs.symlinkSync(join(parent, 'physical'), directory);
        target = join(directory, 'child');
      } else if (location === 'group writable parent') {
        fs.chmodSync(parent, 0o770);
      } else if (location === 'shared target') {
        fs.mkdirSync(directory);
        fs.chmodSync(directory, 0o750);
      } else {
        fs.mkdirSync(join(parent, 'physical'));
        fs.symlinkSync(join(parent, 'physical'), directory);
      }
      assert.throws(() => openPlanningJournal(target), { message: error });
      assert.equal(fs.existsSync(join(target, '.lease-1')), false);
    });
  },
);

Then('the planning journal accepts a sticky parent and keeps the target private', function () {
  inDirectory((parent, directory) => {
    fs.chmodSync(parent, 0o1777);
    const writer = openPlanningJournal(directory);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    writer.release();
  });
});

Then('the planning journal refuses to read a {string} artifact', function (kind: string) {
  withWriter((writer) => {
    const artifact = join(writer.home, 'plan');
    if (kind === 'name with a slash') {
      assert.throws(() => writer.readArtifact('plan/child'), { message: 'SPEC_ARTIFACT_PATH_REFUSED' });
      return;
    }
    if (kind === 'directory') fs.mkdirSync(artifact, { mode: 0o700 });
    else {
      writer.writeArtifact('plan', 'content');
      if (kind === 'group readable') fs.chmodSync(artifact, 0o640);
      if (kind === 'world writable') fs.chmodSync(artifact, 0o602);
    }
    const uid = process.getuid!();
    const owner =
      kind === 'different owner'
        ? mock.method(process as NodeJS.Process & { getuid(): number }, 'getuid', () => uid + 1)
        : undefined;
    try {
      assert.throws(() => writer.readArtifact('plan'), { message: 'SPEC_JOURNAL_FILE_UNSAFE' });
    } finally {
      owner?.mock.restore();
    }
  });
});

Then('the planning journal handles a lease owner probe returning {string}', function (code: string) {
  inDirectory((_parent, directory) => {
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(join(directory, '.lease-3'), '1', { mode: 0o600 });
    for (const name of ['other.lease-42', '.lease-57.done']) fs.writeFileSync(join(directory, name), '');
    const error = Object.assign(new Error('probe failed'), { code });
    const probe = mock.method(process, 'kill', (pid: number, signal: number) => {
      assert.deepEqual([pid, signal], [1, 0]);
      throw error;
    });
    try {
      if (code === 'ESRCH') {
        const writer = openPlanningJournal(directory);
        writer.release();
        assert.equal(fs.readFileSync(join(directory, '.lease-4'), 'utf8'), String(process.pid));
      } else {
        if (code === 'EPERM')
          assert.throws(() => openPlanningJournal(directory), { message: 'SPEC_JOURNAL_IN_USE' });
        else
          assert.throws(
            () => openPlanningJournal(directory),
            (caught) => caught === error,
          );
        assert.equal(fs.existsSync(join(directory, '.lease-4')), false);
      }
      assert.equal(probe.mock.callCount(), 1);
    } finally {
      probe.mock.restore();
    }
  });
});

Then('the planning journal refuses a saved owner PID of {string}', function (pid: string) {
  inDirectory((_parent, directory) => {
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(join(directory, '.lease-1'), pid, { mode: 0o600 });
    assert.throws(() => openPlanningJournal(directory), { message: 'SPEC_JOURNAL_LEASE_INVALID' });
    assert.equal(fs.existsSync(join(directory, '.lease-2')), false);
  });
});

Then('the planning journal refuses to advance the last safe generation', function () {
  inDirectory((_parent, directory) => {
    fs.mkdirSync(directory, { mode: 0o700 });
    const generation = '.lease-' + Number.MAX_SAFE_INTEGER;
    fs.writeFileSync(join(directory, generation), String(process.pid), { mode: 0o600 });
    fs.writeFileSync(join(directory, generation + '.done'), '');
    assert.throws(() => openPlanningJournal(directory), { message: 'SPEC_JOURNAL_LEASE_INVALID' });
  });
});

Then('the planning journal handles a lease link failure of {string}', function (code: string) {
  inDirectory((_parent, directory) => {
    const error = Object.assign(new Error('link failed'), { code });
    const publication = mock.method(fs, 'linkSync', () => {
      throw error;
    });
    syncBuiltinESMExports();
    try {
      if (code === 'EEXIST')
        assert.throws(() => openPlanningJournal(directory), { message: 'SPEC_JOURNAL_IN_USE' });
      else
        assert.throws(
          () => openPlanningJournal(directory),
          (caught) => caught === error,
        );
      assert.deepEqual(fs.readdirSync(directory), []);
    } finally {
      publication.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

Then('the planning journal refuses a platform without getuid', function () {
  inDirectory((_parent, directory) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'getuid')!;
    Object.defineProperty(process, 'getuid', { ...descriptor, value: undefined });
    try {
      assert.throws(() => openPlanningJournal(directory), { message: 'SPEC_JOURNAL_PLATFORM_UNSUPPORTED' });
      assert.equal(fs.existsSync(directory), false);
    } finally {
      Object.defineProperty(process, 'getuid', descriptor);
    }
  });
});

Then('a planning journal persists and closes files and directories across publication', function () {
  inDirectory((_parent, directory) => {
    const events: string[] = [];
    const fsync = fs.fsyncSync;
    const close = fs.closeSync;
    const kind = (fd: number) => (fs.fstatSync(fd).isDirectory() ? 'directory' : 'file');
    const synced = mock.method(fs, 'fsyncSync', (fd: number) => {
      events.push('sync ' + kind(fd));
      fsync(fd);
    });
    const closed = mock.method(fs, 'closeSync', (fd: number) => {
      events.push('close ' + kind(fd));
      close(fd);
    });
    syncBuiltinESMExports();
    try {
      const writer = openPlanningJournal(directory);
      const publish = ['sync file', 'close file', 'sync directory', 'close directory'];
      assert.deepEqual(events, ['sync directory', 'close directory', ...publish]);
      events.length = 0;
      writer.writeArtifact('proof', 'complete');
      assert.deepEqual(events, publish);
      events.length = 0;
      assert.deepEqual(writer.readArtifact('proof'), Buffer.from('complete'));
      assert.deepEqual(events, ['close file']);
      writer.release();
      assert.throws(() => writer.release(), { code: 'EEXIST' });
    } finally {
      closed.mock.restore();
      synced.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

Then(
  'the planning journal propagates a {string} failure before taking a lease',
  function (operation: string) {
    inDirectory((_parent, directory) => {
      const sentinel =
        operation === 'non-system inspection error'
          ? { code: 'ENOENT' }
          : Object.assign(new Error('access denied'), { code: 'EACCES' });
      const lstat = fs.lstatSync;
      const fault =
        operation === 'creation denied'
          ? mock.method(fs, 'mkdirSync', () => {
              throw sentinel;
            })
          : mock.method(fs, 'lstatSync', (path: fs.PathLike) => {
              if (path === join(directory, '.git')) throw sentinel;
              return lstat(path);
            });
      syncBuiltinESMExports();
      try {
        assert.throws(
          () => openPlanningJournal(directory),
          (caught) => caught === sentinel,
        );
        assert.equal(fs.existsSync(directory), false);
      } finally {
        fault.mock.restore();
        syncBuiltinESMExports();
      }
    });
  },
);

Then(
  'the planning journal rejects a {string} metadata change during acquisition',
  function (metadata: string) {
    inDirectory((parent, directory) => {
      fs.mkdirSync(directory, { mode: 0o700 });
      const changed = metadata === 'foreign target' ? directory : parent;
      const lstat = fs.lstatSync;
      const probe = mock.method(fs, 'lstatSync', (path: fs.PathLike) => {
        const actual = lstat(path);
        if (path === changed) {
          if (metadata === 'replaced ancestor') actual.isDirectory = () => false;
          else actual.uid = process.getuid!() + 1;
        }
        return actual;
      });
      syncBuiltinESMExports();
      try {
        assert.throws(() => openPlanningJournal(directory), { message: 'SPEC_JOURNAL_DIRECTORY_UNSAFE' });
        assert.deepEqual(fs.readdirSync(directory), []);
      } finally {
        probe.mock.restore();
        syncBuiltinESMExports();
      }
    });
  },
);

Then('the planning journal requests a private directory from the operating system', function () {
  inDirectory((_parent, directory) => {
    const mask = process.umask(0o000);
    try {
      const writer = openPlanningJournal(directory);
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
      writer.release();
    } finally {
      process.umask(mask);
    }
  });
});

Then('an artifact appearing during publication is preserved', function () {
  withWriter((writer) => {
    const artifact = join(writer.home, 'review.json');
    const lstat = fs.lstatSync;
    const inspection = mock.method(fs, 'lstatSync', (path: fs.PathLike) => {
      try {
        return lstat(path);
      } catch (error) {
        if (path === artifact) fs.writeFileSync(artifact, 'other publisher', { mode: 0o600, flag: 'wx' });
        throw error;
      }
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => writer.writeArtifact('review.json', 'new publisher'), { code: 'EEXIST' });
      assert.deepEqual(writer.readArtifact('review.json'), Buffer.from('other publisher'));
    } finally {
      inspection.mock.restore();
      syncBuiltinESMExports();
    }
  });
});
