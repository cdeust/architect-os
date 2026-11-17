import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureSession, type SessionMeasure } from '../../src/measure.js';
import { PKG, Then, When, stored } from './helpers.js';

When('I measure the fixture {string}', function (file: string) {
  this.state['measure'] = measureSession(readFileSync(join(PKG, 'fixtures', file), 'utf8'));
});

Then('the measure is', function (expected: string) {
  // The fixture says nothing of structuredOutput unless it carries one: then it is undefined.
  assert.deepEqual(stored<SessionMeasure>(this, 'measure'), {
    structuredOutput: undefined,
    ...(JSON.parse(expected) as object),
  });
});

Then('the measure costs by model', function (expected: string) {
  assert.deepEqual(stored<SessionMeasure>(this, 'measure').costByModel, JSON.parse(expected));
});

Then('the measure is not completed, with no cost by model and no model', function () {
  const measure = stored<SessionMeasure>(this, 'measure');
  assert.equal(measure.completed, false);
  assert.deepEqual(measure.costByModel, {});
  assert.deepEqual(measure.models, []);
});
