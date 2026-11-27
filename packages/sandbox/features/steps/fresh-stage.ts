import assert from 'node:assert/strict';
import fs, {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { freshStage, inMemoryFreshStage, type FreshStage } from '../../src/fresh-stage.js';
import { inputsFolder, SrtSandboxRunner } from '../../src/srt-runner.js';
import { checkVariables, stepDependencies } from '../../src/step-tool.js';
import type { CodeProcess } from '../../src/code-tool.js';
import { useSrt, repoOf } from './runner.js';
import { PKG } from './helpers.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';

interface Fixture {
  root: string;
  run: string;
  env: NodeJS.ProcessEnv;
}

interface StageWorld {
  stage: FreshStage;
  /** What the stage holds now, by file name. */
  holds: () => Record<string, string>;
  outside: string;
  paths?: string[];
}

const fixture = (world: SandboxWorld) => stored<Fixture>(world, 'runtime fixture');
const stage = (world: SandboxWorld) => stored<StageWorld>(world, 'freshStage');
const textOf = (name: string) => `Feature: ${name}\n`;

/** A folder outside the run, where a planted link points. */
function outsideFolder(world: SandboxWorld): string {
  const outside = fs.realpathSync(mkdtempSync(join(tmpdir(), 'aos-fresh-outside-')));
  world.cleanups.push(() => rmSync(outside, { recursive: true, force: true }));
  return outside;
}

Given('a private temporary folder of that run', function () {
  const tmp = join(fixture(this).run, 'tmp');
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  chmodSync(tmp, 0o700);
});

function onDisk(world: SandboxWorld, step: string, env = fixture(world).env): StageWorld {
  const real = freshStage(env, step);
  return {
    stage: real,
    holds: () => {
      const own = lstatSync(real.folder, { throwIfNoEntry: false });
      if (own === undefined || !own.isDirectory()) return {};
      return Object.fromEntries(
        readdirSync(real.folder).map((name) => [name, readFileSync(join(real.folder, name), 'utf8')]),
      );
    },
    outside: outsideFolder(world),
  };
}

function inMemory(world: SandboxWorld, step: string): StageWorld {
  const memory = inMemoryFreshStage(join(fixture(world).run, 'tmp', 'fresh', step));
  return {
    stage: memory,
    holds: () => Object.fromEntries([...memory.files].map(([path, text]) => [basename(path), text])),
    outside: outsideFolder(world),
  };
}

Given('a fresh stage of the step {string} on {word}', function (step: string, adapter: string) {
  assert.ok(adapter === 'disk' || adapter === 'memory', `no adapter named ${adapter}`);
  this.state['freshStage'] = adapter === 'disk' ? onDisk(this, step) : inMemory(this, step);
});

Given('a fresh stage of the step {string} on disk outside an admitted run', function (step: string) {
  this.state['freshStage'] = onDisk(this, step, { ...fixture(this).env, ARCHITECT_OS_RUN_DIR: tmpdir() });
});

Given(
  'a fresh stage of the step {string} on disk whose path already holds a {}',
  function (step: string, kind: string) {
    const world = onDisk(this, step);
    const folder = world.stage.folder;
    mkdirSync(join(folder, '..'), { recursive: true, mode: 0o700 });
    if (kind === 'directory') {
      mkdirSync(folder);
      writeFileSync(join(folder, 'kept'), 'kept\n');
    } else if (kind === 'file') writeFileSync(folder, 'kept\n');
    else if (kind === 'link to a directory outside it') symlinkSync(world.outside, folder);
    else if (kind === 'dangling link') symlinkSync(join(world.outside, 'nothing'), folder);
    else assert.fail(`no kind named ${kind}`);
    this.state['freshStage'] = world;
  },
);

Given(
  'a fresh stage of the step {string} on disk whose parent {string} is a link to a directory outside the run',
  function (step: string, parent: string) {
    const world = onDisk(this, step);
    symlinkSync(world.outside, join(fixture(this).run, parent));
    this.state['freshStage'] = world;
  },
);

Given(
  'a link to a file outside the run is planted at the path of {string} just before the host opens it',
  function (name: string) {
    const world = stage(this);
    const target = join(world.outside, 'outside.txt');
    writeFileSync(target, 'outside\n');
    const original = fs.openSync;
    const planted = mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
      if (args[0] === join(world.stage.folder, name)) symlinkSync(target, args[0]);
      return original(...args);
    });
    syncBuiltinESMExports();
    this.cleanups.push(() => {
      planted.mock.restore();
      syncBuiltinESMExports();
    });
  },
);

