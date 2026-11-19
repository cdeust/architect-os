import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { RunAllocation, RuntimeFilesystem } from '../../src/domain/ports.js';
import type { Below } from '../../src/domain/root.js';
import { MemoryRuntimeFilesystem } from '../../src/infrastructure/memory-runtime-filesystem.js';
import {
  HOST_CALLS,
  NodeRuntimeFilesystem,
  type HostCalls,
} from '../../src/infrastructure/node-runtime-filesystem.js';
import {
  Given,
  kept,
  markerBytes,
  scratchDirectory,
  Then,
  unescape,
  When,
  type RuntimeWorld,
} from './support.js';

/** What a contract scenario works on: one adapter, a root it owns, and how to arrange entries below that root. */
interface Contract {
  readonly filesystem: RuntimeFilesystem;
  /** The directory that holds the root; a `..` below the root reaches it. */
  readonly parent: string;
  readonly root: string;
  readonly device: bigint;
  readonly memory: MemoryRuntimeFilesystem | undefined;
  runs: (RunAllocation | undefined)[];
  /** The paths the scenario arranged below the root, relative to it. */
  readonly arranged: string[];
  /** The identity of each directory the scenario arranged, by absolute path: a node of memory, or a device and inode. */
  readonly identities: Map<string, unknown>;
  /** What the scenario made in the run through the port, in order, below the run. */
  made: Below[];
  /** The descriptors this process had open when the scenario began. */
  readonly descriptors: number;
}

const MEMORY_DEVICE = 5n;
const MEMORY_HOME_DEVICE = 6n;

const contract = (world: RuntimeWorld): Contract => kept<Contract>(world, 'contract');
const below = (path: string): string[] => path.split('/');
const allocation = (world: RuntimeWorld): RunAllocation => {
  const [first] = contract(world).runs;
  assert.ok(first !== undefined, 'a run was allocated');
  return first;
};
const run = (world: RuntimeWorld): string => allocation(world).name;
const openDescriptors = (): number => readdirSync('/dev/fd').length;

function nodeContract(world: RuntimeWorld, calls: HostCalls): Contract {
  const parent = scratchDirectory(world);
  const root = join(parent, 'root');
  mkdirSync(root);
  const device = lstatSync(root, { bigint: true }).dev;
  return {
    filesystem: new NodeRuntimeFilesystem(calls),
    parent,
    root,
    device,
    memory: undefined,
    runs: [],
    arranged: [],
    identities: new Map(),
    made: [],
    descriptors: openDescriptors(),
  };
}

Given('a runtime filesystem of the {word} adapter over a scratch root', function (adapter: string) {
  if (adapter === 'memory') {
    const memory = new MemoryRuntimeFilesystem()
      .directory('/scratch/root', MEMORY_DEVICE)
      .directory('/home/owner', MEMORY_HOME_DEVICE)
      .homeAt('/home/owner')
      .free(MEMORY_DEVICE, 1000n, 4096n)
      .free(MEMORY_HOME_DEVICE, 10n, 512n);
    this.state['contract'] = {
      filesystem: memory,
      parent: '/scratch',
      root: '/scratch/root',
      device: MEMORY_DEVICE,
      memory,
      runs: [],
      arranged: [],
      identities: new Map(),
      made: [],
      descriptors: 0,
    };
    return;
  }
  assert.equal(adapter, 'node');
  this.state['contract'] = nodeContract(this, HOST_CALLS);
});

/** Stats of `stats` with some fields replaced, methods included (they read the fields). */
const restated = (stats: BigIntStats, fields: Partial<BigIntStats>): BigIntStats =>
  Object.assign(Object.create(Object.getPrototypeOf(stats) as object) as BigIntStats, stats, fields);

const ioError = (): Error => Object.assign(new Error('an I/O error of the scenario'), { code: 'EIO' });

