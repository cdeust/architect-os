import fs from 'node:fs';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StateJournal,
  privateStateDirectory,
  isStateLogTemplate,
  checkPrivateDirectory,
} from '../../src/state-journal.js';
import { Given, Then, stored, type SandboxWorld } from './helpers.js';

type Fixture = { root: string; home: string; journal: StateJournal; old: string };
const get = (world: SandboxWorld) => stored<Fixture>(world, 'state journal');
Given('an admitted state folder and a historical home log named {string}', function (file: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-journal-')));
  this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'root'),
    home = join(dir, 'home');
  mkdirSync(join(root, 'state'), { recursive: true, mode: 0o700 });
  const oldDir = join(home, '.local/state/architect-os');
  mkdirSync(oldDir, { recursive: true });
  const old = join(oldDir, file);
  writeFileSync(old, 'historical\n', { mode: 0o600 });
  this.state['state journal'] = { root, home, old, journal: new StateJournal(root, '${state}/' + file) };
});

Then('two host journal writers append while the historical file remains untouched', function () {
  const { root, old, journal } = get(this);
  writeFileSync(journal.path, 'earlier\n', { mode: 0o600 });
  journal.append('first\n');
  const next = new StateJournal(root, '${state}/' + journal.path.split('/').at(-1));
  next.append('second\n');
  assert.equal(readFileSync(journal.path, 'utf8'), 'earlier\nfirst\nsecond\n');
  assert.equal(readFileSync(old, 'utf8'), 'historical\n');
});

Then('a journal append refuses {string} without changing the historical log', function (defect: string) {
  const { root, home, old, journal } = get(this);
  const state = join(root, 'state'),
    nested = new StateJournal(root, '${state}/team/usage.jsonl');
  let tested = journal;
  switch (defect) {
    case 'a symbolic link to the historical file':
      symlinkSync(old, journal.path);
      break;
    case 'a hard link to the historical file':
      linkSync(old, journal.path);
      break;
    case 'a directory at the log path':
      mkdirSync(journal.path);
      break;
    case 'a public log':
      writeFileSync(journal.path, 'kept');
      chmodSync(journal.path, 0o644);
      break;
    case 'an absent shared state directory':
      rmSync(state, { recursive: true });
      break;
    case 'a shared state symlink':
      rmSync(state, { recursive: true });
      symlinkSync(home, state);
      break;
    case 'a public state directory':
      chmodSync(state, 0o755);
      break;
    case 'a linked intermediate directory':
      symlinkSync(home, join(state, 'team'));
      tested = nested;
      break;
    case 'a root moved behind a symlink':
      renameSync(root, join(home, 'moved'));
      symlinkSync(join(home, 'moved'), root);
      break;
    default:
      assert.fail(defect);
  }
  assert.throws(() => tested.append('new\n'));
  assert.equal(readFileSync(old, 'utf8'), 'historical\n');
  assert.equal(existsSync(join(home, 'usage.jsonl')), false);
  if (defect === 'a public log') assert.equal(readFileSync(journal.path, 'utf8'), 'kept');
});
Then('new nested state directories and their journal are private', function () {
  const { root } = get(this);
  const j = new StateJournal(root, '${state}/first/second/delivery.jsonl');
  j.append('line\n');
  j.append('line2\n');
  for (const sub of ['first', 'first/second'])
    assert.equal(statSync(join(root, 'state', sub)).mode & 0o777, 0o700);
  assert.equal(statSync(j.path).mode & 0o777, 0o600);
  assert.equal(readFileSync(j.path, 'utf8'), 'line\nline2\n');
});
Then('the state directory rejects non-component names and the filesystem root', function () {
  const { root } = get(this);
  for (const part of ['', '.', '..', 'a/b', 'a\\b', 'a\0b'])
    assert.throws(() => privateStateDirectory(root, [part]));
  assert.throws(() => privateStateDirectory('/', []));
});

Then('the host refuses to reopen a replaced or missing journal', function () {
  const { journal } = get(this);
  journal.append('original\n');
  const preserved = journal.path + '.original';
  renameSync(journal.path, preserved);
  assert.throws(() => journal.append('wrong\n'));
  assert.equal(existsSync(journal.path), false);
  writeFileSync(journal.path, 'replacement\n', { mode: 0o600 });
  assert.throws(() => journal.append('wrong\n'));
  assert.equal(readFileSync(journal.path, 'utf8'), 'replacement\n');
  assert.equal(readFileSync(preserved, 'utf8'), 'original\n');
});

Then('state templates accept only component paths below the shared state', function () {
  const { root } = get(this);
  for (const t of ['${state}/usage.jsonl', '${state}/projects/test.jsonl'])
    assert.equal(isStateLogTemplate(t), true);
  for (const t of [
    '',
    '${home}/logs',
    '/state/x',
    '${state}',
    '${state}/',
    '${state}//x',
    '${state}/x/',
    '${state}/a/../x',
    '${state}/x/.',
    '${state}/x\\bad',
    '${state}/x\0bad',
  ]) {
    assert.equal(isStateLogTemplate(t), false, t);
    assert.throws(() => new StateJournal(root, t), { message: 'invalid runtime state log path' });
  }
  for (const from of [undefined, '', 'relative'])
    assert.throws(() => new StateJournal(from, '${state}/logs'), {
      message: 'the runtime root for the log is not an absolute path',
    });
});