Given('the temporary folder of the run has the mode 755', function () {
  chmodSync(join(fixture(this).run, 'tmp'), 0o755);
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
  const folder = stage(this).stage.folder;
  mkdirSync(folder);
  writeFileSync(join(folder, 'kept'), 'kept\n');
});

When('the fresh stage is removed', function () {
  stage(this).stage.remove();
});

When('the folder of the fresh stage is replaced by a file', function () {
  const folder = stage(this).stage.folder;
  rmSync(folder, { recursive: true });
  writeFileSync(folder, 'kept\n');
});

When('the folder of the fresh stage is removed by someone else', function () {
  rmSync(stage(this).stage.folder, { recursive: true });
});

Then('the fresh stage gave the paths {string} in its folder', function (names: string) {
  const world = stage(this);
  assert.deepEqual(
    world.paths,
    names.split(' ').map((name) => join(world.stage.folder, name)),
  );
});

Then('the fresh stage holds {string} with its text', function (name: string) {
  assert.equal(stage(this).holds()[name], textOf(name));
});

Then('the fresh stage holds nothing', function () {
  assert.deepEqual(stage(this).holds(), {});
});

Then('writing {string} to the fresh stage fails with {string}', function (name: string, message: string) {
  assert.throws(
    () => stage(this).stage.write({ [name]: textOf(name) }),
    (error: Error) => error.message.includes(message),
  );
});

Then(
  'writing {string} and {string} to the fresh stage fails with {string}',
  function (first: string, second: string, message: string) {
    assert.throws(
      () => stage(this).stage.write({ [first]: textOf(first), [second]: textOf(second) }),
      (error: Error) => error.message.includes(message),
    );
  },
);

Then('removing the fresh stage fails with {string}', function (message: string) {
  assert.throws(
    () => stage(this).stage.remove(),
    (error: Error) => error.message.includes(message),
  );
});

Then('the path of the fresh stage still holds the {}', function (kind: string) {
  const folder = stage(this).stage.folder;
  const own = lstatSync(folder);
  if (kind === 'directory') assert.equal(readFileSync(join(folder, 'kept'), 'utf8'), 'kept\n');
  else if (kind === 'file') assert.equal(own.isFile() && readFileSync(folder, 'utf8'), 'kept\n');
  else assert.ok(own.isSymbolicLink(), `${kind} is gone`);
});

Then('the target outside the run holds no file', function () {
  assert.deepEqual(readdirSync(stage(this).outside), []);
});

Then('the file outside the run is still {string}', function (text: string) {
  assert.equal(readFileSync(join(stage(this).outside, 'outside.txt'), 'utf8'), text.replace('\\n', '\n'));
});

Then('the folder of the fresh stage is {string} under the run', function (path: string) {
  assert.equal(stage(this).stage.folder, join(fixture(this).run, path));
});

Then('the folder of the fresh stage has the mode {int}', function (mode: number) {
  assert.equal((lstatSync(stage(this).stage.folder).mode & 0o777).toString(8), String(mode));
});

Then('the folder {string} of the run has the mode {int}', function (path: string, mode: number) {
  assert.equal((lstatSync(join(fixture(this).run, path)).mode & 0o777).toString(8), String(mode));
});

Then('the file {string} of the fresh stage has the mode {int}', function (name: string, mode: number) {
  const own = lstatSync(join(stage(this).stage.folder, name));
  assert.ok(own.isFile());
  assert.equal((own.mode & 0o777).toString(8), String(mode));
});

Then('the inputs folder given nothing is the worktree', function () {
  assert.equal(inputsFolder(undefined, '/the/worktree', fixture(this).run), '/the/worktree');
});

Then('the inputs folder given the folder of the fresh stage is that folder', function () {
  const folder = stage(this).stage.folder;
  assert.equal(inputsFolder(folder, '/the/worktree', fixture(this).run), folder);
});

