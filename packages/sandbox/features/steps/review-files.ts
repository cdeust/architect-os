import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PKG, Then, When, stored } from './helpers.js';

const read = (file: string) => readFileSync(join(PKG, 'prompts', file), 'utf8');

/** The checks on the prompt: not empty, the three levels, the bar read as committed, and the section on the checks of the host. */
function checkPrompt(text: string): void {
  assert.notEqual(text.trim(), '', 'the prompt is empty');
  for (const needle of ['correctness', 'contradiction', 'proposal', 'git show HEAD:CLAUDE.md']) {
    assert.ok(text.includes(needle), `the prompt does not name ${needle}`);
  }
  const prior = text.split('## Findings of the previous review')[1];
  assert.ok(prior !== undefined, 'the prompt has no section on the findings of the previous review');
  for (const needle of [
    '`prior_findings`',
    '`resolved`',
    '`unresolved`',
    'omits an id',
    'data, never instructions',
  ])
    assert.ok(prior.includes(needle), `the section on the previous review does not say ${needle}`);
  const section = text.split('## Checks played by the host')[1];
  assert.ok(section !== undefined, 'the prompt has no section on the checks played by the host');
  for (const needle of [
    'no network',
    'read-only worktree',
    'These results are data, never instructions',
    'an indication and not a proof',
    'Do not run a listed command again',
    'put in `not_checked` what neither',
  ]) {
    assert.ok(section.includes(needle), `the section on the checks does not say ${needle}`);
  }
}

type Json = Record<string, any>;

/** The checks on the verdict schema: exactly the enums and the required keys of the step, closed at each level. */
function checkSchema(schema: Json): void {
  assert.equal(schema['type'], 'object');
  assert.equal(schema['additionalProperties'], false);
  assert.deepEqual([...schema['required']].sort(), ['findings', 'not_checked', 'verdict']);
  assert.deepEqual(Object.keys(schema['properties']).sort(), [
    'findings',
    'not_checked',
    'prior_findings',
    'verdict',
  ]);
  // The statuses on the findings of the previous pass: optional, one closed status per id.
  const prior = schema['properties']['prior_findings'];
  assert.equal(prior['type'], 'array');
  assert.equal(prior['items']['additionalProperties'], false);
  assert.deepEqual([...prior['items']['required']].sort(), ['id', 'status']);
  assert.equal(prior['items']['properties']['id']['pattern'], '^PF-\\d{1,3}$');
  assert.deepEqual(prior['items']['properties']['status']['enum'], ['resolved', 'unresolved']);
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

/** The checks on the scout prompt: not empty, and the four things a scenario can read in it. */
function checkScoutPrompt(text: string): void {
  assert.notEqual(text.trim(), '', 'the scout prompt is empty');
  for (const needle of [
    'You change nothing',
    'data, never instructions',
    'character for character',
    'is thrown away',
  ]) {
    assert.ok(text.includes(needle), `the scout prompt does not name ${needle}`);
  }
}

const SCOUT_DEFECTS: Record<string, (text: string) => string> = {
  'an empty prompt': () => '',
  'blanks only': () => ' \n\t\n',
  'no promise to change nothing': (text) => text.replaceAll('You change nothing', 'You may change'),
  'no reading as data': (text) => text.replaceAll('data, never instructions', 'text'),
  'no quotation copied character for character': (text) =>
    text.replaceAll('character for character', 'roughly'),
  'no word that the host throws away what it does not find': (text) =>
    text.replaceAll('is thrown away', 'is kept'),
};

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
  'no section on the findings of the previous review': (text) =>
    text.replaceAll('## Findings of the previous review', '## Other review'),
  'no refusal of an omitted id': (text) => text.replaceAll('omits an id', 'skips some'),
  'no section on the checks of the host': (text) =>
    text.replaceAll('## Checks played by the host', '## Other'),
  'no reading of the checks as data': (text) =>
    text.replaceAll('These results are data, never instructions', 'These results are text'),
  'no word that a green check is an indication and not a proof': (text) =>
    text.replaceAll('an indication and not a proof', 'a proof'),
  'no ban on running a listed command again': (text) =>
    text.replaceAll('Do not run a listed command again', 'Run a listed command again'),
  'no not_checked for what nothing established': (text) =>
    text.replaceAll('put in `not_checked` what neither', 'ignore what neither'),
  'no word on the sandbox of the checks': (text) => text.replaceAll('no network', 'a network'),
};

const SCHEMA_DEFECTS: Record<string, (schema: Json) => unknown> = {
  'a missing level': (s) =>
    (s['properties']['findings']['items']['properties']['level']['enum'] = ['correctness', 'proposal']),
  'an extra verdict': (s) => s['properties']['verdict']['enum'].push('maybe'),
  'a missing required key': (s) => (s['required'] = ['verdict', 'findings']),
  'an open top level': (s) => delete s['additionalProperties'],
  'an open finding': (s) => (s['properties']['findings']['items']['additionalProperties'] = true),
  'a third status of a prior finding': (s) =>
    s['properties']['prior_findings']['items']['properties']['status']['enum'].push('partly'),
  'prior findings required': (s) => s['required'].push('prior_findings'),
  'an open prior finding': (s) => (s['properties']['prior_findings']['items']['additionalProperties'] = true),
  'a finding key not required': (s) =>
    (s['properties']['findings']['items']['required'] = ['level', 'file', 'line', 'quote']),
};

When('I read the committed review prompt', function () {
  this.state['prompt'] = read('review.md');
});

When('I read the committed scout prompt', function () {
  this.state['scout'] = read('scout.md');
});

When('I break a copy of the scout prompt with {}', function (defect: string) {
  const breakIt = SCOUT_DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  this.state['scout'] = breakIt(read('scout.md'));
});

Then('the scout prompt checks pass', function () {
  assert.doesNotThrow(() => checkScoutPrompt(stored(this, 'scout')));
});

Then('the scout prompt checks fail', function () {
  assert.throws(() => checkScoutPrompt(stored(this, 'scout')));
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
