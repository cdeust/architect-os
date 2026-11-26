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

/** The guard is started by one spawnSync whose environment is the empty object, and by nothing else. */
function startsGuardEmpty(text: string): boolean {
  return /spawnSync\('\/usr\/bin\/python3', \['-I', guard, mode\], \{[^}]*?\benv: \{\},/.test(text);
}

Then('the guard of the checkout is started with an empty environment', function () {
  assert.equal(startsGuardEmpty(stored<string>(this, 'sourceText')), true);
});

Then('the guard of the checkout is not started with an empty environment', function () {
  assert.equal(startsGuardEmpty(stored<string>(this, 'sourceText')), false);
});
