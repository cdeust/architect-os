import assert from 'node:assert/strict';
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  closedEnvironment,
  runToEnd,
  runToFile,
  type Finished,
} from '../../src/infrastructure/host-process.js';
import { temporaryDirectory } from './fixtures.js';
import { Given, Then, When, type DeliverWorld } from './support.js';

// The scenarios of host-process.ts (host-process.feature): node, started through its own path.

const MISSING = '/nonexistent/program';

interface Run {
  directory: string;
  file: string;
  finished?: Finished | undefined;
  exitCode?: number;
  /** The descriptors this process holds, before and after a run to a file. */
  descriptors?: [number, number];
}

/** How many descriptors this process holds open (`/dev/fd` lists them on Linux and macOS). */
const openDescriptors = (): number => readdirSync('/dev/fd').length;

const runOf = (world: DeliverWorld): Run => {
  world.state['hostProcess'] ??= { directory: '', file: '' } satisfies Run;
  const run = world.state['hostProcess'] as Run;
  if (run.directory === '') {
    run.directory = realpathSync(temporaryDirectory(world));
    run.file = join(run.directory, 'out.log');
  }
  return run;
};

const toEnd = (
  world: DeliverWorld,
  program: string,
  args: string[],
  environment: Record<string, string>,
): void => {
  const run = runOf(world);
  run.finished = runToEnd(program, args, run.directory, environment);
};

When('I run the script {string} to its end', function (script: string) {
  toEnd(this, process.execPath, ['-e', script], {});
});

When(
  'I run the script {string} with the argument {string} to its end',
  function (script: string, argument: string) {
    toEnd(this, process.execPath, ['-e', script, argument], {});
  },
);

When(
  'I run the script {string} with only the variable {string} set to {string} to its end',
  function (script: string, name: string, value: string) {
    toEnd(this, process.execPath, ['-e', script], { [name]: value });
  },
);

When('I run a program that does not exist to its end', function () {
  toEnd(this, MISSING, [], {});
});

Then('the program ended with {int} and printed {string}', function (status: number, out: string) {
  assert.deepEqual(runOf(this).finished, { status, out });
});

Then('the program did not run to its end', function () {
  assert.equal(runOf(this).finished, undefined);
});

When('I run the script {string} with the environment of this process to its end', function (script: string) {
  toEnd(
    this,
    process.execPath,
    ['-e', script],
    Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  );
});

// The closed environment of a program: `closedEnvironment`.

When(
  'I close the environment of the names {string} over a host that sets {string} with {string} added',
  function (names: string, host: string, added: string) {
    const pairs = (text: string): [string, string][] =>
      text === '' ? [] : text.split(',').map((pair) => pair.split('=') as [string, string]);
    this.state['closed'] = closedEnvironment(
      { names: names === '' ? [] : names.split(','), env: Object.fromEntries(pairs(host)) },
      Object.fromEntries(pairs(added)),
    );
  },
);

When(
  'I close the environment of the name {string} over a host that leaves it undefined',
  function (name: string) {
    this.state['closed'] = closedEnvironment({ names: [name], env: { [name]: undefined } }, {});
  },
);

Then('the closed environment is {string}', function (expected: string) {
  assert.deepEqual(
    this.state['closed'],
    expected === ''
      ? {}
      : Object.fromEntries(expected.split(',').map((pair) => pair.split('=') as [string, string])),
  );
});

Then('the program printed the directory it ran in', function () {
  const run = runOf(this);
  assert.equal(run.finished?.out, run.directory);
});

Given(
  'this process has the variable {string} set to {string} until the scenario ends',
  function (name: string, value: string) {
    const before = process.env[name];
    process.env[name] = value;
    this.cleanups.push(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
  },
);

Given('the file already holds {string}', function (text: string) {
  writeFileSync(runOf(this).file, text);
});

const toFile = async (world: DeliverWorld, program: string, args: string[]): Promise<void> => {
  const run = runOf(world);
  const before = openDescriptors();
  run.exitCode = await runToFile(program, args, run.directory, run.file);
  run.descriptors = [before, openDescriptors()];
};

When('I run the script {string} to a file', async function (script: string) {
  await toFile(this, process.execPath, ['-e', script]);
});

When('I run a program whose name holds a NUL to a file', async function () {
  await toFile(this, 'no\0program', []);
});

When('I run a program that does not exist to a file', async function () {
  await toFile(this, MISSING, []);
});

Then('the run left no descriptor open', function () {
  const [before, after] = runOf(this).descriptors ?? [];
  assert.notEqual(before, undefined);
  assert.equal(after, before);
});

Then('the program exited {int}', function (code: number) {
  assert.equal(runOf(this).exitCode, code);
});

Then('the file holds {string}', function (text: string) {
  assert.equal(readFileSync(runOf(this).file, 'utf8'), text);
});

Then('the file holds the directory it ran in', function () {
  const run = runOf(this);
  assert.equal(readFileSync(run.file, 'utf8'), run.directory);
});
