import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitRepository } from '../../src/infrastructure/git-repository.js';
import { committedNames, temporaryDirectory } from './fixtures.js';
import { Given, Then, type DeliverWorld } from './support.js';

// What the git of the delivery receives (git-environment.feature): a fake git, the program of the adapter, records the
// names of its environment, one line per call, next to itself. It is a node script started through its own shebang:
// the step starts no process. macOS adds `__CF_USER_TEXT_ENCODING` to every process it starts: it is left out.
const FAKE_GIT = `#!${process.execPath}
require('node:fs').appendFileSync(
  __filename + '.names',
  Object.keys(process.env).filter((name) => name !== '__CF_USER_TEXT_ENCODING').sort().join(', ') + '\\n',
);
`;

interface Recording {
  script: string;
}

/** What the host of the next delivery repository sets: `A=1,B=2`, or nothing. */
Given('the host of the delivery repository sets {string}', function (pairs: string) {
  this.state['hostSets'] = Object.fromEntries(
    pairs.split(',').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
  );
});

Given('a delivery repository over a git that records the names of its environment', function () {
  const directory = temporaryDirectory(this);
  const script = join(directory, 'git');
  writeFileSync(script, FAKE_GIT);
  chmodSync(script, 0o755);
  const host = { names: committedNames(), env: this.state['hostSets'] as Record<string, string> };
  this.state['portRepository'] = {
    repository: new GitRepository(directory, 'origin', script, host),
    script,
  } satisfies Recording & { repository: GitRepository };
});

const received = (world: DeliverWorld): string[] => {
  const recording = world.state['portRepository'] as Recording;
  return readFileSync(`${recording.script}.names`, 'utf8').trimEnd().split('\n');
};

Then('every call of the git of the delivery received exactly the names {string}', function (names: string) {
  const calls = received(this);
  assert.ok(calls.length > 0);
  for (const call of calls) assert.equal(call, names);
});
