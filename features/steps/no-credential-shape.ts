import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findCredential } from '../../packages/sandbox/src/credential-shapes.js';
import { Given, ROOT, Then, When, stored } from './helpers.js';

/** A file that must hold a credential shape, and why. None does: a fixture composes its shape at run time. */
const ALLOWED: Readonly<Record<string, string>> = {};

/** The regular files git tracks or would track (not ignored) under `root`, path -> the shape each holds, if one. */
function shapesOf(root: string): Map<string, string> {
  const names = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
    env: { PATH: process.env['PATH'], GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\0')
    .filter((name) => name !== '');
  const found = new Map<string, string>();
  for (const name of names) {
    const stat = lstatSync(join(root, name), { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    // Latin-1 maps every byte to one character: a shape is ASCII, found in any file whatever its encoding.
    const shape = findCredential(readFileSync(join(root, name)).toString('latin1'));
    if (shape !== undefined) found.set(name, shape);
  }
  return found;
}

When('I read every file git tracks or would track in the repository', function () {
  this.state['credential shapes'] = shapesOf(ROOT);
});

When('I read every file git tracks or would track in that repository', function () {
  this.state['credential shapes'] = shapesOf(stored<string>(this, 'credential repository'));
});

Then('no file holds a credential shape outside the allow-list', function () {
  const outside = [...stored<Map<string, string>>(this, 'credential shapes')].filter(
    ([name]) => !Object.hasOwn(ALLOWED, name),
  );
  // The name of the file and of the shape, never the value.
  assert.deepEqual(outside, []);
});

Then('the allow-list of credential shapes is empty', function () {
  assert.deepEqual(ALLOWED, {});
});

Given(
  'a repository whose file {string} holds an OAuth token of Anthropic composed at run time',
  function (file: string) {
    const root = mkdtempSync(join(tmpdir(), 'aos-shapes-'));
    this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    execFileSync('git', ['init', '-q'], {
      cwd: root,
      env: { PATH: process.env['PATH'], GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `token: ${['sk', 'ant', 'oat01'].join('-')}-${'T'.repeat(24)}\n`);
    writeFileSync(join(root, 'clean.txt'), 'nothing here\n');
    this.state['credential repository'] = root;
  },
);

Then('the file {string} is found to hold the shape {string}', function (file: string, shape: string) {
  assert.deepEqual([...stored<Map<string, string>>(this, 'credential shapes')], [[file, shape]]);
});
