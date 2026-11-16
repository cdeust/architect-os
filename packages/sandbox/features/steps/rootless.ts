import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { platformSandboxes, type SandboxMeans } from '../../src/platform-sandboxes.js';
import { ROOT, Then, When, stored } from './helpers.js';
import { pinnedImage } from './rootless-image.js';

// rootless/*.feature: the scenarios that need a real rootless Docker daemon. They run on a Linux host only, by
// `npm run test:rootless` (the profile `rootless` of cucumber.mjs, the workflow rootless.yml), never in the gate:
// the client is the real `docker` of the PATH, the daemon the one of DOCKER_HOST.

/** The bounds of a sandbox of these scenarios, and of the check at start. */
export const BOUNDS = { memoryMiB: 512, pidsLimit: 128, checkTimeoutMs: 30_000 };

/** The daemon with root of the host, where there is one: the default socket of Docker. */
const WITH_ROOT = '/var/run/docker.sock';

/** What a scenario changes of the means: an image that is not there, a node the image does not hold. */
const CHANGED: Record<string, Partial<{ image: string; node: string }>> = {
  'the image of this repository': {},
  'an image that is not there': { image: `node@sha256:${'0'.repeat(64)}` },
  'a node that the image does not hold': { node: '/usr/local/bin/no-such-node' },
};

async function check(
  changed: Partial<{ image: string; node: string }>,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Error | null> {
  const means: SandboxMeans = { means: 'docker', ...pinnedImage(), ...BOUNDS, ...changed };
  return platformSandboxes(ROOT, process.execPath, means, env)
    .check()
    .then(
      () => null,
      (error: Error) => error,
    );
}

When(
  'the sandboxes of this platform are checked before the rootless daemon of this host, with {}',
  { timeout: 120_000 },
  async function (what: string) {
    const changed = CHANGED[what];
    assert.ok(changed, `nothing named "${what}"`);
    this.state['checked'] = await check(changed, process.env);
  },
);

When(
  'the sandboxes of this platform are checked before the daemon with root of this host',
  { timeout: 120_000 },
  async function () {
    // A host with a rootless daemon alone has nothing to refuse here.
    if (!existsSync(WITH_ROOT)) return 'skipped';
    this.state['checked'] = await check({}, { ...process.env, DOCKER_HOST: `unix://${WITH_ROOT}` });
    return undefined;
  },
);

Then('the check of the sandboxes of this platform passed', function () {
  const refusal = stored<Error | null>(this, 'checked');
  assert.equal(refusal, null, String(refusal));
});

Then('the check of the sandboxes of this platform is refused matching {string}', function (pattern: string) {
  const refusal = this.state['checked'] as Error | null;
  assert.ok(refusal instanceof Error, 'the check passed');
  assert.match(refusal.message, new RegExp(pattern));
});
