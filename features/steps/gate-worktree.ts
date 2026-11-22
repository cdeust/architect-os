import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, Then } from './helpers.js';
Then('the native Gate proves {string} in disposable Git checkouts', function (kind: string) {
  const env = { ...process.env };
  delete env.AOS_GATE_LEASE_FD;
  const done = spawnSync(
    '/usr/bin/python3',
    ['-I', join(ROOT, 'tools/test-gate/fixtures/checkout-lease.py'), ROOT, kind],
    { env, encoding: 'utf8' },
  );
  assert.equal(done.status, 0, done.stderr);
});
