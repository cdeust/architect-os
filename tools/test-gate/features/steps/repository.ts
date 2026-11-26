import { Workspace } from '../../src/infrastructure/workspace.js';
import assert from 'node:assert/strict';
import {
  chmodSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import { parseRawDiff } from '../../src/domain/diff.js';
import { mayHoldProduction } from '../../src/domain/layout.js';
import { parseGateConfig, type GateConfig } from '../../src/infrastructure/config.js';
import { changedFiles, CONFIG_PATH, runGate } from '../../src/infrastructure/gate.js';
import { git, gitWithOptions, GitRepository } from '../../src/infrastructure/git.js';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface GateWorld {
  admitFixture: (root: string) => NodeJS.ProcessEnv;
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
  readonly dir: string;
  output = '';
  exitCode: number | undefined;

  constructor(
    private readonly admitFixture: GateWorld['admitFixture'],
    prefix = 'aos-gate-',
  ) {
    this.dir = mkdtempSync(join(tmpdir(), prefix));
    git(this.dir, ['init', '-q']);
    this.write(CONFIG_PATH, readFileSync(join(FIXTURES, 'gate.json'), 'utf8'));
    this.write('.gitignore', 'reports/\n');
    this.write(DEBT_PATH, '{"survivors": []}\n');
  }

  admittedEnvironment(): NodeJS.ProcessEnv {
    const root = this.path('runtime');
    mkdirSync(root);
    writeFileSync(
      join(root, '.architect-os-runtime-root'),
      'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
    );
    return this.admitFixture(root);
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
    // A scenario may commit a nested repository on purpose: git's advice about it is not part of any outcome.
    git(this.dir, ['-c', 'advice.addEmbeddedRepo=false', 'add', '-A']);
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

  /** The configuration of this repository, the layout `changedFiles` takes its production files from. */
  layout(): GateConfig {
    const config = parseGateConfig(this.read(CONFIG_PATH));
    assert.ok(!('failure' in config), JSON.stringify(config));
    return config;
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

  /** An explicit test adapter over this scenario's disposable Git fixture. */
  workspace(): Workspace {
    let pending: { file: string; original: string } | undefined;
    return new Workspace(this.dir, undefined, {
      begin: (file, original, mutated) => {
        assert.equal(this.read(file), original);
        pending = { file, original };
        this.write(file, mutated);
      },
      restore: () => {
        assert.ok(pending);
        this.write(pending.file, pending.original);
        pending = undefined;
      },
    });
  }

  async run(
    args: readonly string[],
    env: NodeJS.ProcessEnv = { GITHUB_STEP_SUMMARY: this.path('summary.md') },
  ): Promise<void> {
    let output = '';
    const verdict = runGate(
      ['node', 'main.ts', ...args],
      this.dir,
      env,
      {
        write: (text: string) => (output += text),
      },
      this.workspace(),
    );
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

Given(/^a gate repository(?: under a (bracketed|braced) directory)?$/, function (kind: string | null) {
  // An absent optional group is given as null.
  const prefixes = new Map([
    ['bracketed', 'aos-gate-[one]-'],
    ['braced', 'aos-gate-{one}-'],
  ]);
  const prefix = kind === null ? undefined : prefixes.get(kind);
  const created = new GateRepository(this.admitFixture, prefix);
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
  const other = new GateRepository(this.admitFixture);
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

/** What the gate reads of a repository: the head, the first parent, and the patch of every path that changed. */
function reading(dir: string): Read {
  const read = new GitRepository(dir);
  const { head, firstParent } = read.commits();
  const parent = firstParent as string;
  const diff = parseRawDiff(read.changedPaths(parent))
    .map(({ path }) => read.patch(parent, path))
    .join('');
  return { head, firstParent, diff };
}

Given('the expectation is taken from the gate repository, before the poison', function () {
  this.state['gateExpected'] = reading(repository(this).dir);
});

When('the gate reads its repository', function () {
  this.state['gateRead'] = reading(repository(this).dir);
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
appendFileSync(__filename + '.configuration', [process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM, process.env.GIT_ATTR_NOSYSTEM].join(' ') + '\\n');
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

Given('the gate repository replaces the tree of its first parent by the tree of its head', function () {
  const dir = repository(this).dir;
  git(dir, [
    'replace',
    git(dir, ['rev-parse', 'HEAD^1^{tree}']).trim(),
    git(dir, ['rev-parse', 'HEAD^{tree}']).trim(),
  ]);
});

Given('the gate repository grafts its head with no parent', function () {
  git(repository(this).dir, ['replace', '--graft', 'HEAD']);
});

Then('the first parent the gate reads is the parent the head records', function () {
  const dir = repository(this).dir;
  const recorded = gitWithOptions(dir, ['--no-replace-objects'], ['rev-parse', 'HEAD^1']).trim();
  assert.equal(new GitRepository(dir).commits().firstParent, recorded);
});

// The configuration names an attributes file of the tree that gives every file a filter whose program is the witness.
Given(
  'the configuration of the gate repository names an attributes file whose filter is a witness program',
  function () {
    const repo = repository(this);
    const witness = join(mkdtempSync(join(tmpdir(), 'aos-gate-witness-')), 'witness');
    this.cleanups.push(() => rmSync(dirname(witness), { recursive: true, force: true }));
    writeFileSync(witness, `#!/bin/sh\n: > '${witness}.ran'\nexec cat\n`);
    chmodSync(witness, 0o755);
    writeFileSync(join(dirname(witness), 'attributes'), '* filter=witness\n');
    const configuration = repo.path('.git/config');
    writeFileSync(
      configuration,
      `${readFileSync(configuration, 'utf8')}[core]\n\tattributesFile = ${join(dirname(witness), 'attributes')}\n` +
        `[filter "witness"]\n\tclean = ${witness}\n`,
    );
    this.state['gateWitness'] = witness;
  },
);

// diff.external, or a textconv that .git/info/attributes gives every file (neither the empty tree nor the attributes
// file of the configuration reaches it): programs git starts for a diff unless told not to.
Given(
  'the configuration of the gate repository names a witness program for its diffs as its {string}',
  function (program: string) {
    const repo = repository(this);
    const witness = join(mkdtempSync(join(tmpdir(), 'aos-gate-witness-')), 'witness');
    this.cleanups.push(() => rmSync(dirname(witness), { recursive: true, force: true }));
    writeFileSync(witness, `#!/bin/sh\n: > '${witness}.ran'\ncat "$1" 2>/dev/null\n`);
    chmodSync(witness, 0o755);
    const configuration = repo.path('.git/config');
    const section =
      program === 'external diff'
        ? `[diff]\n\texternal = ${witness}\n`
        : `[diff "witness"]\n\ttextconv = ${witness}\n`;
    if (program !== 'external diff') {
      mkdirSync(repo.path('.git/info'), { recursive: true });
      writeFileSync(repo.path('.git/info/attributes'), '* diff=witness\n');
    }
    writeFileSync(configuration, `${readFileSync(configuration, 'utf8')}${section}`);
    this.state['gateWitness'] = witness;
  },
);

When('git is asked for the diff with none of the options of the gate', function () {
  const { firstParent } = new GitRepository(repository(this).dir).commits();
  assert.notEqual(firstParent, null, 'the gate repository must have a first parent');
  gitWithOptions(
    repository(this).dir,
    [],
    ['diff', '--unified=0', '--no-renames', '--no-color', '--no-ext-diff', firstParent ?? ''],
  );
});

// A repository nested in the tree of the gate (closed-environment.feature): what a session can leave in its worktree.
// Its own configuration names the witness as the `clean` filter of one file, and that file is left racy (rewritten
// with the same size right after it entered the nested index), so that a git that enters the nested repository must
// run the filter to know whether the file changed.
Given(
  'a repository nested in the gate repository at {string} names a witness program as a filter',
  function (name: string) {
    const witness = join(mkdtempSync(join(tmpdir(), 'aos-gate-witness-')), 'witness');
    this.cleanups.push(() => rmSync(dirname(witness), { recursive: true, force: true }));
    writeFileSync(witness, `#!/bin/sh\n: > '${witness}.ran'\ncat\n`);
    chmodSync(witness, 0o755);
    const nested = repository(this).path(name);
    mkdirSync(nested, { recursive: true });
    const inner = (args: string[]) => gitWithOptions(nested, [], args);
    inner(['init', '-q']);
    writeFileSync(join(nested, '.gitattributes'), 'f.txt filter=witness\n');
    writeFileSync(join(nested, 'f.txt'), 'inner\n');
    inner(['add', '-A']);
    inner(['-c', 'user.name=gate', '-c', 'user.email=gate@example.invalid', 'commit', '-q', '-m', 'inner']);
    const configuration = join(nested, '.git', 'config');
    writeFileSync(
      configuration,
      `${readFileSync(configuration, 'utf8')}[filter "witness"]\n\tclean = ${witness}\n`,
    );
    inner(['add', 'f.txt']);
    writeFileSync(join(nested, 'f.txt'), 'outer\n');
    // A `.gitmodules` of the tree asks git to look into the nested repository whatever the configuration says.
    repository(this).write(
      '.gitmodules',
      `[submodule "${name}"]\n\tpath = ${name}\n\turl = ./${name}\n\tignore = none\n`,
    );
    rmSync(`${witness}.ran`, { force: true });
    this.state['gateWitness'] = witness;
  },
);

When('git is asked for the status with none of the options of the gate', function () {
  gitWithOptions(repository(this).dir, [], ['status', '--porcelain']);
});

When('the gate asks its git for the changed paths and for the patch of {string}', function (path: string) {
  const read = new GitRepository(repository(this).dir);
  const parent = read.commits().firstParent as string;
  read.changedPaths(parent);
  read.patch(parent, path);
  read.patch(parent, 'sub');
});

Given(
  'the nested repository {string} leaves the index and the tree of the gate repository',
  function (name: string) {
    const repo = repository(this);
    git(repo.dir, ['rm', '-q', '--cached', name]);
    repo.remove(name);
  },
);

Then('the gate refuses to read its changes with {string}', function (message: string) {
  const repo = repository(this);
  const read = new GitRepository(repo.dir);
  assert.throws(
    () => changedFiles(read, new Workspace(repo.dir), read.commits().firstParent, repo.layout()),
    { message },
  );
});

Given(
  'the gate repository file {string} reads {string} then a NUL byte',
  function (path: string, text: string) {
    repository(this).write(path, `${text}\0\n`);
  },
);

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
  'every call of the fake git of the gate received the two configuration variables set to the empty file and system attributes disabled',
  function () {
    const script = this.state['gateFakeGit'];
    assert.equal(typeof script, 'string', 'a fake git must be put first on the PATH');
    const calls = readFileSync(`${script as string}.configuration`, 'utf8')
      .trimEnd()
      .split('\n');
    assert.ok(calls.length > 0);
    for (const call of calls) assert.equal(call, '/dev/null /dev/null 1');
  },
);

Given(
  'the gate repository has a source with a {word} separator at {string}',
  function (kind: string, path: string) {
    const separators = new Map([
      ['CR', '\r'],
      ['LS', '\u2028'],
      ['PS', '\u2029'],
      ['CRLF', '\r\n'],
      ['LF', '\n'],
    ]);
    const separator = separators.get(kind);
    assert.notEqual(separator, undefined);
    repository(this).write(path, '// heading' + separator + 'export const changed = 1 + 2;\n');
  },
);

Given(
  'the gate repository replaces {string} with a {word} link to a disposable sibling',
  function (path: string, kind: string) {
    const repo = repository(this);
    const outside = mkdtempSync(join(tmpdir(), 'aos-gate-outside-'));
    this.cleanups.push(() => rmSync(outside, { recursive: true, force: true }));
    const target = join(outside, 'leaf.mjs');
    writeFileSync(target, 'export const witness = 1 + 2;\n');
    repo.remove(path);
    mkdirSync(dirname(repo.path(path)), { recursive: true });
    symlinkSync(kind === 'directory' ? outside : target, repo.path(path));
  },
);

Given('the gate repository directory {string} cannot be searched', function (path: string) {
  const directory = repository(this).path(path);
  chmodSync(directory, 0o600);
  // Cleanups run in reverse order: the directory is opened again before the repository is removed.
  this.cleanups.push(() => chmodSync(directory, 0o700));
});

Then(
  'the gate workspace fails to read source {string} with an error that begins {string}',
  function (path: string, start: string) {
    assert.throws(
      () => repository(this).workspace().readSource(path),
      (error: Error) => error.message.startsWith(start),
    );
  },
);

Given('the gate workspace has a directory where the source {string} is expected', function (path: string) {
  mkdirSync(repository(this).path(path), { recursive: true });
});

Then(
  'the gate workspace refuses to read source {string} with {string}',
  function (path: string, message: string) {
    const workspace = repository(this).workspace();
    assert.throws(() => workspace.read(path), { message });
    assert.throws(() => workspace.readBytes(path), { message });
  },
);

Then('the gate writes exactly the literal mutation pattern {string}', function (pattern: string) {
  assert.deepEqual(JSON.parse(repository(this).read('reports/gate-plan.json')).mutate, [pattern]);
});

Then(
  'the gate refuses a {word} in the mutation path before building a pattern',
  async function (kind: string) {
    const characters = new Map([
      ['backslash', '\\'],
      ['LF', '\n'],
      ['CR', '\r'],
      ['LS', '\u2028'],
      ['PS', '\u2029'],
    ]);
    const character = characters.get(kind);
    assert.notEqual(character, undefined);
    const file = 'src/leaf' + character + 'name.mjs';
    const repo = repository(this);
    repo.write(file, 'export const witness = true;\n');
    repo.commit('path under test');
    await repo.run(['plan']);
    assert.equal(repo.exitCode, 1);
    assert.ok(repo.output.includes('GATE_MUTATION_PATH_PATTERN : ' + file), repo.output);
  },
);

Then('the gate detects the raw link at {string} without opening the path', function (path: string) {
  const repo = repository(this);
  const read = new GitRepository(repo.dir);
  const workspace = repo.workspace();
  const { firstParent } = read.commits();
  assert.ok(firstParent !== null);
  read.patch = () => assert.fail('must refuse before asking for a patch');
  // Every source read goes through readBytes: replaced, it shows that the path is never opened.
  workspace.readBytes = () => assert.fail('must refuse before opening the source');
  assert.throws(() => changedFiles(read, workspace, firstParent, repo.layout()), {
    message: 'GATE_SOURCE_LINK : ' + path,
  });
});

Then('the gate uses the Darwin flag that forbids links in every component', async function () {
  const { openWorkspaceFile } = await import('../../src/infrastructure/workspace.js');
  const witness = 'the fd belongs to the caller';
  assert.equal(
    openWorkspaceFile(witness, 'darwin', (file, flags) => {
      assert.equal(file, witness);
      assert.equal(flags, constants.O_NONBLOCK | 0x20000000);
      return 4;
    }),
    4,
  );
});

Then('the gate workspace closes its descriptors after source reads', function () {
  const repo = repository(this);
  const workspace = repo.workspace();
  const count = () => readdirSync('/dev/fd').length;
  const before = count();
  assert.equal(workspace.read('src/leaf.mjs'), 'export const witness = 1;\n');
  assert.equal(workspace.read('src/missing.mjs'), null);
  assert.equal(count(), before);
});

Then('the gate workspace reads nothing at {string}', function (path: string) {
  const workspace = repository(this).workspace();
  assert.equal(workspace.read(path), null);
  assert.equal(workspace.readSource(path), null);
  assert.throws(() => workspace.requireSource(path), { message: 'GATE_SOURCE_MISSING : ' + path });
  assert.equal(workspace.requireSource('src/leaf.mjs'), 'export const witness = 1;\n');
});

Then(
  'the gate workspace writes {string} to its report place and {string} to its tree',
  function (report: string, source: string) {
    const repo = repository(this);
    const place = mkdtempSync(join(tmpdir(), 'aos-gate-reports-'));
    this.cleanups.push(() => rmSync(place, { recursive: true, force: true }));
    const workspace = new Workspace(repo.dir, (path) => join(place, path));
    workspace.write(report, 'report\n');
    workspace.write(source, 'source\n');
    assert.equal(readFileSync(join(place, report), 'utf8'), 'report\n');
    assert.equal(repo.read(source), 'source\n');
    assert.equal(existsSync(join(place, source)), false);
    assert.equal(repo.exists(report), false);
  },
);

Then(
  'the directory {string} may hold a production file of the gate configuration: {word}',
  function (path: string, may: string) {
    assert.equal(mayHoldProduction(repository(this).layout(), path), may === 'yes');
  },
);

Then(
  'the directory {string} may hold a production file of the committed gate configuration: {word}',
  function (path: string, may: string) {
    const config = parseGateConfig(
      readFileSync(fileURLToPath(new URL('../../gate.json', import.meta.url)), 'utf8'),
    );
    assert.ok(!('failure' in config), JSON.stringify(config));
    assert.equal(mayHoldProduction(config, path), may === 'yes');
  },
);

Then(
  'the directory {string} may hold a production file of the glob {string}: {word}',
  function (path: string, glob: string, may: string) {
    const layout = { production: { include: [glob], exclude: [] }, features: { include: [], exclude: [] } };
    assert.equal(mayHoldProduction(layout, path), may === 'yes');
  },
);

Given('the gate configuration takes the production files of the root as well', function () {
  const repo = repository(this);
  const config = JSON.parse(repo.read(CONFIG_PATH));
  config.production.include = ['*.mjs', ...config.production.include];
  repo.write(CONFIG_PATH, JSON.stringify(config));
});

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

Then(
  'the installed mutation matcher selects {string} and only that file instead of {string}',
  async function (path: string, sibling: string) {
    const repo = repository(this);
    assert.equal(repo.exitCode, 0, repo.output);
    const core = createRequire(import.meta.url).resolve('@stryker-mutator/core');
    const { FileMatcher } = await import(new URL('config/file-matcher.js', pathToFileURL(core)).href);
    const { mutate } = JSON.parse(repo.read('reports/gate-plan.json'));
    assert.equal(mutate.length, 1);
    const matcher = new FileMatcher(mutate[0], false);
    assert.equal(matcher.matches(repo.path(path)), true);
    assert.equal(matcher.matches(repo.path(sibling)), false);
  },
);

Given('the gate repository holds a filename that is not UTF-8', function () {
  const repo = repository(this);
  mkdirSync(repo.path('src'), { recursive: true });
  const invalid = Buffer.concat([
    Buffer.from(repo.path('src') + '/x'),
    Buffer.from([0xff]),
    Buffer.from('.mjs'),
  ]);
  try {
    writeFileSync(invalid, 'export const source = true;\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EILSEQ') throw error;
    // APFS rejects these bytes as a filename. Exercise the same adapter with Git's raw stdout protocol.
    const bin = mkdtempSync(join(tmpdir(), 'aos-gate-byte-git-'));
    const script = join(bin, 'git');
    writeFileSync(
      script,
      `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--others')) {
  process.stdout.write(Buffer.concat([Buffer.from('src/x'), Buffer.from([255]), Buffer.from('.mjs\\0')]));
} else {
  const result = require('node:child_process').spawnSync('/usr/bin/git', args);
  process.stdout.write(result.stdout);
  process.exit(result.status);
}
`,
      { mode: 0o700 },
    );
    const before = process.env['PATH'];
    process.env['PATH'] = `${bin}:${before}`;
    this.cleanups.push(() => {
      process.env['PATH'] = before;
      rmSync(bin, { recursive: true, force: true });
    });
  }
});

Given('the gate repository holds a production source with an invalid UTF-8 comment', function () {
  const repo = repository(this);
  mkdirSync(repo.path('src'), { recursive: true });
  writeFileSync(repo.path('src/bad.mjs'), Buffer.from([0x2f, 0x2f, 0x20, 0xff, 0x0a]));
});

Given('the gate repository holds a symlink at {string}', function (path: string) {
  const repo = repository(this);
  mkdirSync(dirname(repo.path(path)), { recursive: true });
  symlinkSync('/missing-target', repo.path(path));
});

Given(
  'the gate repository holds a symlink for the debt registry when {string} reads it',
  function (command: string) {
    const repo = repository(this);
    repo.remove(DEBT_PATH);
    if (command === 'realign') symlinkSync('/missing-target', repo.path(DEBT_PATH));
  },
);

When('the gate runs the debt command {string}', async function (command: string) {
  await repository(this).run(command === 'realign' ? ['debt', 'realign'] : ['debt']);
});

Given('a linked worktree with an external gitdir is inside the gate repository', function () {
  const external = new GateRepository(this.admitFixture);
  this.cleanups.push(() => rmSync(external.dir, { recursive: true, force: true }));
  external.commit('external metadata');
  const repo = repository(this);
  git(external.dir, ['worktree', 'add', '--detach', repo.path('linked'), 'HEAD']);
  assert.ok(repo.read('linked/.git').startsWith(`gitdir: ${external.dir}/.git/worktrees/`));
});

When('the fixture Git requests the nested patch without the command line submodule guard', function () {
  const repo = repository(this);
  const parent = repo.rev('HEAD^1');
  gitWithOptions(
    repo.dir,
    ['-c', 'diff.ignoreSubmodules=all'],
    ['diff', '--unified=0', '--text', '--no-textconv', parent, '--', ':(literal)sub'],
  );
});
