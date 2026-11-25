import { Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { callRefusal, normalized, textRefusal } from '../../src/domain/refusal.js';
import { guardDependencies, runGuard } from '../../src/main.js';

interface GuardWorld {
  state: Record<string, unknown>;
}
const When = CucumberWhen<GuardWorld>;
const Then = CucumberThen<GuardWorld>;

// `⏎` and `⇥` in a cell stand for a line break and a tab: a command can span lines, and keep its own backslashes.
const cell = (text: string) => text.replaceAll('⏎', '\n').replaceAll('⇥', '\t');

// The command is delimited by guillemets: a command holds both kinds of quotes.
Then(/^the session guard reads the command «(.*)» as «(.*)»$/, function (command: string, reason: string) {
  assert.equal(textRefusal(cell(command)) ?? 'through', reason);
});

Then(/^the session guard normalizes «(.*)» as «(.*)»$/, function (text: string, expected: string) {
  assert.equal(normalized(cell(text)), expected);
});

Then('the session guard reads the call {string} as {string}', function (json: string, reason: string) {
  assert.equal(callRefusal(JSON.parse(json)) ?? 'through', reason);
});

When('the session guard is given the stdin {string}', function (stdin: string) {
  let written = '';
  const code = runGuard({ stdin: () => stdin, stderr: { write: (text: string) => (written += text) } });
  this.state['guard'] = { code, written };
});

When('the session guard cannot read its stdin', function () {
  let written = '';
  const code = runGuard({
    stdin: () => {
      throw new Error('EAGAIN');
    },
    stderr: { write: (text: string) => (written += text) },
  });
  this.state['guard'] = { code, written };
});

Then('the session guard exits with {int} and writes {string}', function (code: number, text: string) {
  const got = this.state['guard'] as { code: number; written: string };
  assert.deepEqual(got, { code, written: text === '' ? '' : `${text}\n` });
});

Then(
  'the dependencies of the session guard read file descriptor {int} as {string} and keep the stderr of the process',
  function (fd: number, encoding: string) {
    const stderr = { write: () => true };
    const reads: unknown[][] = [];
    const deps = guardDependencies({ stderr }, (...args) => {
      reads.push(args);
      return 'the call';
    });
    assert.equal(deps?.stderr, stderr);
    assert.equal(deps?.stdin?.(), 'the call');
    assert.deepEqual(reads, [[fd, encoding]]);
  },
);
