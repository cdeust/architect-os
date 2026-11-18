import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, Then, When, stored } from './helpers.js';

// The scenarios of features/descriptive/closed-git-environment.feature.

/** The suite's own child, started with a closed list of variables and the three of the scenario. */
function child(world: { state: Record<string, unknown> }, git: string[], support: boolean): void {
  const [dir, editor, token] = git;
  const script = `${support ? 'await import(process.argv[1]);' : ''}console.log(JSON.stringify(Object.keys(process.env).filter((name) => name.startsWith('GIT'))))`;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      script,
      pathToFileURL(join(ROOT, 'features/support/git-environment.ts')).href,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', GIT_DIR: dir, GIT_EDITOR: editor, GITHUB_TOKEN: token },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  world.state['childNames'] = (JSON.parse(result.stdout) as string[]).sort().join(', ');
}

When(
  'a child node with GIT_DIR {string}, GIT_EDITOR {string} and GITHUB_TOKEN {string} in its environment prints its variables that start with GIT',
  function (dir: string, editor: string, token: string) {
    child(this, [dir, editor, token], false);
  },
);

When(
  'a child node with GIT_DIR {string}, GIT_EDITOR {string} and GITHUB_TOKEN {string} in its environment imports the support file of the git environment and prints its variables that start with GIT',
  function (dir: string, editor: string, token: string) {
    child(this, [dir, editor, token], true);
  },
);

Then('the child printed {string}', function (names: string) {
  assert.equal(stored<string>(this, 'childNames'), names);
});
