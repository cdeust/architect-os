import assert from 'node:assert/strict';
import fs, {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
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
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { publishGateReceipt, readGateReceipt } from '../../src/gate-receipt.js';
import { Given, Then, stored } from './helpers.js';

const sha = 'd'.repeat(40),
  another = 'b'.repeat(40);
const value = JSON.stringify({ job: 'linux', sha, count: 1, pickles: ['test'] });
const report = '# Porte de test, job linux : VERTE\n\n- tête : ' + sha + '\n';
const hash = (a: string, b: string) =>
  createHash('sha256')
    .update(JSON.stringify([a, b]))
    .digest('hex');
type Fixture = { dir: string; root: string; tree: string; run: string; file: string };
const write = (r: Fixture, a = sha, b = value, c = report) =>
  publishGateReceipt(r.root, r.tree, r.run, a, b, c);
Given('a private Gate state and a checkout with a green Linux proof', function () {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-receipt-'))),
    root = join(dir, 'root'),
    tree = join(dir, 'work'),
    run = join(root, 'run', 'rAbCd12');
  for (const p of [join(root, 'state'), tree, run]) mkdirSync(p, { recursive: true, mode: 0o700 });
  const st = statSync(tree, { bigint: true });
  this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  this.state['receiptFixture'] = {
    dir,
    root,
    tree,
    run,
    file: join(root, 'state', 'gate', st.dev + '-' + st.ino, 'latest.json'),
  };
});
Then('the Gate receipt carries the original report, base, commit and directory identities', function () {
  const r = stored<Fixture>(this, 'receiptFixture');
  assert.equal(readGateReceipt(r.root, r.tree), undefined);
  assert.equal(existsSync(join(r.root, 'state', 'gate')), false);
  write(r);
  const identity = (p: string) => {
    const st = statSync(p, { bigint: true });
    return { device: String(st.dev), inode: String(st.ino) };
  };
  assert.deepEqual(JSON.parse(readFileSync(r.file, 'utf8')), {
    version: 'architect-os-gate/v1',
    job: 'linux',
    sha,
    run: 'rAbCd12',
    base: value,
    report,
    digest: hash(value, report),
    root: identity(r.root),
    checkout: identity(r.tree),
  });
  assert.equal(statSync(r.file).mode & 0o777, 0o600);
  symlinkSync(r.tree, join(r.dir, 'alias'));
  assert.equal(readGateReceipt(r.root, join(r.dir, 'alias')), sha);
  const secondReport = report.replace(sha, another),
    secondBase = value.replace(sha, another);
  write(r, another, secondBase, secondReport);
  rmSync(r.run, { recursive: true });
  assert.equal(readGateReceipt(r.root, r.tree), another);
  assert.deepEqual(fs.readdirSync(dirname(r.file)), ['latest.json']);
});
Then(
  'the Gate refuses to publish an invalid {string} and keeps its previous receipt',
  function (kind: string) {
    const r = stored<Fixture>(this, 'receiptFixture');
    write(r);
    const doc = JSON.parse(value);
    let actualSha = sha,
      text = report,
      run = r.run;
    let root = r.root,
      tree = r.tree;
    switch (kind) {
      case 'job':
        doc.job = 'macos';
        break;
      case 'base commit':
        doc.sha = another;
        break;
      case 'count':
        doc.count = 2;
        break;
      case 'negative count':
        doc.count = -1;
        break;
      case 'shape':
        doc.extra = true;
        break;
      case 'pickles':
        doc.pickles = [9];
        break;
      case 'sha':
        actualSha = 'BAD';
        break;
      case 'red report':
        text = text.replace('VERTE', 'ROUGE');
        break;
      case 'report commit':
        text = text.replace(sha, another);
        break;
      case 'workflow prefix':
        text = 'discard\n' + text;
        break;
      case 'report line':
        text = text.replace('- tête :', 'another - tête :');
        break;
      case 'run directory':
        run = join(r.dir, 'rAbCd12');
        break;
      case 'run name':
        run = join(root, 'run', 'xAbCd12');
        break;
      case 'regular checkout':
        tree = join(r.dir, 'regular');
        writeFileSync(tree, '');
        break;
      case 'regular root':
        root = join(r.dir, 'regular');
        writeFileSync(root, '');
        run = join(root, 'run', 'rAbCd12');
        break;
      default:
        assert.fail(kind);
    }
    assert.throws(() => publishGateReceipt(root, tree, run, actualSha, JSON.stringify(doc), text));
    assert.equal(readGateReceipt(r.root, r.tree), sha);
  },
);
Then('the Gate reader refuses a {string} receipt', function (kind: string) {
  const r = stored<Fixture>(this, 'receiptFixture');
  write(r);
  const record = JSON.parse(readFileSync(r.file, 'utf8'));
  let root = r.root,
    tree = r.tree;
  const other = join(r.dir, 'other');
  switch (kind) {
    case 'version':
      record.version = 'v0';
      break;
    case 'job':
      record.job = 'macos';
      break;
    case 'commit':
      record.sha = another;
      break;
    case 'run identifier':
      record.run = 'r!';
      break;
    case 'uppercase sha':
      record.sha = 'A'.repeat(40);
      break;
    case 'malformed sha prefix':
      record.sha = 'x' + sha;
      break;
    case 'malformed sha suffix':
      record.sha = sha + 'x';
      break;
    case 'root device':
      record.root.device += '1';
      break;
    case 'root inode':
      record.root.inode += '1';
      break;
    case 'checkout device':
      record.checkout.device += '1';
      break;
    case 'checkout inode':
      record.checkout.inode += '1';
      break;
    case 'digest':
      record.digest = 'a'.repeat(64);
      break;
    case 'report bytes':
      record.report += 'changed';
      break;
    case 'base bytes':
      record.base += ' ';
      break;
    case 'green digest over red bytes':
      record.report = record.report.replace('VERTE', 'ROUGE');
      record.digest = hash(record.base, record.report);
      break;
    case 'extra field':
      record.extra = 'v';
      break;
    case 'linked directory':
      renameSync(dirname(r.file), other);
      symlinkSync(other, dirname(r.file));
      break;
    case 'linked root':
      symlinkSync(root, other);
      root = other;
      break;
    case 'separate checkout':
      mkdirSync(other);
      tree = other;
      break;
    case 'hardlinked':
      linkSync(r.file, other);
      break;
    case 'linked':
      renameSync(r.file, other);
      symlinkSync(other, r.file);
      break;
    case 'readable by another account':
      chmodSync(r.file, 0o644);
      break;
    case 'extra permission bits':
      chmodSync(r.file, 0o1600);
      break;
    case 'malformed':
      writeFileSync(r.file, '{');
      break;
    case 'directory at latest':
      rmSync(r.file);
      mkdirSync(r.file);
      break;
    default:
      assert.fail(kind);
  }
  if (
    [
      'version',
      'job',
      'commit',
      'run identifier',
      'uppercase sha',
      'malformed sha prefix',
      'malformed sha suffix',
      'root device',
      'root inode',
      'checkout device',
      'checkout inode',
      'digest',
      'report bytes',
      'base bytes',
      'green digest over red bytes',
      'extra field',
    ].includes(kind)
  )
    writeFileSync(r.file, JSON.stringify(record));
  assert.equal(readGateReceipt(root, tree), undefined);
});
Then('a failed Gate publication keeps the previous receipt and removes its partial copy', function () {
  const r = stored<Fixture>(this, 'receiptFixture');
  write(r);
  const seen: { fd: number; mode: number; flags: number }[] = [];
  const rawOpen = fs.openSync;
  const hook = mock.method(fs, 'openSync', (path: fs.PathLike, flags: number, mode?: number) => {
    const fd = rawOpen(path, flags, mode);
    if (String(path).includes('publish-')) seen.push({ fd, mode: mode!, flags });
    return fd;
  });
  const rename = mock.method(fs, 'renameSync', () => {
    throw Error('fixture publish failure');
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => write(r), /fixture publish failure/);
  } finally {
    hook.mock.restore();
    rename.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(
    seen.map(({ mode, flags }) => [mode, flags]),
    [[0o600, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW]],
  );
  assert.throws(() => fs.fstatSync(seen[0]!.fd), { code: 'EBADF' });
  assert.deepEqual(fs.readdirSync(dirname(r.file)), ['latest.json']);
  assert.equal(readGateReceipt(r.root, r.tree), sha);
});

Then('the retained Gate receipt exercises {string}', function (kind: string) {
  const r = stored<Fixture>(this, 'receiptFixture');
  if (kind === 'invalid directory message') {
    const file = join(r.dir, 'file');
    writeFileSync(file, '');
    assert.throws(
      () => publishGateReceipt(r.root, file, r.run, sha, value, report),
      /GATE_RECEIPT_DIRECTORY_INVALID/,
    );
    return;
  }
  if (kind === 'invalid proof message') {
    assert.throws(() => write(r, sha, value, 'red'), /GATE_RECEIPT_PROOF_INVALID/);
    return;
  }
  if (kind === 'incomplete hash prefix' || kind === 'incomplete hash suffix') {
    const bad = kind.endsWith('prefix') ? 'x' + sha : sha + 'x';
    assert.throws(() => write(r, bad, value.replace(sha, bad), report.replace(sha, bad)));
    return;
  }
  if (kind === 'run prefix' || kind === 'run suffix') {
    const name = kind.endsWith('prefix') ? 'xrAbCd12' : 'rAbCd12x';
    assert.throws(() => publishGateReceipt(r.root, r.tree, join(r.root, 'run', name), sha, value, report));
    return;
  }
  if (kind === 'private durability') {
    const opened = new Map<number, string>();
    const events: string[] = [];
    const rawOpen = fs.openSync,
      rawClose = fs.closeSync,
      rawSync = fs.fsyncSync,
      rawRename = fs.renameSync;
    const a = mock.method(fs, 'openSync', (path: fs.PathLike, flags: number, mode?: number) => {
      const fd = rawOpen(path, flags, mode);
      if (String(path).includes('/publish-') || String(path) === dirname(r.file)) {
        const directory = String(path) === dirname(r.file);
        assert.equal(
          flags,
          directory
            ? fs.constants.O_DIRECTORY | fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
            : fs.constants.O_NOFOLLOW | fs.constants.O_EXCL | fs.constants.O_CREAT | fs.constants.O_WRONLY,
        );
        opened.set(fd, directory ? 'parent' : 'file');
        events.push('open ' + opened.get(fd));
      }
      return fd;
    });
    const b = mock.method(fs, 'fsyncSync', (fd: number) => {
      events.push('sync ' + opened.get(fd));
      rawSync(fd);
    });
    const c = mock.method(fs, 'closeSync', (fd: number) => {
      if (opened.has(fd)) {
        events.push('close ' + opened.get(fd));
        opened.delete(fd);
      }
      rawClose(fd);
    });
    const d = mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
      assert.equal(to, r.file);
      events.push('rename');
      rawRename(from, to);
    });
    syncBuiltinESMExports();
    try {
      write(r);
    } finally {
      for (const hook of [a, b, c, d]) hook.mock.restore();
      syncBuiltinESMExports();
    }
    assert.deepEqual(events, [
      'open file',
      'sync file',
      'close file',
      'rename',
      'open parent',
      'sync parent',
      'close parent',
    ]);
    assert.equal(opened.size, 0);
    return;
  }
  if (kind === 'missing receipt') {
    mkdirSync(dirname(r.file), { recursive: true, mode: 0o700 });
    assert.equal(readGateReceipt(r.root, r.tree), undefined);
    return;
  }
  write(r);
  if (kind === 'unsafe state directory') {
    chmodSync(dirname(r.file), 0o755);
    assert.equal(readGateReceipt(r.root, r.tree), undefined);
    return;
  }
  const rawFstat = fs.fstatSync,
    rawLstat = fs.lstatSync,
    rawRead = fs.readFileSync,
    rawReal = fs.realpathSync,
    rawClose = fs.closeSync;
  const close: number[] = [];
  let descriptor = -1,
    read = false;
  const hooks = [
    mock.method(fs, 'lstatSync', (path: fs.PathLike, opt?: { bigint?: boolean }) => {
      if (kind === 'physical identities' && (path === r.root || path === r.tree))
        assert.equal(opt?.bigint, true);
      const st = rawLstat(path, { bigint: true });
      if (path === r.file && kind === 'changed named inode') st.ino += 1n;
      if (path === r.file && (kind === 'changed named device' || kind === 'alternate device')) st.dev += 1n;
      return st;
    }),
    mock.method(fs, 'fstatSync', (fd: number) => {
      descriptor = fd;
      const st = rawFstat(fd, { bigint: true });
      if (kind === 'alternate uid') st.uid += 1n;
      if (kind === 'alternate device') st.dev += 1n;
      return st;
    }),
    mock.method(fs, 'readFileSync', (fd: number, encoding: BufferEncoding) => {
      read = true;
      assert.equal(encoding, 'utf8');
      return rawRead(fd, encoding);
    }),
    mock.method(fs, 'realpathSync', (path: fs.PathLike) =>
      kind === 'moved parent after reading' && read && path === dirname(r.file) ? r.dir : rawReal(path),
    ),
    mock.method(fs, 'closeSync', (fd: number) => {
      close.push(fd);
      rawClose(fd);
    }),
  ];
  syncBuiltinESMExports();
  let result;
  try {
    result = readGateReceipt(r.root, r.tree);
  } finally {
    for (const hook of hooks) hook.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(
    result,
    kind === 'physical identities' || kind === 'invalid encoding option' ? sha : undefined,
  );
  assert.ok(descriptor >= 0);
  assert.deepEqual(close, [descriptor]);
  assert.throws(() => rawFstat(descriptor), { code: 'EBADF' });
});
