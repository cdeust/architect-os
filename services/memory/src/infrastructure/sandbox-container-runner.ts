import { SandboxError, readCapped, type Sandbox, type SandboxRunner } from '@architect-os/sandbox';
import {
  ServiceError,
  timeoutError,
  type ContainerRunner,
  type WorkerRunRequest,
  type WorkerRunResult,
} from '../domain/ports.js';

export interface SandboxContainerConfig {
  /** The profile the worker runs under, served by the runner. */
  readonly profile: string;
  /** The working directory handed to the runner. */
  readonly cwd: string;
  /** Most bytes read from the worker's stdout and from its stderr (decision 3): beyond, the run is refused. */
  readonly maxOutputBytes: number;
}

/**
 * Runs the worker through the SandboxRunner port of packages/sandbox: the port launches, this adapter only writes the
 * input on stdin and reads a bounded output. No process is spawned here (platform-v3-srt.md, §6).
 */
export class SandboxContainerRunner implements ContainerRunner {
  constructor(
    private readonly sandboxes: SandboxRunner,
    private readonly config: SandboxContainerConfig,
  ) {}

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    let sandbox: Sandbox;
    try {
      sandbox = await this.sandboxes.start({
        profile: this.config.profile,
        cwd: this.config.cwd,
        command: [],
      });
    } catch (error) {
      throw new ServiceError('WORKER_UNAVAILABLE', `cannot start worker: ${String(error)}`);
    }
    sandbox.stdin.end(JSON.stringify(request.input));
    const stdout = readCapped(sandbox.stdout, this.config.maxOutputBytes);
    // stderr is drained, so that a full pipe never blocks the worker, and bounded like stdout.
    const stderr = readCapped(sandbox.stderr, this.config.maxOutputBytes);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, expire) => {
      timer = setTimeout(() => expire(timeoutError(request.timeoutMs)), request.timeoutMs);
    });
    try {
      const [output, , exit] = await Promise.race([Promise.all([stdout, stderr, sandbox.exited]), deadline]);
      return { exitCode: exit.code ?? 1, stdout: output };
    } catch (error) {
      await sandbox.stop();
      if (error instanceof SandboxError && error.code === 'OUTPUT_TOO_LARGE') {
        throw new ServiceError('WORKER_OUTPUT_INVALID', `worker output refused: ${error.message}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
