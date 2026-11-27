import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { bindFrozenLauncher, bindSessionWorkspace, engineSettings } from '../../src/srt-runner.js';
import { PROFILE_VARIABLES, type SrtSettings } from '../../src/profile.js';
import { Then } from './helpers.js';

Then('native session settings preserve every filesystem rule as exact paths', function () {
  const settings: SrtSettings = {
    network: { allowedDomains: ['api.invalid'], deniedDomains: [] },
    filesystem: { allowRead: [], denyRead: ['/one/a[1]'], allowWrite: ['/one/b*'], denyWrite: ['/one/b*/x'] },
    allowPty: true,
  };
  assert.deepEqual(JSON.parse(engineSettings(settings)), {
    network: { allowedDomains: ['api.invalid'], deniedDomains: [] },
    filesystem: {
      allowRead: [],
      denyRead: [{ path: '/one/a[1]', literal: true }],
      allowWrite: [{ path: '/one/b*', literal: true }],
      denyWrite: [{ path: '/one/b*/x', literal: true }],
    },
    allowPty: true,
  });
});
Then('session workspace binding handles {string}', function (kind: string) {
  const root = '/mnt/rt',
    run = root + '/run/rSelf12',
    parent = run + '/tmp/aos-sb';
  const settings: SrtSettings = {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { allowWrite: ['/checkout'], denyRead: [], denyWrite: [] },
  };
  const work = { repo: '/repository', worktree: '/checkout' };
  const next = root + '/run/rOther1';
  let refusal: string | undefined;
  let expected: string[] | undefined;
  switch (kind) {
    case 'checkout outside the runtime':
      break;
    case 'ordinary prefix neighbour':
      work.worktree = root + '/runner';
      work.repo = root + '/stated';
      break;
    case 'own checkout read fallback':
      work.repo = run + '/fixture';
      expected = [work.repo];
      break;
    case 'own checkout keeps existing reads':
      work.repo = run + '/fixture';
      settings.filesystem.allowRead = ['/private'];
      expected = ['/private', work.repo];
      break;
    case 'linked checkout and git metadata':
      work.repo = run + '/repo';
      work.worktree = work.repo + '/.claude/worktrees/topic';
      settings.filesystem.allowWrite = [work.worktree];
      settings.filesystem.allowRead = [work.worktree];
      expected = [work.worktree, work.repo + '/.git'];
      break;
    case 'mutable runtime root':
      settings.filesystem.allowWrite = [root];
      refusal = 'workspace grants writes';
      break;
    case 'mutable run collection':
      settings.filesystem.allowWrite = [root + '/run'];
      refusal = 'workspace grants writes';
      break;
    case 'mutable session collection':
      settings.filesystem.allowWrite = [parent];
      refusal = 'workspace grants writes';
      break;
    case 'foreign checkout':
      work.worktree = next + '/repo';
      refusal = 'workspace reopens';
      break;
    case 'foreign primary repository':
      work.repo = next + '/repo';
      refusal = 'workspace reopens';
      break;
    case 'shared cache':
      work.worktree = root + '/cache';
      refusal = 'workspace reopens';
      break;
    case 'durable state':
      work.worktree = root + '/state';
      refusal = 'workspace reopens';
      break;
    case 'complete current run':
      work.repo = run;
      refusal = 'workspace reopens';
      break;
    case 'checkout contains all runtime data':
      work.worktree = '/mnt';
      refusal = 'workspace reopens';
      break;
    case 'checkout equals runtime root':
      work.worktree = root;
      refusal = 'workspace reopens';
      break;
    case 'protected cache child':
      work.repo = root + '/cache/data';
      refusal = 'workspace reopens';
      break;
    case 'protected state child':
      work.repo = root + '/state/steps';
      refusal = 'workspace reopens';
      break;
    case 'run collection itself':
      work.worktree = root + '/run';
      refusal = 'workspace reopens';
      break;
    case 'checkout is session collection':
      work.worktree = parent;
      refusal = 'workspace reopens';
      break;
    default:
      assert.fail(kind);
  }
  const bind = () => bindSessionWorkspace(settings, work, root, run, parent);
  if (refusal) assert.throws(bind, new RegExp(refusal));
  else {
    bind();
    assert.deepEqual(settings.filesystem.allowRead, expected);
  }
});

Then('the public host template variables identify the runtime and session locations', function () {
  assert.deepEqual(PROFILE_VARIABLES, [
    'home',
    'runtime',
    'repo',
    'worktree',
    'worktreeName',
    'tmp',
    'config',
    'sandboxes',
    'inputs',
  ]);
});

Then('frozen launcher binding keeps existing reads and rejects unsafe paths', function () {
  const run = realpathSync(mkdtempSync(join(tmpdir(), 'bind-frozen-')));
  this.cleanups.push(() => rmSync(run, { recursive: true, force: true }));
  const temp = join(run, 'tmp');
  mkdirSync(temp);
  const canonical = join(temp, 'aos-launcher-Ab12Cd');
  mkdirSync(canonical);
  const settings: SrtSettings = {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: [run], allowWrite: [], denyWrite: [] },
  };
  bindFrozenLauncher(settings, run, canonical);
  assert.deepEqual(settings.filesystem.allowRead, [canonical]);
  settings.filesystem.allowRead = ['/existing'];
  bindFrozenLauncher(settings, run, canonical);
  assert.deepEqual(settings.filesystem.allowRead, ['/existing', canonical]);
  const alias = join(temp, 'aos-launcher-Xy12Cd');
  symlinkSync(canonical, alias);
  const foreign = join(run, 'aos-launcher-Ab12Cd'),
    prefixed = join(temp, 'bad-aos-launcher-Ab12Cd'),
    suffixed = join(temp, 'aos-launcher-Ab12Cd-extra');
  for (const path of [foreign, prefixed, suffixed]) mkdirSync(path);
  for (const path of [alias, foreign, prefixed, suffixed])
    assert.throws(() => bindFrozenLauncher(settings, run, path), /invalid frozen launcher location/);
  settings.filesystem.allowWrite = [canonical];
  assert.throws(() => bindFrozenLauncher(settings, run, canonical), /chemin de confiance inscriptible/);
  assert.deepEqual(settings.filesystem.allowRead, ['/existing', canonical]);
});
