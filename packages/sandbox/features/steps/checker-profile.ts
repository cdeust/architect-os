import assert from 'node:assert/strict';
import { resolveProfile, type ProfileTemplate, type ProfileVariables } from '../../src/profile.js';
import { Then, When, stored } from './helpers.js';

/** The variables the adapter sets for every profile (`PROFILE_VARIABLES`), and no variable of a launcher. */
const ADAPTER_VARS = (): ProfileVariables => ({
  home: '/h',
  repo: '/r',
  worktree: '/r/.claude/worktrees/w',
  worktreeName: 'w',
  tmp: '/t/aos/tmp',
  config: '/t/aos/config',
  sandboxes: '/t',
});

const template = (world: Parameters<typeof stored>[0]) => stored<ProfileTemplate>(world, 'template');

When('I resolve the profile with the variables of the adapter only', function () {
  this.state['resolved'] = resolveProfile(template(this), ADAPTER_VARS());
});

Then('the profile denies writing to nothing', function () {
  assert.deepEqual(template(this).srt.filesystem.denyWrite, []);
});

Then('the profile allows no network domain and denies none', function () {
  assert.deepEqual(template(this).srt.network, { allowedDomains: [], deniedDomains: [] });
});

Then('the profile writes no file', function () {
  assert.deepEqual(template(this).files, {});
});

Then('the resolved profile reaches no network domain', function () {
  const { network } = stored<ReturnType<typeof resolveProfile>>(this, 'resolved').settings;
  assert.deepEqual(network, { allowedDomains: [], deniedDomains: [] });
});
