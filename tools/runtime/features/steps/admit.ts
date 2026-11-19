import assert from 'node:assert/strict';
import type { DataTable } from '@cucumber/cucumber';
import { admit, type Admission } from '../../src/application/admit.js';
import { MARKER_NAME } from '../../src/domain/marker.js';
import type { AdmissionPolicy, Reserve } from '../../src/domain/policy.js';
import type { CommandKind } from '../../src/domain/receipt.js';
import { MemoryRuntimeFilesystem } from '../../src/infrastructure/memory-runtime-filesystem.js';
import { Given, kept, markerBytes, Then, unescape, When, type RuntimeWorld } from './support.js';

const memory = (world: RuntimeWorld): MemoryRuntimeFilesystem =>
  kept<MemoryRuntimeFilesystem>(world, 'memoryFilesystem');
const admission = (world: RuntimeWorld): Admission => kept<Admission>(world, 'admission');

function admitted(world: RuntimeWorld): Extract<Admission, { admitted: true }> {
  const result = admission(world);
  assert.ok(result.admitted, `refused with ${result.admitted ? '' : result.code}`);
  return result;
}

Given('a runtime admission policy for the scenarios', function (table: DataTable) {
  const environments: Record<string, Reserve> = {};
  for (const row of table.hashes()) {
    environments[row['environment'] as string] = {
      rootFloorBytes: BigInt(row['root floor'] as string),
      homeFloorBytes: BigInt(row['home floor'] as string),
      status: 'provisional',
      basis: 'a reserve of these scenarios',
      review: 'step 4',
    };
  }
  this.state['policy'] = { version: 1, environments } as AdmissionPolicy;
});

Given('there is no valid runtime admission policy', function () {
  this.state['policy'] = 'none';
});

Given(
  'a memory runtime filesystem where {string} is a directory on device {int}',
  function (path: string, device: number) {
    this.state['memoryFilesystem'] = new MemoryRuntimeFilesystem().directory(path, BigInt(device));
  },
);

/** Puts at a path what a scenario names, in place of what was there. */
function arrange(world: RuntimeWorld, filesystem: MemoryRuntimeFilesystem, path: string, kind: string): void {
  // What holds a path holds its parent: a missing one is a directory on the device of the root of these scenarios.
  const parent = path.slice(0, path.lastIndexOf('/'));
  if (filesystem.at(parent) === undefined) filesystem.directory(parent, 7n);
  const directory = /^a directory on device (\d+)$/.exec(kind);
  const file = /^a regular file on device (\d+)$/.exec(kind);
  const sized = /^a regular file of (\d+) bytes on device (\d+)$/.exec(kind);
  if (directory !== null) {
    filesystem.directory(path, BigInt(directory[1] as string));
    world.state[`arranged ${path}`] = filesystem.at(path);
  } else if (file !== null) filesystem.file(path, markerBytes('x\n'), BigInt(file[1] as string));
  else if (sized !== null) {
    filesystem.file(path, new Uint8Array(Number(sized[1])).fill(0x61), BigInt(sized[2] as string));
  } else if (kind === 'a link') filesystem.link(path);
  else if (kind === 'a special file') filesystem.special(path);
  else assert.fail(`no such kind of path in these scenarios: ${kind}`);
}

Given('the memory runtime path {string} is {}', function (path: string, kind: string) {
  arrange(this, memory(this), path, kind);
});

Given(
  'the memory runtime path {string} becomes {} between the two passes over the shared directories',
  function (path: string, kind: string) {
    memory(this).changeBetweenPasses((filesystem) => arrange(this, filesystem, path, kind));
  },
);

Given(
  'the memory runtime marker of {string} reads {string} on device {int}',
  function (root: string, text: string, device: number) {
    memory(this).file(`${root}/${MARKER_NAME}`, markerBytes(text), BigInt(device));
  },
);

Given(
  'the memory runtime home is {string}, a directory on device {int}',
  function (path: string, device: number) {
    memory(this).directory(path, BigInt(device)).homeAt(path);
  },
);

Given('the memory runtime home is {string}, which does not exist', function (path: string) {
  memory(this).homeAt(path);
});

Given('the memory runtime home is unknown', function () {
  memory(this).homeAt(undefined);
});

Given(
  'the memory runtime device {int} has {string} blocks of {string} bytes free',
  function (device: number, blocks: string, unit: string) {
    memory(this).free(BigInt(device), BigInt(blocks), BigInt(unit));
  },
);

Given('the memory runtime directory {string} refuses new entries', function (path: string) {
  memory(this).seal(path);
});

Given('the memory runtime path {string} cannot be made', function (path: string) {
  memory(this).failAt(path);
});

Given(
  'the memory runtime path {string} cannot be made, and {string} is replaced by another directory as it is tried',
  function (path: string, replaced: string) {
    memory(this).failAt(path, replaced);
  },
);

Given('the memory runtime directory {string} cannot be searched', function (path: string) {
  memory(this).cannotSearch(path);
});

Given(
  'a sample of the memory runtime path {string} finds the device {int} and the inode {int}',
  function (path: string, device: number, inode: number) {
    memory(this).sampleAs(path, { device: BigInt(device), inode: BigInt(inode) });
  },
);

