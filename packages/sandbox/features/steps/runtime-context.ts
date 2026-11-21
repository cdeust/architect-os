import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { mock } from 'node:test';
import { hasAdmittedRun, requireAdmittedRun, runLocations } from '../../src/runtime-context.js';
import { Given, Then, stored, type SandboxWorld } from './helpers.js';

interface Context {
  root: string;
  run: string;
  env: Record<string, string>;
  receipt: string;
  marker: string;
}

function locations(root: string, run: string) {
  return {
    TMPDIR: join(run, 'tmp'),
    TMP: join(run, 'tmp'),
    TEMP: join(run, 'tmp'),
    XDG_CONFIG_HOME: join(run, 'config'),
    XDG_DATA_HOME: join(run, 'data'),
    XDG_STATE_HOME: join(run, 'state'),
    XDG_CACHE_HOME: join(root, 'cache/xdg'),
    NODE_COMPILE_CACHE: join(root, 'cache/node'),
    npm_config_cache: join(root, 'cache/npm'),
    npm_config_logs_dir: join(run, 'npm-logs'),
    npm_config_userconfig: join(run, 'config/npm/user.npmrc'),
    npm_config_globalconfig: join(run, 'config/npm/global.npmrc'),
  };
}

function bind(c: Context, bytes: string) {
  const stat = fs.statSync(c.run, { bigint: true });
  c.env['ARCHITECT_OS_ADMISSION_BINDING'] = [
    stat.dev,
    stat.ino,
    Buffer.from(bytes).toString('base64url'),
  ].join(':');
  fs.writeFileSync(c.receipt, bytes);
}

function create(root: string, name: string): Context {
  const run = join(root, 'run', name),
    env = locations(root, run);
  for (const [key, path] of Object.entries(env)) {
    if (key === 'npm_config_userconfig' || key === 'npm_config_globalconfig') {
      fs.mkdirSync(dirname(path), { recursive: true });
      fs.writeFileSync(path, '');
    } else {
      fs.mkdirSync(path, { recursive: true });
    }
  }
  const c: Context = {
    root,
    run,
    env: {
      ...env,
      ARCHITECT_OS_RUNTIME_ROOT: root,
      ARCHITECT_OS_RUN_DIR: run,
      ARCHITECT_OS_HOST_XDG_CONFIG_HOME: 'unset',
    },
    receipt: join(run, 'admission.json'),
    marker: join(root, '.architect-os-runtime-root'),
  };
  const stat = fs.statSync(root, { bigint: true });
  fs.writeFileSync(c.marker, 'architect-os-runtime-root/v2\nenvironment=hosted-runner\n');
  bind(
    c,
    JSON.stringify({
      schema: 'architect-os-runtime-receipt/v1',
      run: name,
      admittedAt: '2026-11-21T00:00:00.000Z',
      command: 'other',
      environment: 'hosted-runner',
      policy: { version: 1, status: 'provisional' },
      floors: { rootBytes: '4294967296', homeBytes: '2147483648' },
      observations: {
        root: { device: String(stat.dev), inode: String(stat.ino), availableBytes: '9000000000' },
        home: { device: String(stat.dev), availableBytes: '9000000000' },
      },
    }) + '\n',
  );
  return c;
}

const context = (world: SandboxWorld) => stored<Context>(world, 'runtime fixture');

Given('a bound run for the runtime entry check', function () {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'aos-bind-')));
  this.cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  this.state['runtime fixture'] = create(root, 'rAb9cX4');
});

Then('every runtime location must equal its published path', function () {
  const c = context(this);
  const expected = locations(c.root, c.run);
  assert.deepEqual(runLocations(c.root, c.run), expected);
  assert.equal(hasAdmittedRun(c.env), true);
  for (const key of Object.keys(expected)) {
    assert.equal(hasAdmittedRun({ ...c.env, [key]: c.root }), false, key);
  }
});