Then('state lookups reject unmarked spellings and preserve directory errors', function () {
  const { root } = get(this),
    state = join(root, 'state');
  for (const from of ['/', 'relative-does-not-exist', root + '/'])
    assert.throws(() => privateStateDirectory(from, []), { message: 'unsafe runtime state path' });
  const device = statSync(root, { bigint: true }).dev;
  for (const path of [state + '/.', state + '/']) {
    assert.throws(() => checkPrivateDirectory(path, device), {
      message: 'unsafe private state directory: ' + path,
    });
  }
  const regular = join(root, 'regular');
  writeFileSync(regular, '');
  chmodSync(regular, 0o700);
  assert.throws(() => checkPrivateDirectory(regular, device), {
    message: 'unsafe private state directory: ' + regular,
  });
  assert.throws(() => checkPrivateDirectory(state, device + 1n), {
    message: 'unsafe private state directory: ' + state,
  });
  const actual = fs.lstatSync,
    stat = mock.method(fs, 'lstatSync', (p: fs.PathLike) => {
      const found = actual(p, { bigint: true });
      found.uid += 1n;
      return found;
    });
  syncBuiltinESMExports();
  try {
    assert.throws(() => checkPrivateDirectory(state, device), {
      message: 'unsafe private state directory: ' + state,
    });
  } finally {
    stat.mock.restore();
    syncBuiltinESMExports();
  }
  mkdirSync(join(state, 'existing'), { mode: 0o700 });
  const denied = Object.assign(new Error('disk denied directory creation'), { code: 'EACCES' });
  const mkdir = mock.method(fs, 'mkdirSync', () => {
    throw denied;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => privateStateDirectory(root, ['existing']), denied);
    assert.deepEqual(mkdir.mock.calls[0]?.arguments, [join(state, 'existing'), { mode: 0o700 }]);
  } finally {
    mkdir.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('a private journal rejects {string} on its opened descriptor', function (fault: string) {
  const { journal } = get(this);
  writeFileSync(journal.path, 'history', { mode: 0o600 });
  const actual = fs.fstatSync;
  const fstat = mock.method(fs, 'fstatSync', (fd: number) => {
    const stat = actual(fd, { bigint: true });
    switch (fault) {
      case 'another owner':
        stat.uid += 1n;
        break;
      case 'another device':
        stat.dev += 1n;
        break;
      case 'a special file':
        stat.isFile = () => false;
        break;
      default:
        assert.fail(fault);
    }
    return stat;
  });
  const opened = mock.method(fs, 'openSync'),
    closed = mock.method(fs, 'closeSync');
  syncBuiltinESMExports();
  try {
    assert.throws(() => journal.append('danger'), { message: 'unsafe private state log: ' + journal.path });
    assert.equal(
      opened.mock.calls[0]?.arguments[1],
      fs.constants.O_WRONLY |
        fs.constants.O_APPEND |
        fs.constants.O_CREAT |
        fs.constants.O_NOFOLLOW |
        fs.constants.O_NONBLOCK,
    );
    assert.deepEqual(closed.mock.calls[0]?.arguments, [opened.mock.calls[0]?.result]);
  } finally {
    closed.mock.restore();
    opened.mock.restore();
    fstat.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(journal.path, 'utf8'), 'history');
});
Then('the journal rejects {string} after the file was opened', function (fault: string) {
  const { root, journal } = get(this),
    dir = join(root, 'state');
  writeFileSync(journal.path, 'history', { mode: 0o600 });
  const actual = fs.lstatSync,
    real = fs.realpathSync;
  let opened = false;
  const oldFstat = fs.fstatSync;
  const observation = mock.method(fs, 'fstatSync', (fd: number, options: { bigint: true }) => {
    opened = true;
    return oldFstat(fd, options);
  });
  const observe = mock.method(fs, 'lstatSync', (p: fs.PathLike) => {
    const stat = actual(p, { bigint: true });
    if (opened) {
      if (p === journal.path && fault === 'the file name moved devices') stat.dev += 1n;
      if (p === journal.path && fault === 'the file name was replaced') stat.ino += 1n;
      if (p === dir && fault === 'the parent moved devices') stat.dev += 1n;
      if (p === dir && fault === 'the parent was replaced') stat.ino += 1n;
    }
    return stat;
  });
  const canonical = mock.method(fs, 'realpathSync', (p: fs.PathLike) =>
    opened && p === dir && fault === 'the parent became a link' ? dir + '-other' : real(p),
  );
  syncBuiltinESMExports();
  try {
    assert.throws(() => journal.append('wrong'), { message: 'runtime state log changed while opening' });
  } finally {
    canonical.mock.restore();
    observe.mock.restore();
    observation.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(journal.path, 'utf8'), 'history');
});

Then('a journal refuses the same inode number on a replacement device', function () {
  const { journal } = get(this);
  journal.append('first\n');
  const originalPath = fs.lstatSync,
    originalFile = fs.fstatSync;
  const path = mock.method(fs, 'lstatSync', (path: fs.PathLike) => {
    const st = originalPath(path, { bigint: true });
    st.dev += 1n;
    return st;
  });
  const file = mock.method(fs, 'fstatSync', (fd: number) => {
    const st = originalFile(fd, { bigint: true });
    st.dev += 1n;
    return st;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => journal.append('wrong'), { message: 'runtime state log was replaced' });
  } finally {
    path.mock.restore();
    file.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(readFileSync(journal.path, 'utf8'), 'first\n');
});