/** The calls of the host adapter, with what a scenario stages in place of one of them. */
function stagedCalls(staged: string): HostCalls {
  let reads = 0;
  let stats = 0;
  const calls: Record<string, Partial<HostCalls>> = {
    'read seven bytes at most': {
      read: (descriptor, buffer, offset, length) =>
        readSync(descriptor, buffer, offset, Math.min(7, length), null),
    },
    'read seven bytes, then the end': {
      read: (descriptor, buffer, offset, length) =>
        reads++ === 0 ? readSync(descriptor, buffer, offset, Math.min(7, length), null) : 0,
    },
    'stat the descriptor one byte smaller': {
      fstat: (descriptor) => {
        const real = HOST_CALLS.fstat(descriptor);
        return restated(real, { size: real.size - 1n });
      },
    },
    'stat the descriptor as a pipe': {
      fstat: (descriptor) => restated(HOST_CALLS.fstat(descriptor), { isFile: () => false }),
    },
    'fail to read': {
      read: () => {
        throw ioError();
      },
    },
    'fail to stat the descriptor': {
      fstat: () => {
        throw ioError();
      },
    },
    'fail to close, then close': {
      close: (descriptor) => {
        closeSync(descriptor);
        throw ioError();
      },
    },
    'fail to write': {
      write: () => {
        throw ioError();
      },
    },
    'stat the directory with another inode the second time': {
      stat: (path) => {
        const real = HOST_CALLS.stat(path);
        return stats++ === 0 ? real : restated(real, { ino: real.ino + 1n });
      },
    },
    'stat the directory with another device the second time': {
      stat: (path) => {
        const real = HOST_CALLS.stat(path);
        return stats++ === 0 ? real : restated(real, { dev: real.dev + 1n });
      },
    },
    // As when another process removes it between the moment it is made and the moment it is inspected.
    'remove what is at a path before they look at it': {
      lstat: (path) => {
        rmSync(path, { recursive: true, force: true });
        return HOST_CALLS.lstat(path);
      },
    },
  };
  const replaced = calls[staged];
  assert.ok(replaced !== undefined, `no such staged call in these scenarios: ${staged}`);
  return { ...HOST_CALLS, ...replaced };
}

Given(
  'a runtime filesystem of the node adapter over a scratch root, whose calls {}',
  function (staged: string) {
    this.state['contract'] = nodeContract(this, stagedCalls(staged));
  },
);

/** Arranges an entry at an absolute path, on the disk or in memory. */
function arrange(
  world: RuntimeWorld,
  path: string,
  kind: 'directory' | 'closed' | { link: string } | { text: Uint8Array },
): void {
  const { memory, device, root, arranged, identities } = contract(world);
  arranged.push(relative(root, path));
  if (memory === undefined) {
    if (kind === 'directory' || kind === 'closed') {
      mkdirSync(path, { recursive: true });
      if (kind === 'closed') chmodSync(path, 0o500);
      identities.set(path, lstatSync(path, { bigint: true }).ino);
    } else if ('link' in kind) symlinkSync(kind.link, path);
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, kind.text);
    }
    return;
  }
  if (kind === 'directory') memory.directory(path, device);
  else if (kind === 'closed') memory.directory(path, device).seal(path);
  else if ('link' in kind) memory.link(path);
  else {
    if (memory.at(dirname(path)) === undefined) memory.directory(dirname(path), device);
    memory.file(path, kind.text, device);
  }
  identities.set(path, memory.at(path));
}

/** The identity of what is at a path now, as `arrange` records it. */
function identityAt(world: RuntimeWorld, path: string): unknown {
  const { memory } = contract(world);
  return memory === undefined ? lstatSync(path, { bigint: true }).ino : memory.at(path);
}

const inRoot = (world: RuntimeWorld, path: string): string => join(contract(world).root, path);
const inRun = (world: RuntimeWorld, path: string): string =>
  join(contract(world).root, 'run', run(world), path);

Given('the scratch entry {string} is a directory', function (path: string) {
  arrange(this, inRoot(this, path), 'directory');
});

Given('the scratch entry {string} is a closed directory', function (path: string) {
  arrange(this, inRoot(this, path), 'closed');
});