Then('runtime entry accepts only preserved host identity states', function () {
  const c = context(this);
  for (const [value, valid] of [
    ['unset', true],
    ['set:', true],
    ['set:/config', true],
    ['unset:', false],
    ['', false],
    ['set', false],
  ] as const) {
    assert.equal(hasAdmittedRun({ ...c.env, ARCHITECT_OS_HOST_XDG_CONFIG_HOME: value }), valid, value);
  }
  const env = { ...c.env };
  delete env['ARCHITECT_OS_HOST_XDG_CONFIG_HOME'];
  assert.equal(hasAdmittedRun(env), false);
});

Then('the runtime checker refuses {string}', function (fault: string) {
  const c = context(this),
    e = c.env;
  const other = join(c.root, 'elsewhere');
  const npmrc = e['npm_config_userconfig']!;
  const object = JSON.parse(fs.readFileSync(c.receipt, 'utf8'));
  switch (fault) {
    case 'missing context':
      assert.equal(hasAdmittedRun({}), false);
      return;
    case 'another allocation binding': {
      const b = create(c.root, 'rAb9cX5');
      e['ARCHITECT_OS_ADMISSION_BINDING'] = b.env['ARCHITECT_OS_ADMISSION_BINDING']!;
      break;
    }
    case 'run at a different depth':
      e['ARCHITECT_OS_RUN_DIR'] = join(c.root, basename(c.run));
      break;
    case 'invalid run name': {
      const b = create(c.root, 'Ab9cX4');
      assert.equal(hasAdmittedRun(b.env), false);
      return;
    }
    case 'binding has an extra field':
      e['ARCHITECT_OS_ADMISSION_BINDING'] += ':extra';
      break;
    case 'noncanonical base64':
      e['ARCHITECT_OS_ADMISSION_BINDING'] += '=';
      break;
    case 'unknown binding':
      delete e['ARCHITECT_OS_ADMISSION_BINDING'];
      break;
    case 'invalid JSON':
      bind(c, '{');
      break;
    case 'wrong schema':
      object.schema = 'other';
      bind(c, JSON.stringify(object));
      break;
    case 'wrong receipt run':
      object.run = 'rAb9cX5';
      bind(c, JSON.stringify(object));
      break;
    case 'wrong root device':
      object.observations.root.device += '0';
      bind(c, JSON.stringify(object));
      break;
    case 'wrong root inode':
      object.observations.root.inode += '0';
      bind(c, JSON.stringify(object));
      break;
    case 'different receipt bytes':
      fs.writeFileSync(
        c.receipt,
        fs.readFileSync(c.receipt, 'utf8').replace('hosted-runner', 'hosted-runnex'),
      );
      break;
    case 'larger receipt':
      fs.appendFileSync(c.receipt, ' ');
      break;
    case 'different environment marker':
      fs.writeFileSync(c.marker, fs.readFileSync(c.marker, 'utf8').replace('hosted-runner', 'hosted-runnex'));
      break;
    case 'linked marker':
    case 'linked receipt':
    case 'linked run':
    case 'linked cache': {
      const path = {
        'linked marker': c.marker,
        'linked receipt': c.receipt,
        'linked run': c.run,
        'linked cache': e['npm_config_cache']!,
      }[fault]!;
      fs.renameSync(path, other);
      fs.symlinkSync(other, path);
      break;
    }
    case 'aliased root': {
      const alias = join(c.root, 'alias');
      fs.symlinkSync(c.root, alias);
      const run = join(alias, 'run', basename(c.run));
      Object.assign(e, locations(alias, run), {
        ARCHITECT_OS_RUNTIME_ROOT: alias,
        ARCHITECT_OS_RUN_DIR: run,
      });
      break;
    }
    case 'hardlinked receipt':
      fs.linkSync(c.receipt, other);
      break;
    case 'hardlinked npm config':
      fs.linkSync(npmrc, other);
      break;
    case 'nonempty npm config':
      fs.writeFileSync(npmrc, 'x');
      break;
    case 'directory for npm global config':
      fs.unlinkSync(e['npm_config_globalconfig']!);
      fs.mkdirSync(e['npm_config_globalconfig']!);
      break;
    case 'file for a directory':
      fs.rmdirSync(e['XDG_DATA_HOME']!);
      fs.writeFileSync(e['XDG_DATA_HOME']!, '');
      break;
    case 'missing run directory':
      fs.renameSync(c.run, other);
      break;
    default:
      assert.fail(fault);
  }
  assert.equal(hasAdmittedRun(e), false, fault);
});

