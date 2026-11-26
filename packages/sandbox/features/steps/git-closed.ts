import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closedGit, loadClosedGit, parseClosedGit } from '../../src/git-closed.js';
import { PKG, Then, When, stored } from './helpers.js';

When('the committed closed git file is loaded', function () {
  this.state['closedGit'] = closedGit();
});

Then('the closed git options are {string}', function (options: string) {
  assert.equal(stored<{ options: string[] }>(this, 'closedGit').options.join(' '), options);
});

Then('the closed git variables are {string}', function (variables: string) {
  const { environment } = stored<{ environment: Record<string, string> }>(this, 'closedGit');
  assert.equal(
    Object.entries(environment)
      .map(([name, value]) => `${name}=${value}`)
      .join(' '),
    variables,
  );
});

/** The committed file, changed in one way. */
const BROKEN: Record<string, (file: { options: string[]; environment: Record<string, string> }) => string> = {
  'text that is not JSON': () => '{ not json',
  'no option': (file) => JSON.stringify({ ...file, options: [] }),
  'an option that is empty': (file) => JSON.stringify({ ...file, options: [...file.options, ''] }),
  'an option of the floor removed': (file) =>
    JSON.stringify({
      ...file,
      options: file.options.filter((option) => option !== 'core.attributesFile=/dev/null'),
    }),
  'a variable of git it does not hold': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, GIT_DIR: '/elsewhere' } }),
  'a variable of another name': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, XGIT_A: '1' } }),
  'a closed variable set to 0': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, GIT_ATTR_NOSYSTEM: '0' } }),
  'a key of its own': (file) => JSON.stringify({ ...file, extra: true }),
  'an option added': (file) =>
    JSON.stringify({ ...file, options: [...file.options, '-c', 'core.quotePath=false'] }),
};

When('a copy of the committed closed git file is read with the change {string}', function (change: string) {
  const committed = JSON.parse(readFileSync(join(PKG, 'git-closed.json'), 'utf8'));
  const broken = BROKEN[change];
  assert.ok(broken !== undefined, change);
  this.state['closedGitText'] = broken(committed);
  this.state['closedGitCopy'] = parseClosedGit(broken(committed));
});

Then('the closed git copy is refused with {string}', function (message: string) {
  const parsed = stored<{ failure?: string }>(this, 'closedGitCopy');
  assert.ok(parsed.failure?.startsWith(message), JSON.stringify(parsed));
});

Then('loading the closed git copy throws {string}', function (message: string) {
  assert.throws(() => loadClosedGit(stored<string>(this, 'closedGitText')), { message });
});

Then(
  'the closed git copy is accepted with the option {string} {string} last',
  function (flag: string, option: string) {
    const parsed = stored<{ options?: string[] }>(this, 'closedGitCopy');
    assert.deepEqual(parsed.options?.slice(-2), [flag, option]);
  },
);
