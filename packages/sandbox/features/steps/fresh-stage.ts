import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshStage, inMemoryFreshStage, type FreshStage } from '../../src/fresh-stage.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';

/** The folder of the stage, as the contract names it: written here, not taken from the code it checks. */
const STAGE = '.architect-os-fresh-inputs';

interface StageWorld {
  stage: FreshStage;
  /** What the stage holds now, by file name. */
  holds: () => Record<string, string>;
  root?: string;
  outside?: string;
  kind?: string;
  paths?: string[];
}

const stage = (world: SandboxWorld) => stored<StageWorld>(world, 'freshStage');
const textOf = (name: string) => `Feature: ${name}\n`;

function onDisk(world: SandboxWorld): StageWorld {
  const parent = mkdtempSync(join(tmpdir(), 'aos-fresh-stage-'));
  world.cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'worktree');
  const outside = join(parent, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  const folder = join(root, STAGE);
  return {
    stage: freshStage(() => root),
    holds: () => {
      const own = lstatSync(folder, { throwIfNoEntry: false });
      if (own === undefined || !own.isDirectory()) return {};
      return Object.fromEntries(
        readdirSync(folder).map((name) => [name, readFileSync(join(folder, name), 'utf8')]),
      );
    },
    root,
    outside,
  };
}

function inMemory(): StageWorld {
  const memory = inMemoryFreshStage();
  return {
    stage: memory,
    holds: () =>
      Object.fromEntries(
        [...memory.files].map(([path, text]) => [path.slice('.architect-os-fresh-inputs/'.length), text]),
      ),
  };
}

Given('a fresh stage on {word}', function (adapter: string) {
  assert.ok(adapter === 'disk' || adapter === 'memory', `no adapter named ${adapter}`);
  this.state['freshStage'] = adapter === 'disk' ? onDisk(this) : inMemory();
});

Given('a fresh stage on disk whose path already holds a {}', function (kind: string) {
  const world = onDisk(this);
  const folder = join(world.root!, STAGE);
  if (kind === 'directory') {
    mkdirSync(folder);
    writeFileSync(join(folder, 'kept'), 'kept\n');
  } else if (kind === 'file') writeFileSync(folder, 'kept\n');
  else if (kind === 'link to a directory outside it') symlinkSync(world.outside!, folder);
  else if (kind === 'dangling link') symlinkSync(join(world.outside!, 'nothing'), folder);
  else assert.fail(`no kind named ${kind}`);
  world.kind = kind;
  this.state['freshStage'] = world;
});

When('the fresh stage writes {string} and {string}', function (first: string, second: string) {
  const world = stage(this);
  world.paths = world.stage.write({ [first]: textOf(first), [second]: textOf(second) });
});

When(
  'the fresh stage writes {string} and {string} under the umask 000',
  function (first: string, second: string) {
    const world = stage(this);
    const before = process.umask(0);
    try {
      world.paths = world.stage.write({ [first]: textOf(first), [second]: textOf(second) });
    } finally {
      process.umask(before);
    }
  },
);

When('someone else puts a directory at the path of the fresh stage', function () {
  const folder = join(stage(this).root!, STAGE);
  mkdirSync(folder);
  writeFileSync(join(folder, 'kept'), 'kept\n');
});

When('the fresh stage is removed', function () {
  stage(this).stage.remove();
});

When('the folder of the fresh stage is replaced by a file', function () {
  const folder = join(stage(this).root!, STAGE);
  rmSync(folder, { recursive: true });
  writeFileSync(folder, 'kept\n');
  stage(this).kind = 'file';
});

When('the folder of the fresh stage is removed by someone else', function () {
  rmSync(join(stage(this).root!, STAGE), { recursive: true });
});

Then('the fresh stage gave the paths {string}', function (paths: string) {
  assert.deepEqual(stage(this).paths, paths.split(' '));
});

Then('the fresh stage holds {string} with its text', function (name: string) {
  assert.equal(stage(this).holds()[name], textOf(name));
});

Then('the fresh stage holds nothing', function () {
  assert.deepEqual(stage(this).holds(), {});
  const root = stage(this).root;
  if (root !== undefined) assert.equal(existsSync(join(root, STAGE)), false);
});

Then('writing {string} to the fresh stage fails with {string}', function (name: string, message: string) {
  assert.throws(
    () => stage(this).stage.write({ [name]: textOf(name) }),
    (error: Error) => error.message.includes(message),
  );
});

Then('removing the fresh stage fails with {string}', function (message: string) {
  assert.throws(
    () => stage(this).stage.remove(),
    (error: Error) => error.message.includes(message),
  );
});

Then('the path of the fresh stage still holds the {}', function (kind: string) {
  const world = stage(this);
  const folder = join(world.root!, STAGE);
  const own = lstatSync(folder);
  if (kind === 'directory') assert.equal(readFileSync(join(folder, 'kept'), 'utf8'), 'kept\n');
  else if (kind === 'file') assert.equal(own.isFile() && readFileSync(folder, 'utf8'), 'kept\n');
  else assert.ok(own.isSymbolicLink(), `${kind} is gone`);
});

Then('the target outside the worktree holds no file', function () {
  assert.deepEqual(readdirSync(stage(this).outside!), []);
});

Then('the file {string} of the fresh stage has the mode {int}', function (name: string, mode: number) {
  const own = lstatSync(join(stage(this).root!, STAGE, name));
  assert.ok(own.isFile());
  assert.equal((own.mode & 0o777).toString(8), String(mode));
});

Then('the folder of the fresh stage has the mode {int}', function (mode: number) {
  const own = lstatSync(join(stage(this).root!, STAGE));
  assert.equal((own.mode & 0o777).toString(8), String(mode));
});
