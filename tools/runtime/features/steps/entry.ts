import assert from 'node:assert/strict';
import type { DataTable } from '@cucumber/cucumber';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER_NAME } from '../../src/domain/marker.js';
import { REFUSAL_CODES } from '../../src/domain/refusal.js';
import type { RuntimeFilesystem } from '../../src/domain/ports.js';
import { MemoryRuntimeFilesystem } from '../../src/infrastructure/memory-runtime-filesystem.js';
import { NodeRuntimeFilesystem } from '../../src/infrastructure/node-runtime-filesystem.js';
import {
  admissionDependencies,
  npmNamesDependencies,
  POLICY_FILE,
  runAdmission,
  runNpmNames,
  type AdmissionDependencies,
  type NpmNamesDependencies,
} from '../../src/main.js';
import {
  Given,
  kept,
  markerBytes,
  POLICY_PATH,
  scratchDirectory,
  Then,
  unescape,
  When,
  type RuntimeWorld,
} from './support.js';

interface Recorded {
  stdout: string;
  stderr: string;
}

/** The committed policy text, with every floor replaced. */
function policyWithFloors(floor: string): string {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as {
    environments: Record<string, Record<string, string>>;
  };
  for (const reserve of Object.values(policy.environments)) {
    reserve['rootFloorBytes'] = floor;
    reserve['homeFloorBytes'] = floor;
  }
  return JSON.stringify(policy);
}

function policyText(argument: string): () => string | undefined {
  if (argument === 'unreadable') return () => undefined;
  const floors = /^with floors of "(.*)" byte$/.exec(argument);
  const text = floors === null ? unescape(argument.slice(1, -1)) : policyWithFloors(floors[1] as string);
  return () => text;
}

function command(world: RuntimeWorld, filesystem: RuntimeFilesystem, policy: () => string | undefined): void {
  const recorded: Recorded = { stdout: '', stderr: '' };
  world.state['recorded'] = recorded;
  world.state['command'] = (argv: readonly string[]): number =>
    runAdmission({
      argv,
      stdout: { write: (text: string) => (recorded.stdout += text) },
      stderr: { write: (text: string) => (recorded.stderr += text) },
      filesystem,
      policyText: policy,
      clock: () => new Date('2026-11-19T10:00:00.000Z'),
    });
}

Given(
  'a runtime command over a memory root marked {string} with room, and the policy text {}',
  function (environment: string, text: string) {
    const filesystem = new MemoryRuntimeFilesystem()
      .directory('/mnt/aos', 7n)
      .file(
        `/mnt/aos/${MARKER_NAME}`,
        markerBytes(`architect-os-runtime-root/v2\\nenvironment=${environment}\\n`),
        7n,
      )
      .directory('/home/owner', 8n)
      .homeAt('/home/owner')
      .free(7n, 2n, 1n)
      .free(8n, 2n, 1n);
    this.state['commandFilesystem'] = filesystem;
    command(this, filesystem, policyText(text));
  },
);

Given(
  'the shared directory {string} of the memory root of the runtime command becomes a link between the two passes',
  function (path: string) {
    kept<MemoryRuntimeFilesystem>(this, 'commandFilesystem').changeBetweenPasses((filesystem) =>
      filesystem.link(path),
    );
  },
);

Given('a runtime command whose filesystem throws when it inspects a root', function () {
  const filesystem = new MemoryRuntimeFilesystem();
  filesystem.inspectRoot = () => {
    throw new Error('an I/O error nobody foresaw');
  };
  command(this, filesystem, policyText('with floors of "1" byte'));
});

Given(
  'a runtime command over a scratch root on the host marked {string}, and the policy text {}',
  function (environment: string, text: string) {
    const root = scratchDirectory(this);
    writeFileSync(join(root, MARKER_NAME), `architect-os-runtime-root/v2\nenvironment=${environment}\n`);
    this.state['scratchRoot'] = root;
    command(this, new NodeRuntimeFilesystem(), policyText(text));
  },
);

const runCommand = (world: RuntimeWorld, argv: readonly string[]): void => {
  world.state['exit'] = kept<(argv: readonly string[]) => number>(world, 'command')(argv);
};

When('the runtime command runs with the operands {string}', function (operands: string) {
  runCommand(this, operands === '' ? [] : operands.split(' '));
});

When('the runtime command runs with an empty root and the kind {string}', function (kind: string) {
  runCommand(this, ['', kind]);
});

When(
  'the runtime command runs with the scratch root and the kind {string} as its operands',
  function (kind: string) {
    runCommand(this, [kept<string>(this, 'scratchRoot'), kind]);
  },
);

