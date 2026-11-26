import assert from 'node:assert/strict';
import type { ZodError } from 'zod';
import { parseStepFile, type StepFile } from '../../src/step-file.js';
import { Then, When, stored } from './helpers.js';

const example = (): Record<string, any> => ({
  build: { model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 2400 },
  reviews: [{ name: 'correctness', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 }],
});

const reviewNamed = (name: string) => ({ name, model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 });

const scoutNamed = (name: string) => ({ name, model: 'claude-haiku-5-5', effort: 'low', limitSeconds: 300 });

const checkNamed = (name: string) => ({ name, command: ['npm', 'run', 'types'], limitSeconds: 600 });

const withCheck = (s: Record<string, any>) => (s['checks'] = [checkNamed('types')]);

const withScout = (s: Record<string, any>) => (s['scouts'] = [scoutNamed('files')]);

/** Copies of the example that the schema accepts: the edge of each rule of `checks`. */
const EDGES: Record<string, (s: Record<string, any>) => unknown> = {
  'eight checks': (s) => (s['checks'] = Array.from({ length: 8 }, (_, i) => checkNamed(`c${i}`))),
  'a check name of 32 characters': (s) => (s['checks'] = [checkNamed('a'.repeat(32))]),
  'a check argv of one argument': (s) => (withCheck(s), (s['checks'][0]['command'] = ['npm'])),
  'a check argv of 32 arguments': (s) => (withCheck(s), (s['checks'][0]['command'] = Array(32).fill('x'))),
  'a check argument of one character': (s) => (withCheck(s), (s['checks'][0]['command'] = ['x'])),
  'a check argument of 300 characters': (s) => (
    withCheck(s),
    (s['checks'][0]['command'] = ['x'.repeat(300)])
  ),
  'a check argument with a space, a quote and a tab': (s) => (
    withCheck(s),
    (s['checks'][0]['command'] = ['a b"c\td'])
  ),
  'a check limit of 1': (s) => (withCheck(s), (s['checks'][0]['limitSeconds'] = 1)),
  'a check limit of 7200': (s) => (withCheck(s), (s['checks'][0]['limitSeconds'] = 7200)),
};

