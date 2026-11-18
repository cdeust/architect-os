import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Gate } from '../domain/ports.js';
import { runToFile } from './host-process.js';

/**
 * `Gate` over a child process: `command` (an argv, never through a shell) started in the delivery worktree, its two
 * outputs written to `log`; the verdict is the file `verdict` that the gate leaves when it is green. Both paths are
 * relative to the worktree.
 */
export class ProcessGate implements Gate {
  constructor(
    private readonly worktree: string,
    private readonly command: string[],
    private readonly log: string,
    private readonly verdict: string,
  ) {}

  verdictHash(): string | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(readFileSync(join(this.worktree, this.verdict))));
    } catch {
      // Absent, unreadable or not JSON: nothing was parsed, and the lines below give no verdict.
    }
    const sha = (parsed as { sha?: unknown } | null)?.sha;
    return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  }

  async run(): Promise<number> {
    const log = join(this.worktree, this.log);
    mkdirSync(dirname(log), { recursive: true });
    const [program, ...args] = this.command;
    return runToFile(program as string, args, this.worktree, log);
  }
}
