import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PKG, Then, When, stored } from './helpers.js';

const read = (file: string) => readFileSync(join(PKG, 'prompts', file), 'utf8');

/** The checks on the prompt: not empty, the three levels, the bar read as committed. */
function checkPrompt(text: string): void {
  assert.notEqual(text.trim(), '', 'the prompt is empty');
  for (const needle of ['correctness', 'contradiction', 'proposal', 'git show HEAD:CLAUDE.md']) {
    assert.ok(text.includes(needle), `the prompt does not name ${needle}`);
  }
}

type Json = Record<string, any>;

/** The checks on the verdict schema: exactly the enums and the required keys of the step, closed at each level. */
function checkSchema(schema: Json): void {
  assert.equal(schema['type'], 'object');
  assert.equal(schema['additionalProperties'], false);
  assert.deepEqual([...schema['required']].sort(), ['findings', 'not_checked', 'verdict']);
  assert.deepEqual(Object.keys(schema['properties']).sort(), ['findings', 'not_checked', 'verdict']);
  assert.deepEqual(schema['properties']['verdict']['enum'], ['accept', 'request_changes']);
  const findings = schema['properties']['findings'];
  assert.equal(findings['type'], 'array');
  const item = findings['items'];
  assert.equal(item['type'], 'object');
  assert.equal(item['additionalProperties'], false);
  assert.deepEqual([...item['required']].sort(), ['file', 'level', 'line', 'quote', 'reason']);
  assert.deepEqual(Object.keys(item['properties']).sort(), ['file', 'level', 'line', 'quote', 'reason']);
  assert.deepEqual(item['properties']['level']['enum'], ['correctness', 'contradiction', 'proposal']);
  assert.equal(item['properties']['file']['type'], 'string');
  assert.equal(item['properties']['line']['type'], 'integer');
  assert.equal(item['properties']['quote']['type'], 'string');
  assert.equal(item['properties']['reason']['type'], 'string');
  const notChecked = schema['properties']['not_checked'];
  assert.equal(notChecked['type'], 'array');
  assert.equal(notChecked['items']['type'], 'string');
}

/** The checks on the build prompt: not empty, the committed rules by git, the replay profile, the forbidden git commands. */
function checkBuildPrompt(text: string): void {
  assert.notEqual(text.trim(), '', 'the build prompt is empty');
  for (const needle of [
    'git show HEAD:CLAUDE.md',
    'npx cucumber-js --profile replay',
    'git add',
    'git rm',
    'git commit',
  ]) {
    assert.ok(text.includes(needle), `the build prompt does not name ${needle}`);
  }
}

const BUILD_DEFECTS: Record<string, (text: string) => string> = {
  'an empty prompt': () => '',
  'no reading of the rules by git': (text) => text.replaceAll('git show HEAD:CLAUDE.md', 'the file'),
};

const PROMPT_DEFECTS: Record<string, (text: string) => string> = {
  'an empty prompt': () => '',
  'no correctness level': (text) => text.replaceAll('correctness', 'x'),
  'no contradiction level': (text) => text.replaceAll('contradiction', 'x'),
  'no proposal level': (text) => text.replaceAll('proposal', 'x'),
  'no reading of the bar by git': (text) => text.replaceAll('git show HEAD:CLAUDE.md', 'the file'),
};

const SCHEMA_DEFECTS: Record<string, (schema: Json) => unknown> = {
  'a missing level': (s) =>
    (s['properties']['findings']['items']['properties']['level']['enum'] = ['correctness', 'proposal']),
  'an extra verdict': (s) => s['properties']['verdict']['enum'].push('maybe'),
  'a missing required key': (s) => (s['required'] = ['verdict', 'findings']),
  'an open top level': (s) => delete s['additionalProperties'],
  'an open finding': (s) => (s['properties']['findings']['items']['additionalProperties'] = true),
  'a finding key not required': (s) =>
    (s['properties']['findings']['items']['required'] = ['level', 'file', 'line', 'quote']),
};

When('I read the committed review prompt', function () {
  this.state['prompt'] = read('review.md');
});

When('I read the committed build prompt', function () {
  this.state['build'] = read('build.md');
});

When('I break a copy of the build prompt with {}', function (defect: string) {
  const breakIt = BUILD_DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  this.state['build'] = breakIt(read('build.md'));
});

Then('the build prompt checks pass', function () {
  assert.doesNotThrow(() => checkBuildPrompt(stored(this, 'build')));
});

Then('the build prompt checks fail', function () {
  assert.throws(() => checkBuildPrompt(stored(this, 'build')));
});

When('I read the committed review verdict schema', function () {
  this.state['schema'] = JSON.parse(read('review-verdict.schema.json')) as Json;
});

When('I break a copy of the review prompt with {}', function (defect: string) {
  const breakIt = PROMPT_DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  this.state['prompt'] = breakIt(read('review.md'));
});

When('I break a copy of the review verdict schema with {}', function (defect: string) {
  const breakIt = SCHEMA_DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const schema = JSON.parse(read('review-verdict.schema.json')) as Json;
  breakIt(schema);
  this.state['schema'] = schema;
});

Then('the review prompt checks pass', function () {
  assert.doesNotThrow(() => checkPrompt(stored(this, 'prompt')));
});

Then('the review prompt checks fail', function () {
  assert.throws(() => checkPrompt(stored(this, 'prompt')));
});

Then('the review verdict schema checks pass', function () {
  assert.doesNotThrow(() => checkSchema(stored(this, 'schema')));
});

Then('the review verdict schema checks fail', function () {
  assert.throws(() => checkSchema(stored(this, 'schema')));
});