Given('the command of the runtime admission is of the kind {string}', function (kind: string) {
  this.state['commandKind'] = kind;
});

Given('the runtime clock throws {string}', function (message: string) {
  this.state['clockError'] = new Error(message);
});

Given('the runtime clock reads {string}', function (instant: string) {
  this.state['clock'] = new Date(instant);
});

function run(world: RuntimeWorld, setting: string | undefined): void {
  const policy = kept<AdmissionPolicy | 'none'>(world, 'policy');
  const instant = kept<Date>(world, 'clock');
  const error = world.state['clockError'];
  const clock = (): Date => {
    if (error !== undefined) throw error;
    return instant;
  };
  world.state['admission'] = admit(
    { filesystem: memory(world), policy: policy === 'none' ? undefined : policy, clock },
    setting,
    (world.state['commandKind'] as CommandKind | undefined) ?? 'npm',
  );
}

When('the runtime admission runs for the setting {string}', function (setting: string) {
  run(this, unescape(setting));
});

When('the runtime admission runs again for the setting {string}', function (setting: string) {
  run(this, setting);
});

When('the runtime admission runs with no setting', function () {
  run(this, undefined);
});

When('the runtime admission runs for the setting {string}, which throws', function (setting: string) {
  assert.throws(
    () => run(this, setting),
    (error: unknown) => {
      this.state['thrown'] = error;
      return true;
    },
  );
});

Then('the runtime admission threw {string}', function (message: string) {
  assert.equal(kept<Error>(this, 'thrown').message, message);
  assert.equal(this.state['admission'], undefined);
});

Then('the runtime admission is refused with {string}', function (code: string) {
  assert.deepEqual(admission(this), { admitted: false, code });
});

Then('the runtime admission outcome is {string}', function (outcome: string) {
  const result = admission(this);
  assert.equal(result.admitted ? 'admitted' : result.code, outcome);
});

Then('the memory runtime filesystem made nothing', function () {
  assert.deepEqual(memory(this).created, []);
});

Then('the memory runtime filesystem made, below {string}, only: {}', function (root: string, list: string) {
  const expected = list === 'nothing' ? [] : list.split(', ').map((below) => `${root}/${below}`);
  assert.deepEqual(memory(this).created, expected);
});

Then(
  'the memory runtime filesystem made {string} and did not make {string}',
  function (made: string, kept: string) {
    const { created } = memory(this);
    assert.ok(created.includes(made), `${made} was made`);
    assert.ok(!created.includes(kept), `${kept} was not made`);
  },
);

Then('the memory runtime filesystem removed, in this order: {}', function (list: string) {
  const run = '/mnt/aos/run/r000001';
  const expected =
    list === 'nothing' ? [] : list.split(', ').map((path) => (path === 'r000001' ? run : `${run}/${path}`));
  assert.deepEqual(memory(this).removed, expected);
});

Then(
  'the memory runtime path {string} remains the directory that was there, with {string}',
  function (path: string, inside: string) {
    assert.equal(memory(this).at(path), this.state[`arranged ${path}`]);
    assert.equal(memory(this).at(inside)?.kind, 'file');
  },
);

Then('the runtime receipt names the command kind {string}', function (kind: string) {
  assert.equal((JSON.parse(admitted(this).receipt) as { command: string }).command, kind);
});

Then('the runtime admission admits the run {string}', function (run: string) {
  assert.equal(admitted(this).run, run);
});

Then('the memory runtime filesystem made, in this order:', function (table: DataTable) {
  assert.deepEqual(
    memory(this).created,
    table.raw().map(([path]) => path),
  );
});

Then('the memory runtime file {string} holds {string}', function (path: string, text: string) {
  const node = memory(this).at(path);
  assert.ok(node?.kind === 'file', `${path} is a file`);
  assert.equal(new TextDecoder().decode(node.bytes), unescape(text));
});

Then('the runtime receipt of the admission, also in {string}, is:', function (path: string, receipt: string) {
  assert.equal(admitted(this).receipt, receipt);
  const node = memory(this).at(path);
  assert.ok(node?.kind === 'file', `${path} is a file`);
  assert.equal(new TextDecoder().decode(node.bytes), receipt);
});

Then('the memory runtime path {string} remains a directory', function (path: string) {
  assert.equal(memory(this).at(path)?.kind, 'directory');
});

Then('the memory runtime path {string} remains a file', function (path: string) {
  assert.equal(memory(this).at(path)?.kind, 'file');
});

Then('the memory runtime path {string} does not exist', function (path: string) {
  assert.equal(memory(this).at(path), undefined);
});

Then(
  'the runtime receipt names the environment {string}, the floors {string} and {string}, and the observations {string} and {string}',
  function (environment: string, rootFloor: string, homeFloor: string, root: string, home: string) {
    const receipt = JSON.parse(admitted(this).receipt) as {
      environment: string;
      floors: { rootBytes: string; homeBytes: string };
      observations: { root: { availableBytes: string }; home: { availableBytes: string } };
    };
    assert.equal(receipt.environment, environment);
    assert.deepEqual(receipt.floors, { rootBytes: rootFloor, homeBytes: homeFloor });
    assert.equal(receipt.observations.root.availableBytes, root);
    assert.equal(receipt.observations.home.availableBytes, home);
  },
);