Then('the inputs folder given {} is refused', function (which: string) {
  const { run } = fixture(this);
  const fresh = join(run, 'tmp', 'fresh');
  const folders: Record<string, () => string> = {
    'the temporary folder of the run': () => join(run, 'tmp'),
    'the folder tmp/fresh of the run': () => fresh,
    'a folder named a_b under tmp/fresh': () => {
      mkdirSync(join(fresh, 'a_b'));
      return join(fresh, 'a_b');
    },
    'a link under tmp/fresh to the stage': () => {
      symlinkSync(stage(this).stage.folder, join(fresh, 'other'));
      return join(fresh, 'other');
    },
    'the home folder': () => homedir(),
  };
  const folder = folders[which];
  assert.ok(folder, `no folder named ${which}`);
  assert.throws(
    () => inputsFolder(folder(), '/the/worktree', run),
    (error: Error) => error.message.includes('invalid fresh inputs location'),
  );
});

Given('the host counts the files it opens and closes', function () {
  const opened: number[] = [];
  const closed: number[] = [];
  const open = fs.openSync;
  const close = fs.closeSync;
  const folder = stage(this).stage.folder;
  const opening = mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    const descriptor = open(...args);
    // The files of the stage only: the admission of the run reads its own files too.
    if (String(args[0]).startsWith(`${folder}/`)) opened.push(descriptor);
    return descriptor;
  });
  const closing = mock.method(fs, 'closeSync', (descriptor: number) => {
    if (opened.includes(descriptor)) closed.push(descriptor);
    close(descriptor);
  });
  syncBuiltinESMExports();
  this.cleanups.push(() => {
    opening.mock.restore();
    closing.mock.restore();
    syncBuiltinESMExports();
  });
  this.state['descriptors'] = { opened, closed };
});

Then('the host closed each file it opened for the stage, once', function () {
  const { opened, closed } = stored<{ opened: number[]; closed: number[] }>(this, 'descriptors');
  assert.equal(opened.length, 2);
  assert.deepEqual([...closed].sort(), [...opened].sort());
});

Then(
  'the step dependencies of that run stage the step {string} in {string} under the run',
  function (step: string, path: string) {
    const { env, run } = fixture(this);
    const proc = { env, argv: [], cwd: () => run } as unknown as CodeProcess;
    assert.equal(stepDependencies(proc).stage(step).folder, join(run, path));
  },
);

Then('the variables of a check given {} are {}', function (inputs: string, variables: string) {
  const given = inputs === 'no inputs folder' ? undefined : JSON.parse(inputs.replace('the folder ', ''));
  assert.deepEqual(checkVariables(given), JSON.parse(variables));
});

Given('a fresh stage of the step {string} in the admitted run of this suite', function (step: string) {
  const run = process.env['ARCHITECT_OS_RUN_DIR']!;
  const folder = join(run, 'tmp', 'fresh', step + '-' + process.pid);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  this.cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  this.state['suiteStage'] = folder;
});

Given(
  'an srt runner over a throwaway git repository whose srt prints its settings, given that stage as inputs',
  function () {
    const inputs = stored<string>(this, 'suiteStage');
    useSrt(this, () => ({
      srtCli: join(PKG, 'fixtures', 'settings-srt.mjs'),
      variables: { inputs },
    }));
  },
);

Given('an srt runner over a throwaway git repository whose srt prints its settings', function () {
  useSrt(this, () => ({ srtCli: join(PKG, 'fixtures', 'settings-srt.mjs') }));
});

When('I start a checker sandbox that prints its settings', async function () {
  const runner = stored<SrtSandboxRunner>(this, 'runner');
  const sandbox = await runner.start({
    profile: 'checker',
    cwd: stored<string>(this, 'cwd'),
    command: ['true'],
  });
  sandbox.stdin.end();
  let out = '';
  for await (const chunk of sandbox.stdout) out += String(chunk);
  await sandbox.exited;
  this.state['printedSettings'] = out;
});

/** The paths the settings srt received open for reading (`engineSettings`: each a literal path). */
function readPaths(world: SandboxWorld): string[] {
  const settings = JSON.parse(stored<string>(world, 'printedSettings')) as {
    filesystem: { allowRead: { path: string }[] };
  };
  return settings.filesystem.allowRead.map(({ path }) => path);
}

Then('the settings srt received allow reading the stage', function () {
  assert.ok(readPaths(this).includes(stored<string>(this, 'suiteStage')), readPaths(this).join(' '));
});

Then('the settings srt received allow reading the worktree and nothing under tmp\\/fresh', function () {
  const worktree = fs.realpathSync(repoOf(this).worktree);
  assert.ok(readPaths(this).includes(worktree), readPaths(this).join(' '));
  assert.ok(!stored<string>(this, 'printedSettings').includes('/tmp/fresh/'));
});
