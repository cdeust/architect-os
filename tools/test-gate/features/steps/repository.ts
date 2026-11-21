import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import { CONFIG_PATH, runGate } from '../../src/infrastructure/gate.js';
import { git, gitWithOptions, GitRepository } from '../../src/infrastructure/git.js';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface GateWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: IDefineStep is generic in the World type
// (node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<GateWorld>;
export const When = CucumberWhen<GateWorld>;
export const Then = CucumberThen<GateWorld>;

export const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/** The `debt` of fixtures/gate.json: the empty registry every disposable repository starts with. */
export const DEBT_PATH = 'mutation-debt.json';

/**
 * A disposable git repository laid out like tools/test-gate/fixtures/gate.json expects (specs/, src/, mod/<name>/).
 * Real git, never this repository: commits are made with a fixed identity, no hook, no signature.
 */
export class GateRepository {
  readonly dir = mkdtempSync(join(tmpdir(), 'aos-gate-'));
  output = '';
  exitCode: number | undefined;

  constructor() {
    git(this.dir, ['init', '-q']);
    this.write(CONFIG_PATH, readFileSync(join(FIXTURES, 'gate.json'), 'utf8'));
    this.write('.gitignore', 'reports/\n');
    this.write(DEBT_PATH, '{"survivors": []}\n');
  }

  path(relative: string): string {
    return join(this.dir, relative);
  }

  write(relative: string, text: string): void {
    mkdirSync(dirname(this.path(relative)), { recursive: true });
    writeFileSync(this.path(relative), text);
  }

  read(relative: string): string {
    return readFileSync(this.path(relative), 'utf8');
  }

  exists(relative: string): boolean {
    return existsSync(this.path(relative));
  }

  remove(relative: string): void {
    rmSync(this.path(relative), { recursive: true, force: true });
  }

  /** Replaces every specs/*.feature by the named fixture specs of tools/test-gate/fixtures/suite/specs. */
  holdSpecs(names: readonly string[]): void {
    if (this.exists('specs')) {
      for (const name of readdirSync(this.path('specs')))
        if (name.endsWith('.feature')) this.remove(`specs/${name}`);
    }
    for (const name of names) cpSync(join(FIXTURES, 'suite', 'specs', name), this.path(`specs/${name}`));
  }

  commit(message: string): void {
    git(this.dir, ['add', '-A']);
    git(this.dir, [
      '-c',
      'user.name=gate',
      '-c',
      'user.email=gate@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      message,
    ]);
  }

  rev(name: string): string {
    return git(this.dir, ['rev-parse', name]).trim();
  }

