import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, ROOT, Then, When, stored } from './helpers.js';

// The scenarios of features/arch/closed-git-environment-text.feature.

/** A process launch that is given the whole environment: spread, `env: process.env`, or passed as an argument. */
function givesWholeEnvironment(text: string): boolean {
  return /\.\.\.\s*process\.env\b(?!\s*\[)|\benv:\s*process\.env\b(?!\s*\[)|[(,]\s*process\.env\s*[,)]/.test(
    text,
  );
}

Given('the text of the committed file {string}', function (file: string) {
  this.state['sourceText'] = readFileSync(join(ROOT, file), 'utf8');
});

When('the text {string} is replaced by {string}', function (closed: string, open: string) {
  const text = stored<string>(this, 'sourceText');
  assert.ok(text.includes(closed), `the text does not hold ${closed}`);
  this.state['sourceText'] = text.replace(closed, open);
});

Then('the text gives process.env to no process launch', function () {
  assert.equal(givesWholeEnvironment(stored<string>(this, 'sourceText')), false);
});

Then('the text gives process.env to a process launch', function () {
  assert.equal(givesWholeEnvironment(stored<string>(this, 'sourceText')), true);
});

Then('the closed Git environment in the text sets GIT_ATTR_NOSYSTEM to 1', function () {
  assert.match(stored<string>(this, 'sourceText'), /\bGIT_ATTR_NOSYSTEM"?\s*:\s*['"]1['"]/);
});

/** The names of `const names = [...]`, the list of the variables of the host that a closed environment takes. */
function closedNames(text: string): string[] {
  const list = /const names = \[([^\]]*)\]/.exec(text);
  assert.ok(list !== null, 'the text holds no list of names');
  return [...(list[1] as string).matchAll(/'([^']*)'/g)].map((name) => name[1] as string);
}

Then(
  'the names of the closed environment in the text are those of the committed file {string}',
  function (file: string) {
    assert.deepEqual(
      closedNames(stored<string>(this, 'sourceText')),
      closedNames(readFileSync(join(ROOT, file), 'utf8')),
    );
  },
);

Then(
  'the names of the closed environment in the text are not those of the committed file {string}',
  function (file: string) {
    assert.notDeepEqual(
      closedNames(stored<string>(this, 'sourceText')),
      closedNames(readFileSync(join(ROOT, file), 'utf8')),
    );
  },
);
