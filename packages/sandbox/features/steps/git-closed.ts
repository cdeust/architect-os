import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closedGit, parseClosedGit } from '../../src/git-closed.js';
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

/** The committed file, broken in one way. */
const BROKEN: Record<string, (file: { options: string[]; environment: Record<string, string> }) => string> = {
  'text that is not JSON': () => '{ not json',
  'no option': (file) => JSON.stringify({ ...file, options: [] }),
  'an option that is empty': (file) => JSON.stringify({ ...file, options: [...file.options, ''] }),
  'a variable not of git': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, HOME: '/' } }),
  'a variable with no value': (file) =>
    JSON.stringify({ ...file, environment: { ...file.environment, GIT_ATTR_NOSYSTEM: '' } }),
  'a key of its own': (file) => JSON.stringify({ ...file, extra: true }),
};

When('a copy of the committed closed git file is read with the change {string}', function (change: string) {
  const committed = JSON.parse(readFileSync(join(PKG, 'git-closed.json'), 'utf8'));
  const broken = BROKEN[change];
  assert.ok(broken !== undefined, change);
  this.state['closedGitCopy'] = parseClosedGit(broken(committed));
});

Then('the closed git copy is refused with {string}', function (message: string) {
  const parsed = stored<{ failure?: string }>(this, 'closedGitCopy');
  assert.ok(parsed.failure?.startsWith(message), JSON.stringify(parsed));
});
