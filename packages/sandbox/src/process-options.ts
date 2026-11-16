import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProcessRunnerOptions } from './srt-runner.js';

/** The committed profile templates of the platform at `root`, the same for every means of isolation. */
export const platformProfiles = (root: string): string => join(root, 'packages', 'sandbox', 'profiles');

/**
 * The options of the srt runner of a platform process (a module, a worker), for the platform at `root`: the committed
 * profiles and the canary of this package, the pinned srt, a disposable working directory, nothing trusted, and of the
 * host only a closed PATH (the folder of `node`, `/usr/bin`, `/bin`) and the home folder. `variables` are those of the
 * profile: the callback port for a module; the broker port and the task token for a worker. This is the one place that
 * resolves srt for the platform: `@anthropic-ai/sandbox-runtime` stays inside this package.
 */
export function processRunnerOptions(
  root: string,
  node: string,
  variables: Readonly<Record<string, string>>,
): ProcessRunnerOptions {
  const home = homedir();
  return {
    profilesDir: platformProfiles(root),
    srtCli: createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js'),
    node,
    canaryProbe: join(root, 'packages', 'sandbox', 'src', 'canary-probe.mjs'),
    tmpRoot: tmpdir(),
    home,
    hostEnv: { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: home },
    trusted: [],
    variables,
    workspace: 'disposable',
  };
}