Given('the scratch entry {string} is a link to {string}', function (path: string, target: string) {
  arrange(this, inRoot(this, path), { link: inRoot(this, target) });
});

Given('the scratch entry {string} is a file holding {string}', function (path: string, text: string) {
  arrange(this, inRoot(this, path), { text: markerBytes(text) });
});

Given('the scratch entry {string} is a file of {int} bytes', function (path: string, size: number) {
  arrange(this, inRoot(this, path), { text: new Uint8Array(size).fill(0x61) });
});

Given('the run entry {string} is a link to {string}', function (path: string, target: string) {
  arrange(this, inRun(this, path), { link: inRoot(this, target) });
});

Given('the run entry {string} is a closed directory', function (path: string) {
  arrange(this, inRun(this, path), 'closed');
});

Given('the run entry {string} is a file holding {string}', function (path: string, text: string) {
  arrange(this, inRun(this, path), { text: markerBytes(text) });
});

Given('the scratch entry {string} is a directory that cannot be searched', function (path: string) {
  const { memory, device } = contract(this);
  const directory = inRoot(this, path);
  if (memory !== undefined) {
    memory.directory(directory, device).cannotSearch(directory);
    return;
  }
  mkdirSync(directory);
  chmodSync(directory, 0o000);
  this.cleanups.push(() => chmodSync(directory, 0o700));
});

When('the run entry {string} is replaced by a link to {string}', function (path: string, target: string) {
  const { memory } = contract(this);
  const entry = inRun(this, path);
  if (memory !== undefined) memory.link(entry);
  else {
    rmSync(entry, { recursive: true });
    symlinkSync(inRoot(this, target), entry);
  }
});

/** Removes what is at an absolute path and below it, on the disk or in memory. */
function erase(world: RuntimeWorld, path: string): void {
  const { memory } = contract(world);
  if (memory !== undefined) memory.erase(path);
  else rmSync(path, { recursive: true });
}

When('the run entry {string} is removed', function (path: string) {
  erase(this, inRun(this, path).replace(/\/$/, ''));
});

When('the scratch entry {string} is removed', function (path: string) {
  erase(this, inRoot(this, path));
});

When('the run is replaced by another directory', function () {
  const { memory, device } = contract(this);
  const directory = inRun(this, '');
  if (memory !== undefined) memory.directory(directory, device);
  else {
    renameSync(directory, `${directory}-old`);
    mkdirSync(directory);
  }
});

When('the directory "run" is replaced by a link to its copy', function () {
  const { memory, root } = contract(this);
  const runs = join(root, 'run');
  if (memory !== undefined) memory.link(runs);
  else {
    renameSync(runs, join(root, 'copy of run'));
    symlinkSync(join(root, 'copy of run'), runs);
  }
});

/** What is at an absolute path: a directory, a file, a link, or nothing. */
function kindAt(world: RuntimeWorld, path: string): string | undefined {
  const { memory } = contract(world);
  if (memory !== undefined) return memory.at(path)?.kind;
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (stats === undefined) return undefined;
  return stats.isDirectory()
    ? 'directory'
    : stats.isFile()
      ? 'file'
      : stats.isSymbolicLink()
        ? 'link'
        : 'special';
}

function textAt(world: RuntimeWorld, path: string): string {
  const { memory } = contract(world);
  if (memory === undefined) return readFileSync(path, 'utf8');
  const node = memory.at(path);
  assert.ok(node?.kind === 'file', `${path} is a file`);
  return new TextDecoder().decode(node.bytes);
}

Then(
  'the runtime filesystem finds the scratch root a directory, with the device and the inode of its samples',
  function () {
    const { filesystem, root, device } = contract(this);
    const state = filesystem.inspectRoot(root);
    assert.ok(state.kind === 'directory');
    assert.equal(state.device, device);
    const sample = filesystem.sample(root);
    assert.deepEqual([sample?.device, sample?.inode], [device, state.inode]);
  },
);

Then(
  'the runtime filesystem finds {string} below the scratch root: {string}',
  function (path: string, outcome: string) {
    const { filesystem, root, device } = contract(this);
    assert.equal(filesystem.findDirectory(root, device, below(path)), outcome);
  },
);