Then(
  'the runtime command exits {int}, printing {string} on stdout and {string} on stderr',
  function (exit: number, stdout: string, stderr: string) {
    assert.deepEqual(
      { exit: kept(this, 'exit'), ...kept<Recorded>(this, 'recorded') },
      { exit, stdout: unescape(stdout), stderr: unescape(stderr) },
    );
  },
);

Then(
  'the runtime command exits 0, and the receipt of the run it prints names {string}, the kind {string} and the device of the scratch root',
  function (environment: string, kind: string) {
    const recorded = kept<Recorded>(this, 'recorded');
    assert.equal(kept(this, 'exit'), 0, recorded.stderr);
    assert.match(recorded.stdout, /^r[A-Za-z0-9]{6}\n$/);
    const root = kept<string>(this, 'scratchRoot');
    const receipt = JSON.parse(
      readFileSync(join(root, 'run', recorded.stdout.trim(), 'admission.json'), 'utf8'),
    ) as {
      environment: string;
      command: string;
      observations: { root: { device: string; inode: string } };
    };
    const stats = lstatSync(root, { bigint: true });
    assert.equal(receipt.environment, environment);
    assert.equal(receipt.command, kind);
    assert.deepEqual(receipt.observations.root, {
      ...receipt.observations.root,
      device: stats.dev.toString(),
      inode: stats.ino.toString(),
    });
  },
);

When(
  'I build the runtime command dependencies of a fake process with the arguments {string}',
  function (argv: string) {
    const fake = { argv: argv.split(' '), stdout: { write: () => true }, stderr: { write: () => true } };
    this.state['fakeProcess'] = fake;
    this.state['dependencies'] = admissionDependencies(fake);
  },
);

Then(
  'the runtime command dependencies hold the operands {string} and write to the streams of that process',
  function (operands: string) {
    const deps = kept<AdmissionDependencies>(this, 'dependencies');
    const fake = kept<{ stdout: unknown; stderr: unknown }>(this, 'fakeProcess');
    assert.deepEqual(deps.argv, operands.split(' '));
    assert.equal(deps.stdout, fake.stdout);
    assert.equal(deps.stderr, fake.stderr);
  },
);

Then(
  'the runtime command dependencies read the committed policy file of tools\\/runtime, with the host filesystem and the clock of the host',
  function () {
    const deps = kept<AdmissionDependencies>(this, 'dependencies');
    assert.equal(POLICY_FILE, POLICY_PATH);
    assert.equal(deps.policyText(), readFileSync(POLICY_PATH, 'utf8'));
    assert.ok(deps.filesystem instanceof NodeRuntimeFilesystem);
    const before = Date.now();
    const now = deps.clock().getTime();
    assert.ok(now >= before && now <= Date.now() + 1);
  },
);

When('the npm names of an environment with the names {string} are listed', function (names: string) {
  const recorded = { stdout: '' };
  this.state['npmNamesExit'] = runNpmNames({
    names: names.split(','),
    stdout: { write: (text: string) => (recorded.stdout += text) },
  });
  this.state['npmNamesOut'] = recorded;
});

Then('the npm names listing exits 0, printing {string}', function (stdout: string) {
  assert.equal(kept(this, 'npmNamesExit'), 0);
  assert.equal(kept<{ stdout: string }>(this, 'npmNamesOut').stdout, unescape(stdout));
});

When(
  'I build the npm names dependencies of a fake process whose environment has the names {string}',
  function (names: string) {
    const fake = {
      env: Object.fromEntries(names.split(',').map((name) => [name, 'x'])),
      stdout: { write: () => true },
    };
    this.state['fakeProcess'] = fake;
    this.state['npmNamesDependencies'] = npmNamesDependencies(fake);
  },
);

Then(
  'the npm names dependencies hold the names {string} and write to the stdout of that process',
  function (names: string) {
    const deps = kept<NpmNamesDependencies>(this, 'npmNamesDependencies');
    assert.deepEqual(deps.names, names.split(','));
    assert.equal(deps.stdout, kept<{ stdout: unknown }>(this, 'fakeProcess').stdout);
  },
);

Then('the refusal codes of the admission are, in their order of checking:', function (table: DataTable) {
  assert.deepEqual(
    [...REFUSAL_CODES],
    table.raw().map(([code]) => code),
  );
});

Then(
  'the shell entry aos refuses with {string}, {string}, {string} and {string}, the first four of that list, in its order',
  function (first: string, second: string, third: string, fourth: string) {
    const codes = [first, second, third, fourth];
    const entry = readFileSync(fileURLToPath(new URL('../../../../aos', import.meta.url)), 'utf8');
    // In the order of their first place in the text of aos, which checks from the top down.
    const refused = [...entry.matchAll(/\brefuse ([A-Z_]+)/g)].map((match) => match[1] as string);
    assert.deepEqual([...new Set(refused)], codes);
    assert.deepEqual(REFUSAL_CODES.slice(0, codes.length), codes);
  },
);
