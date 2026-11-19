import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Given, ROOT, Then, When, stored } from './helpers.js';
import type { ArchitectWorld } from '../support/world.js';

// The scenarios of features/arch/no-container-command.feature.

/** Whether a text holds docker or colima, in any case, anywhere. */
function namesContainerTool(text: string): boolean {
  return /docker|colima/i.test(text);
}

/**
 * Whether the rule reads the file. Left out: Markdown, in any case and anywhere (under `steps/`, the texts given to a
 * session, `brief.md` and `scout.<name>.md`, among them), the files under a `results` directory, and under `steps/` the
 * records (`record.json`). Every `step.json` is read: the step tool runs its `checks[].command`.
 */
function isRead(path: string): boolean {
  const parts = path.split('/');
  if (/\.md$/i.test(path) || parts.includes('results')) return false;
  return !(parts[0] === 'steps' && parts[parts.length - 1] === 'record.json');
}

/**
 * The regular files and symbolic links git tracks or would track (not ignored) that the rule reads: relative path ->
 * text. The text of a regular file is its content; the text of a symbolic link is its target, read and not followed,
 * which is what git stores for it.
 */
function treeFiles(root: string = ROOT): Map<string, string> {
  const names = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
    env: { PATH: process.env['PATH'], GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\0')
    .filter((name) => name !== '' && isRead(name));
  const files = new Map<string, string>();
  for (const name of names) {
    const stat = lstatSync(join(root, name), { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) files.set(name, readlinkSync(join(root, name)));
    else if (stat?.isFile()) files.set(name, readFileSync(join(root, name), 'utf8'));
  }
  return files;
}

/** The names of the scripts of a package.json text whose value holds a word. */
function scriptsHolding(text: string): string[] {
  const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {};
  return Object.entries(scripts)
    .filter(([, value]) => namesContainerTool(value))
    .map(([name]) => name);
}

Then('no script value of the text holds docker or colima', function () {
  assert.deepEqual(scriptsHolding(stored<string>(this, 'sourceText')), []);
});

Then('the only script of the text that holds docker or colima is {string}', function (name: string) {
  assert.deepEqual(scriptsHolding(stored<string>(this, 'sourceText')), [name]);
});

function files(world: ArchitectWorld): Map<string, string> {
  return stored<Map<string, string>>(world, 'treeFiles');
}

function closedList(world: ArchitectWorld): string[] {
  return stored<string[]>(world, 'closedList');
}

Given('the closed list of the files that may hold docker or colima', function (table: { raw(): string[][] }) {
  this.state['closedList'] = table.raw().map((row) => row[0] as string);
});

Given('the files of the tree that the rule reads', function () {
  this.state['treeFiles'] = treeFiles();
});

When('the file {string} is added holding {string}', function (path: string, text: string) {
  files(this).set(path, text);
});

When('the file {string} is rewritten to hold {string}', function (path: string, text: string) {
  assert.ok(files(this).has(path), `no file ${path}`);
  files(this).set(path, text);
});

When('the file {string} is removed', function (path: string) {
  assert.ok(files(this).delete(path), `no file ${path}`);
});

When('the entry {string} is added to the closed list', function (path: string) {
  closedList(this).push(path);
});

/** The files outside the list that hold a word. */
function holdersOutside(world: ArchitectWorld): string[] {
  const list = closedList(world);
  return [...files(world)]
    .filter(([path, text]) => isRead(path) && !list.includes(path) && namesContainerTool(text))
    .map(([path]) => path);
}

/** The entries of the list that are not in the tree. */
function missingEntries(world: ArchitectWorld): string[] {
  return closedList(world).filter((path) => !files(world).has(path));
}

/** The entries of the list that are in the tree and hold no word. */
function cleanEntries(world: ArchitectWorld): string[] {
  return closedList(world).filter((path) => {
    const text = files(world).get(path);
    return text !== undefined && !namesContainerTool(text);
  });
}

Then('no file outside the closed list holds docker or colima', function () {
  assert.deepEqual(holdersOutside(this), []);
});

Then(
  'the only file outside the closed list that holds docker or colima is {string}',
  function (path: string) {
    assert.deepEqual(holdersOutside(this), [path]);
  },
);

Then('every file of the closed list is in the tree', function () {
  assert.deepEqual(missingEntries(this), []);
});

Then('the only entry of the closed list that is not in the tree is {string}', function (path: string) {
  assert.deepEqual(missingEntries(this), [path]);
});

Then('every file of the closed list holds docker or colima', function () {
  assert.deepEqual(cleanEntries(this), []);
});

Then(
  'the only entry of the closed list that holds neither docker nor colima is {string}',
  function (path: string) {
    assert.deepEqual(cleanEntries(this), [path]);
  },
);

Given('a temporary git tree, not committed, holding', function (table: { raw(): string[][] }) {
  const root = mkdtempSync(join(tmpdir(), 'no-container-'));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], {
    cwd: root,
    env: { PATH: process.env['PATH'], GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  for (const [path, kind, content] of table.raw()) {
    const full = join(root, path as string);
    mkdirSync(dirname(full), { recursive: true });
    if (kind === 'file') writeFileSync(full, content as string);
    else if (kind === 'link') symlinkSync(content as string, full);
    else assert.fail(`unknown kind ${kind}`);
  }
  this.state['tempRoot'] = root;
});

Then(
  'the only file of that tree that the rule reads and that holds docker or colima is {string}',
  function (path: string) {
    const read = treeFiles(stored<string>(this, 'tempRoot'));
    assert.deepEqual(
      [...read].filter(([, text]) => namesContainerTool(text)).map(([name]) => name),
      [path],
    );
  },
);