Then(
  'the runtime filesystem finds {string} below the scratch root on another device: {string}',
  function (path: string, outcome: string) {
    const { filesystem, root, device } = contract(this);
    assert.equal(filesystem.findDirectory(root, device + 1n, below(path)), outcome);
  },
);

Then(
  'the runtime filesystem finds no component below the scratch root: {string}',
  function (outcome: string) {
    const { filesystem, root, device } = contract(this);
    assert.equal(filesystem.findDirectory(root, device, []), outcome);
  },
);

Then(
  'the runtime filesystem made nothing below the scratch root but what the scenario arranged',
  function () {
    const { memory, root, arranged } = contract(this);
    if (memory !== undefined) assert.deepEqual(memory.created, []);
    else {
      const found = readdirSync(root, { recursive: true }).map(String).sort();
      assert.deepEqual(found, [...new Set(arranged)].sort());
    }
  },
);

Then('the runtime filesystem gives no sample of the scratch root', function () {
  const { filesystem, root } = contract(this);
  assert.equal(filesystem.sample(root), undefined);
});

Then('the runtime filesystem reads the marker of the scratch root as {}', function (reading: string) {
  const { filesystem, root } = contract(this);
  const marker = filesystem.readMarker(root);
  if (reading === 'unreadable') assert.deepEqual(marker, { kind: 'unreadable' });
  else {
    assert.equal(reading, 'its bytes');
    assert.ok(marker.kind === 'file');
    assert.deepEqual(
      [...marker.bytes],
      [...markerBytes('architect-os-runtime-root/v2\\nenvironment=server\\n')],
    );
  }
});

Then('the host runtime filesystem has closed every descriptor it opened', function () {
  assert.equal(openDescriptors(), contract(this).descriptors);
});

Then('the runtime filesystem finds the root {string} {word}', function (path: string, kind: string) {
  assert.deepEqual(contract(this).filesystem.inspectRoot(inRoot(this, path)), { kind });
});

Then(
  'the runtime filesystem finds the root {string} a directory with another inode than the scratch root',
  function (path: string) {
    const { filesystem, root, device } = contract(this);
    const state = filesystem.inspectRoot(inRoot(this, path));
    const scratch = filesystem.inspectRoot(root);
    assert.ok(state.kind === 'directory' && scratch.kind === 'directory');
    assert.equal(state.device, device);
    assert.notEqual(state.inode, scratch.inode);
  },
);

Then('the runtime filesystem finds no marker in {string}', function (path: string) {
  assert.deepEqual(contract(this).filesystem.readMarker(inRoot(this, path)), { kind: 'absent' });
});

Then(
  'the runtime filesystem reads the marker of {string} as {string}, on the device of the scratch root',
  function (path: string, text: string) {
    const marker = contract(this).filesystem.readMarker(inRoot(this, path));
    assert.ok(marker.kind === 'file');
    assert.deepEqual([...marker.bytes], [...markerBytes(text)]);
    assert.equal(marker.device, contract(this).device);
  },
);

Then(
  'the runtime filesystem reads a marker of {int} bytes in {string}',
  function (size: number, path: string) {
    const marker = contract(this).filesystem.readMarker(inRoot(this, path));
    assert.ok(marker.kind === 'file');
    assert.equal(marker.bytes.length, size);
  },
);

Then('the runtime filesystem cannot read the marker of {string}', function (path: string) {
  assert.deepEqual(contract(this).filesystem.readMarker(inRoot(this, path)), { kind: 'unreadable' });
});

Then(
  'the runtime filesystem samples the scratch root with a positive unit and a count of available blocks',
  function () {
    const { filesystem, root, device } = contract(this);
    const sample = filesystem.sample(root);
    assert.ok(sample !== undefined);
    assert.equal(sample.device, device);
    assert.equal(typeof sample.blockSize, 'bigint');
    assert.equal(typeof sample.availableBlocks, 'bigint');
    assert.ok(sample.blockSize > 0n, 'a positive unit');
    assert.ok(sample.availableBlocks >= 0n, 'a count');
  },
);

