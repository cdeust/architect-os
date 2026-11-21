import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processRunnerOptions } from '../../src/process-options.js';
import type { ProcessRunnerOptions } from '../../src/srt-runner.js';
import { Then, When, stored, type SandboxWorld } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const options = (world: SandboxWorld): ProcessRunnerOptions =>
  stored<ProcessRunnerOptions>(world, 'process-options');

When(
  'the options of a platform process are made for the root {string}, the node {string} and the variables {string}',
  function (root: string, node: string, variables: string) {
    this.state['process-options'] = processRunnerOptions(
      root,
      node,
      JSON.parse(variables) as Record<string, string>,
    );
  },
);

When('the options of a platform process are made for the root of this repository', function () {
  this.state['process-options'] = processRunnerOptions(ROOT, process.execPath, {});
});

Then(
  'the options of the platform process are, with the home and the temporary folder of this host:',
  function (expected: string) {
    const { srtCli: _srtCli, ...rest } = options(this);
    const wanted = expected
      .replaceAll('<home>', homedir())
      .replaceAll('<tmp>', tmpdir())
      .replaceAll('<runtime>', process.env.ARCHITECT_OS_RUNTIME_ROOT!)
      .replaceAll('<run>', process.env.ARCHITECT_OS_RUN_DIR!);
    assert.deepEqual(rest, JSON.parse(wanted));
  },
);

Then(
  'the srt of the platform process is the cli.js of the installed sandbox runtime, a file that exists',
  function () {
    const { srtCli } = options(this);
    assert.match(srtCli, /node_modules\/@anthropic-ai\/sandbox-runtime\/dist\/cli\.js$/);
    assert.ok(statSync(srtCli).isFile(), srtCli);
  },
);

Then('the profiles {string} and the canary of the options are files that exist', function (profiles: string) {
  const { profilesDir, canaryProbe } = options(this);
  for (const profile of profiles.split(', ')) assert.ok(existsSync(join(profilesDir, profile)), profile);
  assert.ok(statSync(canaryProbe).isFile(), canaryProbe);
});
