import { mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runLocations } from '@architect-os/sandbox/runtime-context';
import { temporaryDirectory } from './fixtures.js';
import type { DeliverWorld } from './support.js';

/** A fresh private admission for a single scenario. The binding refers to the actual directory in this fixture. */
export function gateRuntime(world: DeliverWorld) {
  const root = realpathSync(temporaryDirectory(world)),
    name = 'rABC123',
    run = join(root, 'run', name);
  mkdirSync(join(root, 'state'), { mode: 0o700 });
  const locations = runLocations(root, run);
  for (const [key, path] of Object.entries(locations)) {
    if (key === 'npm_config_globalconfig' || key === 'npm_config_userconfig') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, '', { mode: 0o600 });
    } else mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const dir = statSync(run, { bigint: true }),
    owner = statSync(root, { bigint: true });
  const observed = { device: String(owner.dev), inode: String(owner.ino) };
  const receipt =
    JSON.stringify({
      schema: 'architect-os-runtime-receipt/v1',
      run: name,
      environment: 'hosted-runner',
      observations: { root: observed },
    }) + '\n';
  writeFileSync(
    join(root, '.architect-os-runtime-root'),
    'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
  );
  writeFileSync(join(run, 'admission.json'), receipt, { mode: 0o600 });
  const env = {
    ...locations,
    ARCHITECT_OS_RUNTIME_ROOT: root,
    ARCHITECT_OS_RUN_DIR: run,
    ARCHITECT_OS_HOST_XDG_CONFIG_HOME: 'unset',
    ARCHITECT_OS_ADMISSION_BINDING: [dir.dev, dir.ino, Buffer.from(receipt).toString('base64url')].join(':'),
  };
  return { root, run, env };
}