Then('the runtime filesystem gives no sample of {string}', function (path: string) {
  assert.equal(contract(this).filesystem.sample(inRoot(this, path)), undefined);
});

Then('the runtime filesystem names a home directory and samples it', function () {
  const { filesystem } = contract(this);
  const home = filesystem.homeDirectory();
  assert.ok(home !== undefined && home.startsWith('/'), 'an absolute home');
  const sample = filesystem.sample(home);
  assert.ok(sample !== undefined && sample.blockSize > 0n);
});

Then(
  'the runtime filesystem ensures {string} below the scratch root: {string}',
  function (path: string, outcome: string) {
    const { filesystem, root, device } = contract(this);
    assert.equal(filesystem.ensureDirectory(root, device, below(path)), outcome);
  },
);

Then(
  'the runtime filesystem ensures {string} below the scratch root on another device: {string}',
  function (path: string, outcome: string) {
    const { filesystem, root, device } = contract(this);
    assert.equal(filesystem.ensureDirectory(root, device + 1n, below(path)), outcome);
  },
);

Then(
  'the runtime filesystem ensures no component below the scratch root: {string}',
  function (outcome: string) {
    const { filesystem, root, device } = contract(this);
    assert.equal(filesystem.ensureDirectory(root, device, []), outcome);
  },
);

Then('the scratch entries {string} and {string} are directories', function (first: string, second: string) {
  assert.equal(kindAt(this, inRoot(this, first)), 'directory');
  assert.equal(kindAt(this, inRoot(this, second)), 'directory');
});

Then('the scratch entry {string} does not exist', function (path: string) {
  assert.equal(kindAt(this, inRoot(this, path)), undefined);
});

Then('the scratch entry {string} is empty', function (path: string) {
  const { memory } = contract(this);
  const directory = inRoot(this, path);
  if (memory === undefined) assert.deepEqual(readdirSync(directory), []);
  else
    assert.deepEqual(
      memory.created.filter((made) => made.startsWith(`${directory}/`)),
      [],
    );
});

Then(
  'the runtime filesystem refuses to find or make a shared directory, and to make a directory and a file in the run, with the component {string}',
  function (text: string) {
    const component = unescape(text);
    const { filesystem, root, device, parent } = contract(this);
    assert.equal(filesystem.findDirectory(root, device, [component, 'fresh']), 'unsafe');
    assert.equal(filesystem.ensureDirectory(root, device, [component, 'fresh']), 'unsafe');
    assert.equal(filesystem.createDirectory(root, ['run', 'rfixed1', component]), false);
    assert.equal(filesystem.createFile(root, ['run', 'rfixed1', component], 'x'), false);
    for (const path of [
      join(parent, 'fresh'),
      join(root, 'fresh'),
      join(root, 'a', 'b'),
      join(root, 'run', 'rfixed1', 'a', 'b'),
    ]) {
      assert.equal(kindAt(this, path), undefined, path);
    }
    if (contract(this).memory !== undefined) assert.deepEqual(contract(this).memory?.created, []);
  },
);

When('the runtime filesystem allocates {int} runs', function (count: number) {
  const { filesystem, root } = contract(this);
  contract(this).runs = Array.from({ length: count }, () => filesystem.allocateRun(root));
});

Then(
  'the {int} runs are distinct directories directly in {string}, each named r and six letters or digits',
  function (count: number, directory: string) {
    const names = contract(this).runs.map((made) => made?.name);
    assert.equal(new Set(names).size, count);
    for (const name of names) {
      assert.match(name ?? '', /^r[A-Za-z0-9]{6}$/);
      assert.equal(kindAt(this, join(inRoot(this, directory), name as string)), 'directory');
    }
  },
);

