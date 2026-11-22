import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import fs, { linkSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gateReportPath, gateReportsDirectory } from '../../src/gate-reports.js';
import { Then } from './helpers.js';

Then(
  'the Gate report resolver keeps regular files and new directories under the admitted reports directory',
  function () {
    const directory = gateReportsDirectory(process.env);
    assert.equal(directory, join(process.env.ARCHITECT_OS_RUN_DIR!, 'reports'));
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    const sub = mkdtempSync(join(directory, 'paths-'));
    this.cleanups.push(() => rmSync(sub, { recursive: true, force: true }));
    const resolve = (suffix: string) =>
      gateReportPath(process.env, 'reports/' + basename(sub) + '/' + suffix);
    assert.equal(resolve('new/leaf'), join(sub, 'new/leaf'));
    mkdirSync(join(sub, 'new'));
    writeFileSync(join(sub, 'new/leaf'), 'proof');
    assert.equal(resolve('new/leaf'), join(sub, 'new/leaf'));
  },
);

Then('the Gate report resolver rejects {string}', function (kind: string) {
  if (kind === 'missing receipt') {
    assert.throws(() => gateReportsDirectory({}), /GATE_ADMISSION_REQUIRED/);
    return;
  }
  const names: Record<string, string> = {
    absolute: '/reports/sample',
    'wrong prefix': 'report/sample',
    'prefix only': 'reports',
    'empty component': 'reports/a//b',
    current: 'reports/./a',
    parent: 'reports/a/../b',
    backslash: 'reports/a\\b',
    'null byte': 'reports/a\0b',
  };
  if (kind in names) {
    assert.throws(() => gateReportPath(process.env, names[kind]!), /GATE_REPORT_PATH_INVALID/);
    return;
  }
  const sub = mkdtempSync(join(gateReportsDirectory(process.env), 'paths-'));
  this.cleanups.push(() => rmSync(sub, { recursive: true, force: true }));
  const leaf = join(sub, 'leaf'),
    other = join(sub, 'other');
  switch (kind) {
    case 'linked directory':
      mkdirSync(other);
      symlinkSync(other, leaf);
      break;
    case 'linked file':
      writeFileSync(other, 'proof');
      symlinkSync(other, leaf);
      break;
    case 'hardlinked file':
      writeFileSync(other, 'proof');
      linkSync(other, leaf);
      break;
    case 'fifo':
      assert.equal(spawnSync('mkfifo', [leaf]).status, 0);
      break;
    default:
      throw new Error(kind);
  }
  assert.throws(
    () => gateReportPath(process.env, 'reports/' + basename(sub) + '/leaf'),
    /GATE_REPORT_PATH_INVALID/,
  );
});

Then('the Gate requests private permissions when it claims its reports directory', function () {
  const directory = gateReportsDirectory(process.env);
  const make = mock.method(fs, 'mkdirSync');
  syncBuiltinESMExports();
  try {
    assert.equal(gateReportsDirectory(process.env), directory);
    assert.deepEqual(
      make.mock.calls.map(({ arguments: args }) => args),
      [[directory, { mode: 0o700 }]],
    );
  } finally {
    make.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('the Gate propagates the original report directory allocation error', function () {
  const fault = Object.assign(new Error('volume full'), { code: 'ENOSPC' });
  const make = mock.method(fs, 'mkdirSync', () => {
    throw fault;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => gateReportsDirectory(process.env),
      (error: unknown) => error === fault,
    );
  } finally {
    make.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('the Gate rejects a report directory replaced by a link during resolution', function () {
  const sub = mkdtempSync(join(gateReportsDirectory(process.env), 'path-race-'));
  this.cleanups.push(() => rmSync(sub, { recursive: true, force: true }));
  const leaf = join(sub, 'leaf'),
    moved = join(sub, 'moved');
  mkdirSync(leaf);
  const real = fs.lstatSync;
  const observe = mock.method(fs, 'lstatSync', (path: fs.PathLike, options?: { bigint: boolean }) => {
    const st = real(path, options);
    if (path === leaf) {
      fs.renameSync(leaf, moved);
      symlinkSync(moved, leaf);
    }
    return st;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => gateReportPath(process.env, 'reports/' + basename(sub) + '/leaf'),
      /GATE_REPORT_PATH_INVALID/,
    );
  } finally {
    observe.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('the Gate rejects a regular report with a different device identity', function () {
  const sub = mkdtempSync(join(gateReportsDirectory(process.env), 'path-device-'));
  this.cleanups.push(() => rmSync(sub, { recursive: true, force: true }));
  const leaf = join(sub, 'proof');
  writeFileSync(leaf, 'proof');
  const real = fs.lstatSync;
  const observe = mock.method(fs, 'lstatSync', (path: fs.PathLike, options?: { bigint: boolean }) => {
    const st = real(path, options);
    if (path === leaf && typeof st?.dev === 'bigint') st.dev += 1n;
    return st;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => gateReportPath(process.env, 'reports/' + basename(sub) + '/proof'),
      /GATE_REPORT_PATH_INVALID/,
    );
  } finally {
    observe.mock.restore();
    syncBuiltinESMExports();
  }
});