const DEFECTS: Record<string, (s: Record<string, any>) => unknown> = {
  'nine checks': (s) => (s['checks'] = Array.from({ length: 9 }, (_, i) => checkNamed(`c${i}`))),
  'checks that is not a list': (s) => (s['checks'] = checkNamed('types')),
  'the singular check key': (s) => (s['check'] = checkNamed('types')),
  'an unknown key in a check': (s) => (withCheck(s), (s['checks'][0]['temperature'] = 0)),
  'a check without a name': (s) => (withCheck(s), delete s['checks'][0]['name']),
  'a check name with an upper-case letter': (s) => (withCheck(s), (s['checks'][0]['name'] = 'Types')),
  'a check name of 33 characters': (s) => (withCheck(s), (s['checks'][0]['name'] = 'a'.repeat(33))),
  'a check name that starts with a digit': (s) => (withCheck(s), (s['checks'][0]['name'] = '1a')),
  'a check name with an underscore': (s) => (withCheck(s), (s['checks'][0]['name'] = 'a_b')),
  'a check name that ends with a newline': (s) => (withCheck(s), (s['checks'][0]['name'] = 'a\n')),
  'a check without a command': (s) => (withCheck(s), delete s['checks'][0]['command']),
  'a check command that is a string': (s) => (withCheck(s), (s['checks'][0]['command'] = 'npm run types')),
  'an empty check argv': (s) => (withCheck(s), (s['checks'][0]['command'] = [])),
  'a check argv of 33 arguments': (s) => (withCheck(s), (s['checks'][0]['command'] = Array(33).fill('x'))),
  'an empty check argument': (s) => (withCheck(s), (s['checks'][0]['command'] = ['npm', ''])),
  'a check argument that is not a string': (s) => (withCheck(s), (s['checks'][0]['command'] = ['npm', 1])),
  'a check argument of 301 characters': (s) => (
    withCheck(s),
    (s['checks'][0]['command'] = ['x'.repeat(301)])
  ),
  'a check argument with a NUL': (s) => (withCheck(s), (s['checks'][0]['command'] = ['a\u0000b'])),
  'a check argument with a line feed': (s) => (withCheck(s), (s['checks'][0]['command'] = ['a\nb'])),
  'a check argument with a carriage return': (s) => (withCheck(s), (s['checks'][0]['command'] = ['a\rb'])),
  'a check argument that starts with a line feed': (s) => (
    withCheck(s),
    (s['checks'][0]['command'] = ['\nb'])
  ),
  'a check limit of 0': (s) => (withCheck(s), (s['checks'][0]['limitSeconds'] = 0)),
  'a check limit of 7201': (s) => (withCheck(s), (s['checks'][0]['limitSeconds'] = 7201)),
  'a non-integer check limit': (s) => (withCheck(s), (s['checks'][0]['limitSeconds'] = 1.5)),
  'a check without a limit': (s) => (withCheck(s), delete s['checks'][0]['limitSeconds']),
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
  'an unknown key in a scout': (s) => (withScout(s), (s['scouts'][0]['temperature'] = 0)),
  'the singular scout key': (s) => (s['scout'] = scoutNamed('files')),
  'a scout without a name': (s) => (withScout(s), delete s['scouts'][0]['name']),
  'a scout name that starts with a digit': (s) => (withScout(s), (s['scouts'][0]['name'] = '1a')),
  'a scout name with an underscore': (s) => (withScout(s), (s['scouts'][0]['name'] = 'a_b')),
  'a scout name that ends with a newline': (s) => (withScout(s), (s['scouts'][0]['name'] = 'a\n')),
  'a scout name that is not a string': (s) => (withScout(s), (s['scouts'][0]['name'] = 1)),
  'nine scouts': (s) => (s['scouts'] = Array.from({ length: 9 }, (_, i) => scoutNamed(`s${i}`))),
  'scouts that is not a list': (s) => (s['scouts'] = scoutNamed('a')),
  'a scout effort not in list': (s) => (withScout(s), (s['scouts'][0]['effort'] = 'extreme')),
  'a scout limit of 0': (s) => (withScout(s), (s['scouts'][0]['limitSeconds'] = 0)),
  'a scout limit of 7201': (s) => (withScout(s), (s['scouts'][0]['limitSeconds'] = 7201)),
  'an empty scout model': (s) => (withScout(s), (s['scouts'][0]['model'] = '')),
  'a scout without a model': (s) => (withScout(s), delete s['scouts'][0]['model']),
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

When('I parse the step file example with {int} scouts', function (count: number) {
  const raw = example();
  raw['scouts'] = Array.from({ length: count }, (_, i) => scoutNamed(`scout-${i}`));
  this.state['step'] = parseStepFile(raw);
});

When('I parse the step file example without scouts', function () {
  this.state['step'] = parseStepFile(example());
});

When('I parse the step file example with the scout name {string}', function (name: string) {
  const raw = example();
  raw['scouts'] = [scoutNamed(name)];
  this.state['step'] = parseStepFile(raw);
});

When('I parse the step file example with the scout name {string} refused', function (name: string) {
  const raw = example();
  raw['scouts'] = [scoutNamed(name)];
  this.state['broken'] = raw;
});

When('I parse the step file example with a scout and a review both named {string}', function (name: string) {
  const raw = example();
  raw['scouts'] = [scoutNamed(name)];
  raw['reviews'] = [reviewNamed(name)];
  this.state['step'] = parseStepFile(raw);
});

Then('the step has {int} scout sessions', function (count: number) {
  assert.equal(stored<StepFile>(this, 'step').scouts.length, count);
});

Then(
  'the step scout {int} is {string}, {string}, {string}, {int} seconds',
  function (n: number, name: string, model: string, effort: string, limitSeconds: number) {
    assert.deepEqual(stored<StepFile>(this, 'step').scouts[n - 1], { name, model, effort, limitSeconds });
  },
);

When(
  'I make a broken copy of the step file example with two scouts both named {string}',
  function (name: string) {
    const broken = example();
    broken['scouts'] = [scoutNamed('first'), scoutNamed(name), scoutNamed(name)];
    this.state['broken'] = broken;
  },
);

When(
  'I make a broken copy of the step file example with the scouts named {string}',
  function (names: string) {
    const broken = example();
    broken['scouts'] = names.split(', ').map(scoutNamed);
    this.state['broken'] = broken;
  },
);

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

When('I parse the step file example with a check', function () {
  const raw = example();
  withCheck(raw);
  this.state['step'] = parseStepFile(raw);
});

When('I parse a copy of the step file example holding {}', function (edge: string) {
  const change = EDGES[edge];
  assert.ok(change, `no edge named "${edge}"`);
  const raw = example();
  change(raw);
  this.state['step'] = parseStepFile(raw);
});

Then('the step has {int} checks', function (count: number) {
  assert.equal(stored<StepFile>(this, 'step').checks.length, count);
});

Then(
  'the step check {int} is {string}, {string}, {int} seconds',
  function (n: number, name: string, command: string, limitSeconds: number) {
    assert.deepEqual(stored<StepFile>(this, 'step').checks[n - 1], {
      name,
      command: command.split(' '),
      limitSeconds,
    });
  },
);

When(
  'I parse the step file example with a check, a scout and a review all named {string}',
  function (name: string) {
    const raw = example();
    raw['checks'] = [checkNamed(name)];
    raw['scouts'] = [scoutNamed(name)];
    raw['reviews'] = [reviewNamed(name)];
    this.state['step'] = parseStepFile(raw);
  },
);

When(
  'I make a broken copy of the step file example with two checks both named {string}',
  function (name: string) {
    const broken = example();
    broken['checks'] = [checkNamed('first'), checkNamed(name), checkNamed(name)];
    this.state['broken'] = broken;
  },
);

When(
  'I make a broken copy of the step file example with the checks named {string}',
  function (names: string) {
    const broken = example();
    broken['checks'] = names.split(', ').map(checkNamed);
    this.state['broken'] = broken;
  },
);

Then('the Step file binds the provider, model and effort of a subscription build', function () {
  const review = {
    provider: 'anthropic',
    dimension: 'correctness',
    name: 'reader',
    model: 'claude-opus-5-5',
    effort: 'high',
    limitSeconds: 30,
  };
  for (const model of ['gpt-6.2-astra', 'gpt-6.2-sol'])
    for (const effort of ['low', 'medium', 'high', 'xhigh']) {
      const build = { provider: 'openai', model, effort, limitSeconds: 60 },
        raw = { build, reviews: [review] };
      assert.deepEqual(parseStepFile(raw).build, build);
      assert.deepEqual(parseStepFile(raw).reviews, [review]);
      for (const other of [
        { ...build, provider: 'unknown' },
        { ...build, model: 'other' },
        { ...build, effort: 'max' },
      ])
        assert.throws(() => parseStepFile({ ...raw, build: other }));
      for (const bad of [
        { ...review, provider: 'openai' },
        { ...review, dimension: 'unknown' },
      ])
        assert.throws(() => parseStepFile({ ...raw, reviews: [bad] }));
      assert.throws(() => parseStepFile({ ...raw, scouts: [review] }));
    }
});

const twoTickets = () => [
  { id: 'TICKET-002', story_points: 8, depends_on: ['TICKET-001'], acceptance_ids: ['AC-002'] },
  { id: 'TICKET-001', story_points: 3, depends_on: [], acceptance_ids: ['AC-001'] },
];

When('I parse the step file example with two tickets', function () {
  this.state['step'] = parseStepFile({ ...example(), tickets: twoTickets() });
});

Then('the step tickets are {string} in that order', function (ids: string) {
  const step = stored<StepFile>(this, 'step');
  assert.deepEqual(step.tickets, twoTickets());
  assert.deepEqual(
    step.tickets?.map(({ id }) => id),
    ids.split(', '),
  );
});

When('I make a broken copy of the step file example whose tickets depend on each other', function () {
  const [second, first] = twoTickets();
  this.state['broken'] = { ...example(), tickets: [second, { ...first!, depends_on: ['TICKET-002'] }] };
});