Then('each run allocated has the device and the inode of its directory', function () {
  const { runs, root } = contract(this);
  for (const made of runs) {
    assert.ok(made !== undefined);
    const path = join(root, 'run', made.name);
    const { memory } = contract(this);
    const node = memory === undefined ? lstatSync(path, { bigint: true }) : memory.at(path);
    const identity = node as { dev?: bigint; ino?: bigint; device?: bigint; inode?: bigint };
    assert.deepEqual(
      [made.device, made.inode],
      memory === undefined ? [identity.dev, identity.ino] : [identity.device, identity.inode],
    );
  }
});

Then(
  'the scratch root, "run", "cache", "cache\\/npm", the run, its "tmp" and its "config" are directories of seven distinct identities',
  function () {
    const { filesystem, root } = contract(this);
    const paths = [
      root,
      ...['run', 'cache', 'cache/npm'].map((path) => inRoot(this, path)),
      ...['', 'tmp', 'config'].map((path) => inRun(this, path)),
    ];
    const identities = paths.map((path) => {
      const state = filesystem.inspectRoot(path);
      assert.ok(state.kind === 'directory', `${path} is a directory`);
      return `${state.device}:${state.inode}`;
    });
    assert.equal(new Set(identities).size, 7, identities.join(', '));
  },
);

Then('the run allocated is not {string}', function (name: string) {
  assert.notEqual(run(this), name);
  assert.match(run(this), /^r[A-Za-z0-9]{6}$/);
});

Then(
  'the scratch entry {string} is the directory it was, still holding {string}',
  function (path: string, text: string) {
    const directory = inRoot(this, path);
    assert.equal(identityAt(this, directory), contract(this).identities.get(directory));
    assert.equal(textAt(this, join(directory, text)), text);
  },
);

When(
  'the runtime filesystem makes in the run the directories {string}, {string} and {string} and the file {string}',
  function (first: string, second: string, third: string, file: string) {
    const { filesystem, root } = contract(this);
    for (const path of [first, second, third]) {
      assert.equal(filesystem.createDirectory(root, ['run', run(this), ...below(path)]), true);
      contract(this).made.push(below(path));
    }
    assert.equal(filesystem.createFile(root, ['run', run(this), ...below(file)], ''), true);
    contract(this).made.push(below(file));
  },
);

/** The identity of the scratch root, as the port inspects it. */
function rootIdentity(world: RuntimeWorld): { device: bigint; inode: bigint } {
  const state = contract(world).filesystem.inspectRoot(contract(world).root);
  assert.ok(state.kind === 'directory');
  return { device: state.device, inode: state.inode };
}

Then('the runtime filesystem discards the run with what it made: {word}', function (removed: string) {
  const { filesystem, root, made } = contract(this);
  assert.equal(filesystem.discardRun(root, rootIdentity(this), allocation(this), made), removed === 'true');
});

Then('the runtime filesystem discards the run, told {}: false', function (told: string) {
  const { filesystem, root, made } = contract(this);
  const identity = rootIdentity(this);
  const own = allocation(this);
  const changes: Record<string, [typeof identity, RunAllocation]> = {
    'another device for root': [{ ...identity, device: identity.device + 1n }, own],
    'another inode for root': [{ ...identity, inode: identity.inode + 1n }, own],
    'another device for run': [identity, { ...own, device: own.device + 1n }],
    'another inode for run': [identity, { ...own, inode: own.inode + 1n }],
  };
  const [rootTold, runTold] = changes[told] as [typeof identity, RunAllocation];
  assert.equal(filesystem.discardRun(root, rootTold, runTold, made), false);
});

Then('the runtime filesystem discards the run with the paths {}: false', function (paths: string) {
  const { filesystem, root } = contract(this);
  const made = (JSON.parse(`[${paths}]`) as string[]).map((path) => (path === '' ? [] : below(path)));
  assert.equal(filesystem.discardRun(root, rootIdentity(this), allocation(this), made), false);
});

Then('the run allocated does not exist', function () {
  assert.equal(kindAt(this, inRun(this, '')), undefined);
});

