import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import {
  PRODUCER_MAX_BYTES,
  PRODUCER_MAX_FILES,
  producerArguments,
  producerDigest,
  stageProducer,
  type StagedProducer,
} from '../../src/infrastructure/producer.js';
import { runDigest } from '../../src/digest.js';
import { expectedDigest, producerFiles, writeProducer, type ProducerFiles } from './producer-fixture.js';

interface ProducerWorld {
  state: Record<string, unknown>;
}

const world = (w: ProducerWorld) =>
  w.state as { producerRoot: string; producerFiles: ProducerFiles; staged?: StagedProducer; parent: string };

After<ProducerWorld>(function () {
  const state = this.state as Partial<ReturnType<typeof world>>;
  state.staged?.dispose();
  for (const path of [state.producerRoot, state.parent])
    if (path) rmSync(path, { recursive: true, force: true });
});

function listed(directory: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, name.name);
      if (name.isDirectory()) walk(child);
      else out.push(relative(directory, child));
    }
  };
  walk(directory);
  return out.sort();
}

Given(
  'a provisioned fixture producer with a command link among its dependencies',
  function (this: ProducerWorld) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'producer-root-')));
    // Names whose order differs between UTF-16 code units and UTF-8 bytes: the listing sorts by bytes.
    const files = producerFiles('module.exports = require("./lib.js");\n', {
      'mcp-server/lib.js': 'module.exports = "pinned";\n',
      'mcp-server/node_modules/dependency/index.js': 'module.exports = 1;\n',
      'mcp-server/node_modules/dependency/native.node': '\u0000\u0001binary',
      'mcp-server/\u{1F600}.js': 'emoji\n',
      'mcp-server/！.js': 'fullwidth\n',
      'packages/skill/SKILL.md': '# Skill\n',
    });
    writeProducer(root, files);
    mkdirSync(join(root, 'mcp-server/node_modules/.bin'));
    symlinkSync('../dependency/index.js', join(root, 'mcp-server/node_modules/.bin/dependency'));
    writeFileSync(join(root, 'README.md'), 'outside the pinned set\n');
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'producer-parent-')));
    Object.assign(this.state, { producerRoot: root, producerFiles: files, parent });
  },
);

When('the host stages the pinned producer', function (this: ProducerWorld) {
  const state = world(this);
  state.staged = stageProducer(state.producerRoot, expectedDigest(state.producerFiles), state.parent);
});

When('the plugin root is changed after the check', function (this: ProducerWorld) {
  const { producerRoot } = world(this);
  writeFileSync(join(producerRoot, 'mcp-server/index.js'), 'process.exit(9);\n');
  writeFileSync(join(producerRoot, 'mcp-server/lib.js'), 'module.exports = "substituted";\n');
  writeFileSync(join(producerRoot, 'packages/skill/skill-config.json'), '{}\n');
});

Then(
  'the staged copy holds exactly the pinned bytes, read-only, in a private directory',
  function (this: ProducerWorld) {
    const { staged, producerFiles: files, parent } = world(this);
    assert.ok(staged);
    assert.equal(readdirSync(parent).length, 1);
    assert.equal(staged.root, join(parent, readdirSync(parent)[0]!));
    assert.equal(statSync(staged.root).mode & 0o777, 0o700);
    assert.equal(statSync(join(staged.root, 'mcp-server/node_modules')).mode & 0o777, 0o700);
    assert.equal(staged.entry, join(staged.root, 'mcp-server/index.js'));
    assert.equal(staged.skillConfig, join(staged.root, 'packages/skill/skill-config.json'));
    assert.deepEqual(listed(staged.root), Object.keys(files).sort());
    for (const [path, text] of Object.entries(files)) {
      assert.equal(readFileSync(join(staged.root, path), 'utf8'), text);
      assert.equal(statSync(join(staged.root, path)).mode & 0o777, 0o400);
    }
  },
);

Then('disposing of the staged copy removes it', function (this: ProducerWorld) {
  const state = world(this);
  state.staged!.dispose();
  assert.equal(existsSync(state.staged!.root), false);
  state.staged = undefined;
});

Then('the host digest equals the listing computed from the pinned files', function (this: ProducerWorld) {
  const { producerRoot, producerFiles: files } = world(this);
  assert.equal(producerDigest(producerRoot), expectedDigest(files));
});