  /** `<head>` and `<parent>` in an expected text stand for the SHAs of this repository. */
  tokens(text: string): string {
    if (!text.includes('<head>') && !text.includes('<parent>')) return text;
    const parent =
      git(this.dir, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ')[1] ?? 'NO-PARENT';
    return text.replaceAll('<head>', this.rev('HEAD')).replaceAll('<parent>', parent);
  }

  async run(
    args: readonly string[],
    env: NodeJS.ProcessEnv = { GITHUB_STEP_SUMMARY: this.path('summary.md') },
  ): Promise<void> {
    let output = '';
    const verdict = runGate(['node', 'main.ts', ...args], this.dir, env, {
      write: (text: string) => (output += text),
    });
    await assert.doesNotReject(verdict, 'Gate must return a verdict or a refusal diagnostic');
    this.exitCode = await verdict;
    this.output = output;
  }
}

export function repository(world: GateWorld): GateRepository {
  const found = world.state['gateRepository'];
  assert.ok(found instanceof GateRepository, 'a gate repository must be given first');
  return found;
}

/** The fixture specs named in a step, `green.feature, second.feature`. */
export function names(list: string): string[] {
  return list === '' ? [] : list.split(', ');
}

Given('a gate repository', function () {
  const created = new GateRepository();
  this.state['gateRepository'] = created;
  this.cleanups.push(() => rmSync(created.dir, { recursive: true, force: true }));
});

Given('the gate repository holds the fixture specs {string}', function (list: string) {
  repository(this).holdSpecs(names(list));
});

Given('the gate repository file {string} reads:', function (path: string, text: string) {
  repository(this).write(path, `${text}\n`);
});

Given(
  'the gate repository file {string} reads {string} with CRLF line ends',
  function (path: string, line: string) {
    repository(this).write(path, `${line}\r\n`);
  },
);

Given('the gate repository file {string} is removed', function (path: string) {
  repository(this).remove(path);
});

Given(
  'the gate repository holds the fixture file {string} as {string}',
  function (fixture: string, path: string) {
    repository(this).write(path, readFileSync(join(FIXTURES, fixture), 'utf8'));
  },
);

Given('the gate first parent is committed', function () {
  repository(this).commit('first parent');
});

Given('the gate head is committed', function () {
  repository(this).commit('head');
});

Given('the gate configuration reads:', function (text: string) {
  repository(this).write(CONFIG_PATH, text);
});

Given('the gate configuration is absent', function () {
  repository(this).remove(CONFIG_PATH);
});

When('the gate checks the Linux job with Cucumber report count {string}', function (count: string) {
  return repository(this).run(['check', '--job', 'linux'], { AOS_CUCUMBER_SHARDS: count });
});

When('the gate checks the Linux job with two Cucumber reports', function () {
  return repository(this).run(['check', '--job', 'linux'], { AOS_CUCUMBER_SHARDS: '2' });
});

When('the gate checks the {string} job', function (job: string) {
  return repository(this).run(['check', '--job', job]);
});

When(
  'the gate checks the {string} job with the step summary {string}',
  function (job: string, summary: string) {
    const env: NodeJS.ProcessEnv = summary === 'empty' ? { GITHUB_STEP_SUMMARY: '' } : {};
    return repository(this).run(['check', '--job', job], env);
  },
);

Then('no GitHub step summary is written', function () {
  assert.equal(repository(this).exists('summary.md'), false);
});

When('the gate checks with the default job', function () {
  return repository(this).run(['check']);
});

When('the gate plans the {string} job', function (job: string) {
  return repository(this).run(['plan', '--job', job]);
});

When('the gate plans with the default job', function () {
  return repository(this).run(['plan']);
});

When('the gate runs with the arguments {string}', function (args: string) {
  return repository(this).run(args === '' ? [] : args.split(' '));
});

Then('the gate exits with {int}', function (code: number) {
  assert.equal(repository(this).exitCode, code);
});

Then('the gate output is:', function (text: string) {
  const repo = repository(this);
  assert.equal(repo.output, `${repo.tokens(text)}\n`);
});

// The closed environment of git (closed-environment.feature)

function secondRepository(world: GateWorld): GateRepository {
  const found = world.state['otherGateRepository'];
  assert.ok(found instanceof GateRepository, 'a second gate repository must be given first');
  return found;
}

Given('a second gate repository with its own commit', function () {
  const other = new GateRepository();
  this.cleanups.push(() => rmSync(other.dir, { recursive: true, force: true }));
  other.write('other.txt', 'other\n');
  other.commit('other');
  other.write('other.txt', 'other again\n');
  other.commit('other again');
  this.state['otherGateRepository'] = other;
});

Given('the GIT_DIR of the process names the second gate repository', function () {
  const other = secondRepository(this);
  const before = process.env['GIT_DIR'];
  process.env['GIT_DIR'] = join(other.dir, '.git');
  this.cleanups.push(() => {
    if (before === undefined) delete process.env['GIT_DIR'];
    else process.env['GIT_DIR'] = before;
  });
});

Given('the expectation is taken from the gate repository, before the poison', function () {
  const read = new GitRepository(repository(this).dir);
  const { head, firstParent } = read.commits();
  this.state['gateExpected'] = { head, firstParent, diff: read.diff(firstParent as string) };
});

When('the gate reads its repository', function () {
  const read = new GitRepository(repository(this).dir);
  const { head, firstParent } = read.commits();
  this.state['gateRead'] = { head, firstParent, diff: read.diff(firstParent as string) };
});

type Read = { head: string; firstParent: string | null; diff: string };

/** The recorded state of a reading, checked for its shape as `secondRepository` is checked with `instanceof`. */
function isRead(value: unknown): value is Read {
  if (typeof value !== 'object' || value === null) return false;
  const { head, firstParent, diff } = value as Record<string, unknown>;
  return (
    typeof head === 'string' &&
    (typeof firstParent === 'string' || firstParent === null) &&
    typeof diff === 'string'
  );
}

function readState(world: GateWorld, key: 'gateRead' | 'gateExpected', missing: string): Read {
  const found = world.state[key];
  assert.ok(isRead(found), missing);
  return found;
}
const gateRead = (world: GateWorld): Read =>
  readState(world, 'gateRead', 'the gate must read its repository first');
const gateExpected = (world: GateWorld): Read =>
  readState(world, 'gateExpected', 'the expectation must be taken from the gate repository first');

Then('the head it read is the head of the gate repository', function () {
  assert.equal(gateRead(this).head, gateExpected(this).head);
});

Then('the first parent it read is the first parent of the gate repository', function () {
  assert.equal(gateRead(this).firstParent, gateExpected(this).firstParent);
});

Then('the diff it read adds the line {string} to {string}', function (line: string, path: string) {
  const diff = gateRead(this).diff;
  assert.equal(diff, gateExpected(this).diff);
  assert.ok(diff.includes(`+++ b/${path}`), diff);
  assert.ok(diff.split('\n').includes(`+${line}`), diff);
});

Then(
  'the diff it read is the expected one and adds the line {string} with a CRLF line end to {string}',
  function (line: string, path: string) {
    const diff = gateRead(this).diff;
    assert.equal(diff, gateExpected(this).diff);
    assert.ok(diff.includes(`+++ b/${path}`), diff);
    assert.ok(diff.includes(`+${line}\r\n`), diff);
  },
);

// What the git of the gate receives (closed-environment.feature): a fake git, first on the PATH of the process, records
// the names of its environment, and the values of its two configuration variables, one line per call, next to itself. It is a node script started through its own
// shebang: the step starts no process. macOS adds `__CF_USER_TEXT_ENCODING` to every process it starts: it is left out.
const FAKE_GIT = `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const names = Object.keys(process.env).filter((name) => name !== '__CF_USER_TEXT_ENCODING');
appendFileSync(__filename + '.names', names.sort().join(', ') + '\\n');
appendFileSync(__filename + '.configuration', [process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM].join(' ') + '\\n');
appendFileSync(__filename + '.argv', process.argv.slice(2).join(' ') + '\\n');
process.stdout.write('1111111111111111111111111111111111111111 2222222222222222222222222222222222222222\\n');
`;

Given('a fake git first on the PATH of the process, which records the names of its environment', function () {
  const directory = mkdtempSync(join(tmpdir(), 'aos-gate-fake-'));
  this.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const script = join(directory, 'git');
  writeFileSync(script, FAKE_GIT);
  chmodSync(script, 0o755);
  const before = process.env['PATH'];
  process.env['PATH'] = `${directory}:${before}`;
  this.cleanups.push(() => {
    process.env['PATH'] = before;
  });
  this.state['gateFakeGit'] = script;
});

When('the gate asks its git for the head', function () {
  new GitRepository(repository(this).dir).commits();
});

Then('the fake git of the gate was started once as {string}', function (argv: string) {
  const script = this.state['gateFakeGit'];
  assert.equal(typeof script, 'string', 'a fake git must be put first on the PATH');
  assert.equal(readFileSync(`${script as string}.argv`, 'utf8'), `${argv}\n`);
});

Given('the configuration of the gate repository names a witness program as its core.fsmonitor', function () {
  const witness = join(mkdtempSync(join(tmpdir(), 'aos-gate-witness-')), 'witness');
  this.cleanups.push(() => rmSync(dirname(witness), { recursive: true, force: true }));
  writeFileSync(witness, `#!/bin/sh\n: > '${witness}.ran'\n`);
  chmodSync(witness, 0o755);
  const configuration = repository(this).path('.git/config');
  writeFileSync(configuration, `${readFileSync(configuration, 'utf8')}[core]\n\tfsmonitor = ${witness}\n`);
  this.state['gateWitness'] = witness;
});

When('git is asked for the diff with none of the options of the gate', function () {
  const { firstParent } = new GitRepository(repository(this).dir).commits();
  assert.notEqual(firstParent, null, 'the gate repository must have a first parent');
  gitWithOptions(
    repository(this).dir,
    [],
    ['diff', '--unified=0', '--no-renames', '--no-color', '--no-ext-diff', firstParent ?? ''],
  );
});

function gateWitness(world: GateWorld): string {
  const found = world.state['gateWitness'];
  assert.equal(typeof found, 'string', 'a witness program must be named in the configuration first');
  return found as string;
}

Then('the witness program of the gate has not run', function () {
  assert.equal(existsSync(`${gateWitness(this)}.ran`), false);
});

Then('the witness program of the gate has run', function () {
  assert.equal(existsSync(`${gateWitness(this)}.ran`), true);
});

Then('every call of the fake git of the gate received exactly the names {string}', function (names: string) {
  const script = this.state['gateFakeGit'];
  assert.equal(typeof script, 'string', 'a fake git must be put first on the PATH');
  const calls = readFileSync(`${script as string}.names`, 'utf8')
    .trimEnd()
    .split('\n');
  assert.ok(calls.length > 0);
  for (const call of calls) assert.equal(call, names);
});

Then(
  'every call of the fake git of the gate received the two configuration variables set to the empty file',
  function () {
    const script = this.state['gateFakeGit'];
    assert.equal(typeof script, 'string', 'a fake git must be put first on the PATH');
    const calls = readFileSync(`${script as string}.configuration`, 'utf8')
      .trimEnd()
      .split('\n');
    assert.ok(calls.length > 0);
    for (const call of calls) assert.equal(call, '/dev/null /dev/null');
  },
);

Given('the HOME of the process holds a .gitconfig that sets core.autocrlf', function () {
  const home = mkdtempSync(join(tmpdir(), 'aos-gate-home-'));
  writeFileSync(join(home, '.gitconfig'), '[core]\n\tautocrlf = true\n');
  const before = process.env['HOME'];
  process.env['HOME'] = home;
  this.cleanups.push(() => {
    if (before === undefined) delete process.env['HOME'];
    else process.env['HOME'] = before;
    rmSync(home, { recursive: true, force: true });
  });
});

Given(
  'the XDG_CONFIG_HOME of the process holds a configuration file in git that sets diff.noprefix',
  function () {
    const xdg = mkdtempSync(join(tmpdir(), 'aos-gate-xdg-'));
    mkdirSync(join(xdg, 'git'));
    writeFileSync(join(xdg, 'git', 'config'), '[diff]\n\tnoprefix = true\n');
    const before = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = xdg;
    this.cleanups.push(() => {
      if (before === undefined) delete process.env['XDG_CONFIG_HOME'];
      else process.env['XDG_CONFIG_HOME'] = before;
      rmSync(xdg, { recursive: true, force: true });
    });
  },
);
