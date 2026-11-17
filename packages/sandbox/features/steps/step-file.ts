import assert from 'node:assert/strict';
import type { ZodError } from 'zod';
import { parseStepFile, type StepFile } from '../../src/step-file.js';
import { Then, When, stored } from './helpers.js';

const example = (): Record<string, any> => ({
  build: { model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 2400 },
  reviews: [{ name: 'correctness', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 }],
});

const reviewNamed = (name: string) => ({ name, model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 });

const DEFECTS: Record<string, (s: Record<string, any>) => unknown> = {
  'an unknown key at the top': (s) => (s['plugins'] = []),
  'an unknown key in build': (s) => (s['build']['temperature'] = 0),
  'an unknown key in a review': (s) => (s['reviews'][0]['temperature'] = 0),
  'the singular review key': (s) => (s['review'] = reviewNamed('correctness')),
  'a review without a name': (s) => delete s['reviews'][0]['name'],
  'a review name that starts with a digit': (s) => (s['reviews'][0]['name'] = '1a'),
  'a review name with an underscore': (s) => (s['reviews'][0]['name'] = 'a_b'),
  'a review name that ends with a newline': (s) => (s['reviews'][0]['name'] = 'a\n'),
  'a review name that is not a string': (s) => (s['reviews'][0]['name'] = 1),
  'nine reviews': (s) => (s['reviews'] = Array.from({ length: 9 }, (_, i) => reviewNamed(`r${i}`))),
  'reviews that is not a list': (s) => (s['reviews'] = reviewNamed('a')),
  'a parallel of 0': (s) => (s['parallel'] = 0),
  'a parallel of 9': (s) => (s['parallel'] = 9),
  'a non-integer parallel': (s) => (s['parallel'] = 1.5),
  'a parallel that is a string': (s) => (s['parallel'] = '2'),
  'an effort not in the list': (s) => (s['build']['effort'] = 'extreme'),
  'a review effort not in list': (s) => (s['reviews'][0]['effort'] = 'extreme'),
  'a review limit of 0': (s) => (s['reviews'][0]['limitSeconds'] = 0),
  'a review limit of 7201': (s) => (s['reviews'][0]['limitSeconds'] = 7201),
  'an empty review model': (s) => (s['reviews'][0]['model'] = ''),
  'a limit of 0': (s) => (s['build']['limitSeconds'] = 0),
  'a limit of 7201': (s) => (s['build']['limitSeconds'] = 7201),
  'a non-integer limit': (s) => (s['build']['limitSeconds'] = 60.5),
  'an empty model': (s) => (s['build']['model'] = ''),
  'no build': (s) => delete s['build'],
};

When('I parse the step file example', function () {
  this.state['step'] = parseStepFile(example());
});

When('I parse the step file example without reviews', function () {
  const raw = example();
  delete raw['reviews'];
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
  'the step review {int} is {string}, {string}, {string}, {int} seconds',
  function (n: number, name: string, model: string, effort: string, limitSeconds: number) {
    assert.deepEqual(stored<StepFile>(this, 'step').reviews[n - 1], { name, model, effort, limitSeconds });
  },
);

Then('the step has {int} review sessions', function (count: number) {
  assert.equal(stored<StepFile>(this, 'step').reviews.length, count);
});

When('I parse the step file example with {int} reviews', function (count: number) {
  const raw = example();
  raw['reviews'] = Array.from({ length: count }, (_, i) => reviewNamed(`review-${i}`));
  this.state['step'] = parseStepFile(raw);
});

When('I parse the step file example with the review name {string}', function (name: string) {
  const raw = example();
  raw['reviews'][0]['name'] = name;
  this.state['step'] = parseStepFile(raw);
});

When('I parse the step file example with the review name {string} refused', function (name: string) {
  const raw = example();
  raw['reviews'][0]['name'] = name;
  this.state['broken'] = raw;
});

Then('parsing the step file fails', function () {
  assert.throws(() => parseStepFile(stored(this, 'broken')));
});

When('I parse the step file example with the parallel {int}', function (parallel: number) {
  const raw = example();
  raw['parallel'] = parallel;
  this.state['step'] = parseStepFile(raw);
});

Then('the step parallel is {int}', function (parallel: number) {
  assert.equal(stored<StepFile>(this, 'step').parallel, parallel);
});

When(
  'I make a broken copy of the step file example with two reviews both named {string}',
  function (name: string) {
    const broken = example();
    broken['reviews'] = [reviewNamed('first'), reviewNamed(name), reviewNamed(name)];
    this.state['broken'] = broken;
  },
);

When(
  'I make a broken copy of the step file example with the reviews named {string}',
  function (names: string) {
    const broken = example();
    broken['reviews'] = names.split(', ').map(reviewNamed);
    this.state['broken'] = broken;
  },
);

Then('parsing the broken step file fails with {string}', function (message: string) {
  assert.throws(
    () => parseStepFile(stored(this, 'broken')),
    (error: ZodError) => {
      assert.deepEqual(
        error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        [message],
      );
      return true;
    },
  );
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
