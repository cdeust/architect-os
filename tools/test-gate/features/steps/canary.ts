import assert from 'node:assert/strict';
import { greet, sum, twice } from '../../canary/canary.js';
import { Then, When } from './repository.js';

// Steps of features/canary.feature. `twice` is called and its result dropped on purpose: its mutants must survive.

When('the canary sums {int} and {int}', function (a: number, b: number) {
  this.state['canary'] = sum(a, b);
});

When('the canary greets {string}', function (name: string) {
  this.state['canary'] = greet(name);
});

When('the canary doubles {int}', function (n: number) {
  twice(n);
});

Then('the canary result is {int}', function (expected: number) {
  assert.equal(this.state['canary'], expected);
});

Then('the canary result is {string}', function (expected: string) {
  assert.equal(this.state['canary'], expected);
});