Then('the runtime guard reports its refusal and accepts its bound context', function () {
  const c = context(this);
  const previous = new Map(Object.keys(c.env).map((key) => [key, process.env[key]]));
  let errors = '';
  const message = mock.method(process.stderr, 'write', (s: string) => {
    errors += s;
    return true;
  });
  const exited = mock.method(process, 'exit', (code: number) => {
    throw new Error('exit ' + code);
  });
  try {
    Object.assign(process.env, c.env);
    requireAdmittedRun();
    assert.equal(errors, '');
    assert.equal(exited.mock.callCount(), 0);
    delete process.env['ARCHITECT_OS_ADMISSION_BINDING'];
    assert.throws(() => requireAdmittedRun(), { message: 'exit 2' });
    assert.equal(errors, 'aos: RUNTIME_ENTRY_REQUIRED\n');
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    message.mock.restore();
    exited.mock.restore();
  }
});

Then('runtime receipt reading handles {string}', function (fault: string) {
  const c = context(this);
  const actual = fs.readSync;
  let reads = 0;
  if (fault === 'oversized file') fs.truncateSync(c.receipt, fs.statSync(c.receipt).size + 1);
  const hook = mock.method(
    fs,
    'readSync',
    (fd: number, b: Buffer, offset?: number, length?: number, position?: number | null) => {
      reads++;
      if (fault === 'early EOF') {
        assert.equal(reads, 1, 'EOF terminates the read loop');
        return 0;
      }
      if (length === undefined) return actual(fd, b);
      assert.ok((offset ?? 0) + length <= b.length, 'read fits remaining buffer');
      const count = actual(
        fd,
        b,
        offset ?? 0,
        fault === 'short reads' ? Math.min(length, 3) : length,
        position ?? null,
      );
      if (reads === 1 && fault === 'growth during read') fs.appendFileSync(c.receipt, 'x');
      return count;
    },
  );
  syncBuiltinESMExports();
  try {
    const valid = hasAdmittedRun(c.env);
    assert.equal(valid, fault === 'short reads');
    if (fault === 'short reads') assert.ok(reads > 2);
    if (fault === 'early EOF') assert.equal(reads, 1);
    if (fault === 'oversized file') assert.equal(reads, 0);
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('the runtime checker refuses a run name shaped like {string}', function (name: string) {
  const c = context(this);
  assert.equal(hasAdmittedRun(create(c.root, name).env), false);
});

Then('runtime receipt descriptors are closed after {word}', function (result: string) {
  const c = context(this);
  if (result === 'refusal') fs.appendFileSync(c.receipt, 'x');
  const opened = mock.method(fs, 'openSync'),
    closed = mock.method(fs, 'closeSync');
  syncBuiltinESMExports();
  try {
    assert.equal(hasAdmittedRun(c.env), result === 'success');
    const descriptors = opened.mock.calls.map((call) => call.result);
    assert.equal(descriptors.length, result === 'success' ? 2 : 1);
    assert.deepEqual(
      closed.mock.calls.map((call) => call.arguments[0]),
      descriptors,
    );
    for (const call of opened.mock.calls) {
      assert.equal(
        call.arguments[1],
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
    }
  } finally {
    opened.mock.restore();
    closed.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('runtime entry checks the opened receipt type and device before reading', function () {
  const c = context(this),
    fstat = fs.fstatSync;
  for (const observation of ['directory', 'other device']) {
    const opened = mock.method(fs, 'fstatSync', (fd: number) => {
        const stats = fstat(fd, { bigint: true });
        if (observation === 'directory') stats.isFile = () => false;
        else stats.dev += 1n;
        return stats;
      }),
      read = mock.method(fs, 'readSync');
    syncBuiltinESMExports();
    try {
      assert.equal(hasAdmittedRun(c.env), false, observation);
      assert.equal(read.mock.callCount(), 0, observation);
    } finally {
      opened.mock.restore();
      read.mock.restore();
      syncBuiltinESMExports();
    }
  }
});

Then('runtime entry rejects a published location on a different device', function () {
  const c = context(this),
    original = fs.statSync;
  const changed = mock.method(fs, 'statSync', (path: fs.PathLike) => {
    const stat = original(path, { bigint: true });
    if (path === c.env['XDG_DATA_HOME']) stat.dev += 1n;
    return stat;
  });
  syncBuiltinESMExports();
  try {
    assert.equal(hasAdmittedRun(c.env), false);
  } finally {
    changed.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('runtime entry rejects a filesystem root before inspecting its paths', function () {
  const c = context(this),
    probe = mock.method(fs, 'realpathSync');
  syncBuiltinESMExports();
  try {
    assert.equal(
      hasAdmittedRun({ ...c.env, ARCHITECT_OS_RUNTIME_ROOT: '/', ARCHITECT_OS_RUN_DIR: '/run/rAb9cX4' }),
      false,
    );
    assert.equal(probe.mock.callCount(), 0);
  } finally {
    probe.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('a bound allocation moved out of the run parent is refused', function () {
  const c = context(this),
    moved = join(c.root, basename(c.run));
  fs.renameSync(c.run, moved);
  assert.equal(hasAdmittedRun({ ...c.env, ...locations(c.root, moved), ARCHITECT_OS_RUN_DIR: moved }), false);
});

Then('the launcher marker may have two names while the receipt remains private', function () {
  const c = context(this);
  fs.linkSync(c.marker, join(c.root, 'marker-alias'));
  assert.equal(hasAdmittedRun(c.env), true);
});

Then('the allocation binding retains exact filesystem integer precision', function () {
  const c = context(this);
  const stat = fs.statSync(c.run, { bigint: true });
  const large = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
  const bytes = fs.readFileSync(c.receipt).toString('base64url');
  c.env['ARCHITECT_OS_ADMISSION_BINDING'] = [stat.dev, large, bytes].join(':');
  const original = fs.statSync;
  const changed = mock.method(fs, 'statSync', (path: fs.PathLike, options?: { bigint?: boolean }) => {
    if (options?.bigint) {
      const result = original(path, { bigint: true });
      if (path === c.run) result.ino = large;
      return result;
    }
    const result = original(path);
    if (path === c.run) result.ino = Number(large);
    return result;
  });
  syncBuiltinESMExports();
  try {
    assert.equal(hasAdmittedRun(c.env), true);
  } finally {
    changed.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('a linked allocation is refused before reading a receipt', function () {
  const c = context(this),
    other = join(c.root, 'external');
  fs.renameSync(c.run, other);
  fs.symlinkSync(other, c.run);
  const opened = mock.method(fs, 'openSync');
  syncBuiltinESMExports();
  try {
    assert.equal(hasAdmittedRun(c.env), false);
    assert.equal(opened.mock.callCount(), 0);
  } finally {
    opened.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('runtime entry requires the canonical spelling of the root itself', function () {
  const c = context(this);
  for (const suffix of ['/', '/.'])
    assert.equal(hasAdmittedRun({ ...c.env, ARCHITECT_OS_RUNTIME_ROOT: c.root + suffix }), false, suffix);
});
