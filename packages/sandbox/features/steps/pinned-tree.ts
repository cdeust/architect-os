import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  pinnedTreeDigest,
  readPinnedTree,
  stagePinnedTree,
  type PinnedTreeRule,
  type StagedTree,
} from '../../src/pinned-tree.js';
import { Given, Then, When } from './helpers.js';

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

// Two names whose order differs between UTF-16 code units and UTF-8 bytes.
const FILES: Record<string, string> = {
  'server/index.js': 'entry\n',
  'server/\u{1F600}.js': 'emoji\n',
  'server/！.js': 'fullwidth\n',
  'server/modules/dependency/index.js': 'dependency\n',
  'skill/config.json': '{}\n',
};
const RULE: PinnedTreeRule = {
  include: ['server', 'skill'],
  skip: ['server/modules/.bin'],
  required: ['server/index.js', 'skill/config.json'],
  maxFiles: 100,
  maxBytes: 1_000,
};
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

interface TreeState {
  root: string;
  parent: string;
  staged?: StagedTree;
  socket?: Server;
  umask?: number;
}

function tree(world: { state: Record<string, unknown> }): TreeState {
  return world.state['pinnedTree'] as TreeState;
}

Given('a pinned tree with a link in its skipped directory', function () {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pinned-tree-')));
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'pinned-parent-')));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, 'server/modules/.bin'));
  symlinkSync('../dependency/index.js', join(root, 'server/modules/.bin/dependency'));
  writeFileSync(join(root, 'outside.txt'), 'not pinned\n');
  const state: TreeState = { root, parent };
  this.state['pinnedTree'] = state;
  this.cleanups.push(() => {
    state.staged?.dispose();
    state.socket?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  });
});

Given('the pinned tree also holds {}', async function (entry: string) {
  const state = tree(this);
  const at = (path: string) => join(state.root, path);
  switch (entry) {
    case 'a named pipe':
      assert.equal(spawnSync('mkfifo', [at('server/pipe')]).status, 0);
      break;
    case 'a socket': {
      const socket = createServer();
      state.socket = socket;
      await new Promise<void>((done) => socket.listen(at('server/s'), () => done()));
      break;
    }
    case 'a link to a file':
      symlinkSync(at('outside.txt'), at('skill/linked.json'));
      break;
    case 'a linked directory':
      renameSync(at('skill'), at('skill-elsewhere'));
      symlinkSync(at('skill-elsewhere'), at('skill'));
      break;
    case 'a newline in a name':
      writeFileSync(at('skill/a\nb'), '\n');
      break;
    case 'a backslash in a name':
      writeFileSync(at('skill/a\\b'), '\n');
      break;
    case 'no required file':
      rmSync(at('skill/config.json'));
      break;
    case 'no included directory':
      rmSync(at('skill'), { recursive: true });
      break;
    default:
      throw new Error(entry);
  }
});

Then('the pinned tree reads its regular files in the byte order of their paths', function () {
  const files = readPinnedTree(tree(this).root, RULE);
  assert.deepEqual(
    files.map(({ path }) => path),
    Object.keys(FILES).sort(byBytes),
  );
  assert.notDeepEqual(Object.keys(FILES).sort(byBytes), Object.keys(FILES).sort());
  for (const { path, bytes } of files) assert.equal(bytes.toString(), FILES[path]);
});

Then('its digest is the shasum listing of those files', function () {
  const listing = Object.keys(FILES)
    .sort(byBytes)
    .map((path) => `${sha256(FILES[path]!)}  ${path}\n`)
    .join('');
  assert.equal(pinnedTreeDigest(readPinnedTree(tree(this).root, RULE)), sha256(listing));
});

Then('reading the pinned tree is refused with {string}', function (message: string) {
  assert.throws(() => readPinnedTree(tree(this).root, RULE), { message });
});

Then('reading the pinned tree within {string} yields {string}', function (bound: string, outcome: string) {
  const count = Object.keys(FILES).length;
  const bytes = Object.values(FILES).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  const limits = {
    'exactly the files': { maxFiles: count },
    'one file too few': { maxFiles: count - 1 },
    'exactly the bytes': { maxBytes: bytes },
    'one byte too few': { maxBytes: bytes - 1 },
  }[bound];
  assert.ok(limits);
  const rule = { ...RULE, ...limits };
  if (outcome === 'accepted') assert.equal(readPinnedTree(tree(this).root, rule).length, count);
  else assert.throws(() => readPinnedTree(tree(this).root, rule), { message: outcome });
});

When('the host stages the pinned tree under a permissive umask', function () {
  const state = tree(this);
  const previous = process.umask(0o022);
  try {
    state.staged = stagePinnedTree(readPinnedTree(state.root, RULE), state.parent, 'aos-test-');
    state.umask = process.umask(previous);
  } catch (error) {
    process.umask(previous);
    throw error;
  }
});

Then('the staged tree holds exactly the pinned bytes, files 0400 and directories 0700', function () {
  const { staged, parent } = tree(this);
  assert.ok(staged);
  assert.deepEqual(readdirSync(parent), [relative(parent, staged.root)]);
  assert.equal(relative(parent, staged.root).startsWith('aos-test-'), true);
  const seen: string[] = [];
  const walk = (path: string) => {
    const mode = statSync(path).mode;
    if (statSync(path).isDirectory()) {
      assert.equal(mode & 0o777, 0o700, path);
      for (const name of readdirSync(path)) walk(join(path, name));
    } else {
      assert.equal(mode & 0o777, 0o400, path);
      seen.push(relative(staged.root, path));
    }
  };
  walk(staged.root);
  assert.deepEqual(seen.sort(byBytes), Object.keys(FILES).sort(byBytes));
  for (const path of seen) assert.equal(readFileSync(join(staged.root, path), 'utf8'), FILES[path]);
});

Then('the umask of the host is restored', function () {
  assert.equal(tree(this).umask, 0o022);
});

Then('disposing of the staged tree removes it', function () {
  const state = tree(this);
  state.staged!.dispose();
  assert.equal(existsSync(state.staged!.root), false);
});

Then('disposing of it again is harmless', function () {
  const state = tree(this);
  assert.doesNotThrow(() => state.staged!.dispose());
  state.staged = undefined;
});

When('the host stages files whose paths collide', function () {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'pinned-parent-')));
  this.cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  this.state['collidingParent'] = parent;
  try {
    stagePinnedTree(
      [
        { path: 'a', bytes: Buffer.from('file\n') },
        { path: 'a/b', bytes: Buffer.from('below a file\n') },
      ],
      parent,
      'aos-test-',
    );
    this.state['collision'] = 'staged';
  } catch (error) {
    this.state['collision'] = (error as NodeJS.ErrnoException).code;
  }
});

Then('staging fails and the parent directory is left empty', function () {
  assert.notEqual(this.state['collision'], 'staged');
  assert.deepEqual(readdirSync(this.state['collidingParent'] as string), []);
});
