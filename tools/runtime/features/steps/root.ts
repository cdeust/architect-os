import assert from 'node:assert/strict';
import { spellingOf } from '../../src/domain/root.js';
import { Then, unescape } from './support.js';

Then('the runtime root setting {string} is spelled {string}', function (setting: string, spelling: string) {
  assert.equal(spellingOf(unescape(setting)), spelling);
});
