import { readGateReceipt } from '@architect-os/sandbox/gate-receipt';
import { gateReportPath } from '@architect-os/sandbox/gate-reports';
import { runLocations } from '@architect-os/sandbox/runtime-context';
import type { Gate } from '../domain/ports.js';
import { closedEnvironment, runToFile } from './host-process.js';

/** A nested Gate uses the admitted run. Only Git and the forge use the caller's identity. */
export class ProcessGate implements Gate {
  constructor(
    private readonly worktree: string,
    private readonly command: string[],
    private readonly log: string,
    private readonly env: Readonly<NodeJS.ProcessEnv>,
    private readonly searchPath: string,
  ) {}

  verdictHash(): string | undefined {
    return readGateReceipt(this.env.ARCHITECT_OS_RUNTIME_ROOT!, this.worktree);
  }

  async run(): Promise<number> {
    const log = gateReportPath(this.env, this.log);
    const root = this.env.ARCHITECT_OS_RUNTIME_ROOT!,
      run = this.env.ARCHITECT_OS_RUN_DIR!;
    const environment = closedEnvironment(
      { names: ['PG_BIN'], env: this.env },
      {
        ...runLocations(root, run),
        PATH: this.searchPath,
        ARCHITECT_OS_RUNTIME_ROOT: root,
        ARCHITECT_OS_RUN_DIR: run,
        ARCHITECT_OS_ADMISSION_BINDING: this.env.ARCHITECT_OS_ADMISSION_BINDING!,
        ARCHITECT_OS_HOST_XDG_CONFIG_HOME: 'unset',
      },
    );
    const [program, ...args] = this.command;
    return runToFile(program as string, args, this.worktree, log, environment);
  }
}
