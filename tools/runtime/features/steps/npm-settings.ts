import assert from 'node:assert/strict';
import { CONTROLLED_NPM_SETTINGS, controlledNpmNames, npmSettingOf } from '../../src/domain/npm-settings.js';
import { kept, Then, When } from './support.js';

When("npm's reading of the variable name {string} is taken", function (name: string) {
  this.state['npmSetting'] = npmSettingOf(name) ?? 'none';
});

Then('the variable name is read as the npm setting {string}', function (setting: string) {
  assert.equal(kept(this, 'npmSetting'), setting);
});

Then('the variable name is not read as a setting of npm', function () {
  assert.equal(kept(this, 'npmSetting'), 'none');
});

When('the controlled npm names are taken from {string}', function (names: string) {
  this.state['controlledNames'] = controlledNpmNames(names.split(','));
});

Then('the controlled npm names are {string}', function (names: string) {
  assert.deepEqual(kept(this, 'controlledNames'), names.split(','));
});

Then('the controlled npm settings are {string}', function (settings: string) {
  assert.deepEqual([...CONTROLLED_NPM_SETTINGS], settings.split(','));
});
