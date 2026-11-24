import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT, Then } from './helpers.js';

// The same launch as the mutation tool's: the Node of the suite, no loader, the admitted environment of the suite
// (the configuration reads the run's report and temporary locations when it loads).
Then(
  'plain Node imports the configuration of the mutation tool and names its test runner {string}',
  function (runner: string) {
    const done = spawnSync(
      process.execPath,
      [
        '-e',
        "import('./stryker.config.mjs').then((m) => process.stdout.write(String(m.default.testRunner)))",
      ],
      { cwd: ROOT, env: process.env, encoding: 'utf8' },
    );
    assert.equal(done.status, 0, done.stderr);
    assert.equal(done.stdout, runner);
  },
);