Then('the run allocated does not exist, nor what it made in it', function () {
  assert.equal(kindAt(this, inRun(this, '')), undefined);
  for (const made of contract(this).made) assert.equal(kindAt(this, inRun(this, made.join('/'))), undefined);
});

Then('the scratch entry {string} holds {string}', function (path: string, text: string) {
  assert.equal(textAt(this, inRoot(this, path)), text);
});

Then('the run entry {string} holds {string}', function (path: string, text: string) {
  assert.equal(textAt(this, inRun(this, path)), text);
});

Then('the run entry {string} is a {word}', function (path: string, kind: string) {
  assert.equal(kindAt(this, inRun(this, path)), kind);
});

Then('the run entry {string} does not exist', function (path: string) {
  assert.equal(kindAt(this, inRun(this, path)), undefined);
});

Then('the run directory is not the one allocated', function () {
  const own = allocation(this);
  const { memory } = contract(this);
  const now = identityAt(this, inRun(this, ''));
  if (memory === undefined) assert.notEqual(now, own.inode);
  else assert.notEqual((now as { inode: bigint }).inode, own.inode);
});

Then('the runtime filesystem allocated none', function () {
  assert.deepEqual(contract(this).runs, [undefined]);
});

Then(
  'the runtime filesystem makes the directory {string} in the run: {word}',
  function (path: string, made: string) {
    const { filesystem, root } = contract(this);
    assert.equal(filesystem.createDirectory(root, ['run', run(this), ...below(path)]), made === 'true');
  },
);

Then(
  'the runtime filesystem makes the file {string} holding {string} in the run: {word}',
  function (path: string, text: string, made: string) {
    const { filesystem, root } = contract(this);
    assert.equal(filesystem.createFile(root, ['run', run(this), ...below(path)], text), made === 'true');
  },
);

Then('the run file {string} holds {string}', function (path: string, text: string) {
  assert.equal(textAt(this, inRun(this, path)), text);
});

Then(
  'the runtime filesystem makes no file nor directory directly in "run", in "cache\\/npm" or at the root',
  function () {
    const { filesystem, root } = contract(this);
    for (const path of [['run', 'x'], ['cache', 'npm', 'x'], ['x'], ['x', 'y', 'z']]) {
      assert.equal(filesystem.createDirectory(root, path), false, path.join('/'));
      assert.equal(filesystem.createFile(root, path, 'x'), false, path.join('/'));
      assert.equal(kindAt(this, join(root, ...path)), undefined, path.join('/'));
    }
  },
);

Then(
  'on the host the run and "tmp" have the mode 700, "admission.json" the mode 600 and "cache\\/npm" the mode 700',
  function () {
    const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8);
    assert.equal(mode(inRun(this, '')), '700');
    assert.equal(mode(inRun(this, 'tmp')), '700');
    assert.equal(mode(inRun(this, 'admission.json')), '600');
    assert.equal(mode(inRoot(this, 'cache')), '700');
    assert.equal(mode(inRoot(this, 'cache/npm')), '700');
  },
);

Then(
  'reading the marker of the scratch root and of "folder", then making two files in the run, leaves as many descriptors open as before',
  function () {
    const { filesystem, root } = contract(this);
    const open = openDescriptors;
    const before = open();
    assert.equal(filesystem.readMarker(root).kind, 'file');
    assert.equal(filesystem.readMarker(inRoot(this, 'folder')).kind, 'unreadable');
    assert.equal(filesystem.createFile(root, ['run', run(this), 'one'], 'x'), true);
    assert.equal(filesystem.createFile(root, ['run', run(this), 'two'], ''), true);
    assert.equal(open(), before);
  },
);

Then(
  'the host runtime filesystem names the home of the account record even when HOME names another directory',
  function () {
    const { filesystem, parent } = contract(this);
    const home = process.env['HOME'];
    process.env['HOME'] = parent;
    try {
      assert.equal(filesystem.homeDirectory(), userInfo().homedir);
      assert.notEqual(filesystem.homeDirectory(), parent);
    } finally {
      if (home === undefined) delete process.env['HOME'];
      else process.env['HOME'] = home;
    }
  },
);