Then(
  'staging it with another digest is refused with {string} and copies nothing',
  function (this: ProducerWorld, message: string) {
    const { producerRoot, parent } = world(this);
    assert.throws(() => stageProducer(producerRoot, '0'.repeat(64), parent), { message });
    assert.deepEqual(readdirSync(parent), []);
  },
);

Then(
  'reading it within {string} yields {string}',
  function (this: ProducerWorld, bound: string, outcome: string) {
    const { producerRoot, producerFiles: files } = world(this);
    const count = Object.keys(files).length;
    const bytes = Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    const limits = {
      'exactly the files': { files: count, bytes: PRODUCER_MAX_BYTES },
      'one file too few': { files: count - 1, bytes: PRODUCER_MAX_BYTES },
      'exactly the bytes': { files: PRODUCER_MAX_FILES, bytes },
      'one byte too few': { files: PRODUCER_MAX_FILES, bytes: bytes - 1 },
    }[bound];
    assert.ok(limits);
    if (outcome === 'accepted') assert.equal(producerDigest(producerRoot, limits), expectedDigest(files));
    else assert.throws(() => producerDigest(producerRoot, limits), { message: outcome });
  },
);

Then('the default bounds are {int} files and {int} MiB', function (files: number, mebibytes: number) {
  assert.deepEqual([PRODUCER_MAX_FILES, PRODUCER_MAX_BYTES], [files, mebibytes * 1024 * 1024]);
});

function digestCommand(w: ProducerWorld, args: readonly string[]): void {
  let stdout = '';
  let stderr = '';
  const code = runDigest({
    argv: ['node', 'digest-cli.ts', ...args],
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  });
  w.state['digestResult'] = { code, stdout, stderr };
}

When('the operator runs the producer digest command on it', function (this: ProducerWorld) {
  digestCommand(this, [world(this).producerRoot]);
});

When(
  'the operator runs the producer digest command with {string}',
  function (this: ProducerWorld, form: string) {
    const { producerRoot } = world(this);
    if (form === 'a linked bundle') {
      const bundle = join(producerRoot, 'mcp-server/index.js');
      rmSync(bundle);
      symlinkSync(join(producerRoot, 'mcp-server/lib.js'), bundle);
    }
    digestCommand(
      this,
      { 'no root': [], 'an extra operand': [producerRoot, 'extra'], 'a linked bundle': [producerRoot] }[
        form
      ]!,
    );
  },
);

Then('the command prints the listing digest and exits 0', function (this: ProducerWorld) {
  assert.deepEqual(this.state['digestResult'], {
    code: 0,
    stdout: `${expectedDigest(world(this).producerFiles)}\n`,
    stderr: '',
  });
});

Then('the command prints nothing and refuses with {string}', function (this: ProducerWorld, message: string) {
  assert.deepEqual(this.state['digestResult'], { code: 2, stdout: '', stderr: `${message}\n` });
});

Then(
  'staging a plugin root that does not exist fails with {string}, not a producer refusal',
  function (code: string) {
    const missing = join(realpathSync(tmpdir()), 'no-such-plugin-root');
    assert.throws(
      () => stageProducer(missing, '0'.repeat(64)),
      (error: NodeJS.ErrnoException) => error.code === code && !error.message.startsWith('SPEC_'),
    );
  },
);

Then(
  'launching it with {string} writable is {string}',
  function (this: ProducerWorld, which: string, outcome: string) {
    const { staged, parent } = world(this);
    assert.ok(staged);
    const writable = {
      'a sibling directory': join(parent, 'aos-producer-tmp-sibling'),
      'the copy itself': staged.root,
      'the parent of the copy': parent,
      'a directory in the copy': join(staged.root, 'mcp-server'),
    }[which];
    assert.ok(writable);
    if (outcome === 'allowed')
      assert.deepEqual(producerArguments(staged, [writable]), [
        '--permission',
        `--allow-fs-read=${staged.root}`,
        `--allow-fs-read=${writable}`,
        `--allow-fs-write=${writable}`,
        staged.entry,
      ]);
    else assert.throws(() => producerArguments(staged, [writable]), { message: outcome });
  },
);
