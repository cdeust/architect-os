import assert from 'node:assert/strict';
import { parseStepFile, type StepFile } from '../../src/step-file.js';
import { Then, When, stored } from './helpers.js';

const example = (): Record<string, any> => ({
  build: { model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 2400 },
  review: { model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 },
});

const DEFECTS: Record<string, (s: Record<string, any>) => unknown> = {
  'an unknown key at the top': (s) => (s['plugins'] = []),
  'an unknown key in build': (s) => (s['build']['temperature'] = 0),
  'an unknown key in review': (s) => (s['review']['temperature'] = 0),
  'an effort not in the list': (s) => (s['build']['effort'] = 'extreme'),
  'a review effort not in list': (s) => (s['review']['effort'] = 'extreme'),
  'a limit of 0': (s) => (s['build']['limitSeconds'] = 0),
  'a limit of 7201': (s) => (s['build']['limitSeconds'] = 7201),
  'a non-integer limit': (s) => (s['build']['limitSeconds'] = 60.5),
  'an empty model': (s) => (s['build']['model'] = ''),
  'no build': (s) => delete s['build'],
};

When('I parse the step file example', function () {
  this.state['step'] = parseStepFile(example());
});

When('I parse the step file example without review', function () {
  const raw = example();
  delete raw['review'];
  this.state['step'] = parseStepFile(raw);
});

When('I parse the step file example with the build limit {int}', function (limit: number) {
  const raw = example();
  raw['build']['limitSeconds'] = limit;
  this.state['step'] = parseStepFile(raw);
});

When('I parse the step file example with the build effort {string}', function (effort: string) {
  const raw = example();
  raw['build']['effort'] = effort;
  this.state['step'] = parseStepFile(raw);
});

Then('the step build limit is {int} seconds', function (limit: number) {
  assert.equal(stored<StepFile>(this, 'step').build.limitSeconds, limit);
});

Then('the step build effort is {string}', function (effort: string) {
  assert.equal(stored<StepFile>(this, 'step').build.effort, effort);
});

Then(
  'the step build session is {string}, {string}, {int} seconds',
  function (model: string, effort: string, limitSeconds: number) {
    assert.deepEqual(stored<StepFile>(this, 'step').build, { model, effort, limitSeconds });
  },
);

Then(
  'the step review session is {string}, {string}, {int} seconds',
  function (model: string, effort: string, limitSeconds: number) {
    assert.deepEqual(stored<StepFile>(this, 'step').review, { model, effort, limitSeconds });
  },
);

Then('the step has no review session', function () {
  assert.equal(stored<StepFile>(this, 'step').review, undefined);
});

When('I break a copy of the step file example with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const broken = example();
  breakIt(broken);
  this.state['broken'] = broken;
});

Then('parsing the broken step file fails', function () {
  assert.throws(() => parseStepFile(stored(this, 'broken')));
});
