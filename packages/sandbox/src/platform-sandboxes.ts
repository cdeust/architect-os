import { tmpdir } from 'node:os';
import { DockerProcessRunner } from './docker-process-runner.js';
import type { SandboxRunner } from './port.js';
import { platformProfiles, processRunnerOptions } from './process-options.js';
import { SrtSandboxRunner } from './srt-runner.js';

/** How the platform isolates its modules and its workers: chosen by its operator, never detected. */
export type SandboxMeans =
  | { readonly means: 'srt' }
  | {
      readonly means: 'docker';
      /** `name@sha256:<digest>`. */
      readonly image: string;
      /** Absolute path of `node` inside the image. */
      readonly node: string;
      readonly memoryMiB: number;
      readonly pidsLimit: number;
      readonly checkTimeoutMs: number;
    };

/** The sandboxes of a platform: its check at start, and the runner of a module or of a task. */
export interface PlatformSandboxes {
  /** Rejects when the means cannot confine: nothing of the platform is launched before it resolved. */
  check(): Promise<void>;
  /** The runner of the sandboxes that hold these variables of the launcher. */
  runner(variables: Readonly<Record<string, string>>): SandboxRunner;
}

/**
 * The sandboxes of the platform at `root`, by the means its operator chose: the one place that turns a means into
 * runners. `node` is the node of the host, `env` the environment in which the Docker client is resolved and run.
 *
 * With srt, `check` resolves: srt proves its confinement before every start, with the profile of that start (its
 * canary), and there is nothing to prove before a profile is known; `env` is not used. With Docker, one adapter is built
 * here for the platform: the rules of its options are its own, and it throws here what it refuses; `means.node` is the
 * node of the image, not `node`.
 *
 * @throws SandboxError ISOLATION_UNAVAILABLE when an option of the Docker means is refused by its adapter.
 */
export function platformSandboxes(
  root: string,
  node: string,
  means: SandboxMeans,
  env: Readonly<Record<string, string | undefined>>,
): PlatformSandboxes {
  if (means.means === 'srt')
    return {
      check: () => Promise.resolve(),
      runner: (variables) => new SrtSandboxRunner(processRunnerOptions(root, node, variables)),
    };
  const docker = new DockerProcessRunner(
    {
      profilesDir: platformProfiles(root),
      docker: 'docker',
      image: means.image,
      node: means.node,
      root,
      tmpRoot: tmpdir(),
      memoryMiB: means.memoryMiB,
      pidsLimit: means.pidsLimit,
      checkTimeoutMs: means.checkTimeoutMs,
    },
    env,
  );
  return { check: () => docker.check(), runner: (variables) => docker.withVariables(variables) };
}
