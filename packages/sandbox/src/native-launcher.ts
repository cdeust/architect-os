import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { SandboxExit } from './port.js';
import { killGroup } from './process-group.js';

/** One native process of the design (§2): where it runs, its exact argv, and the only environment it gets. */
export interface NativeProcess {
  readonly cwd: string;
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** Runs `fire` after `ms`, unless the function it returns is called first (`timer` of timer.ts). */
export type Schedule = (fire: () => void, ms: number) => () => void;

export interface NativeLauncherOptions {
  /** What a closed child gets to end by itself once its stdin is closed, before its process group is killed. */
  readonly graceMs: number;
  readonly schedule: Schedule;
  /**
   * Receives what a child writes on its stderr, its logs, with its name. The launcher reads that pipe itself: a
   * child whose stderr nobody reads blocks once the pipe is full, and never sees the end of its stdin.
   */
  readonly log: (name: string, text: string) => void;
}

/**
 * A native child: the two pipes of its MCP channel, its end, and how to end it. Not a `Sandbox` of the port: it has
 * no `stop()`, so the compiler refuses it wherever a sandbox is expected.
 */
export interface NativeChild {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly exited: Promise<SandboxExit>;
  /**
   * Closes its stdin, which a native of the design reads as its parent leaving and ends on (data closes its store,
   * the broker its listener); a child still there after the grace period has its whole process group killed.
   */
  close(): Promise<SandboxExit>;
}

export type NativeLaunchErrorCode = 'UNKNOWN_PROCESS' | 'PATH_NOT_ABSOLUTE' | 'SPAWN_FAILED';

export class NativeLaunchError extends Error {
  readonly code: NativeLaunchErrorCode;
  constructor(code: NativeLaunchErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'NativeLaunchError';
  }
}

/**
 * Launches the processes the design keeps outside srt (platform-v3-srt.md, §2, "Pourquoi quatre natifs"): the broker
 * and `data`, children of the gateway, each an MCP server on its stdio. A closed list: a name, its working directory,
 * its argv, its environment. Nothing else can be launched, nothing of the caller's environment is inherited, not even
 * `PATH` (so argv[0] is an absolute path, and so is the working directory), and there is no shell.
 *
 * It isolates nothing, and it is deliberately not an adapter of `SandboxRunner`: neither the launcher nor its
 * children have the types of the port, so the compiler refuses them where a sandbox is expected, a module host or a
 * worker host. Untrusted content never runs through it.
 *
 * No output cap: these children speak MCP to their parent for the whole life of the gateway.
 */
export class NativeLauncher {
  private readonly processes: ReadonlyMap<string, NativeProcess>;

  constructor(
    processes: Readonly<Record<string, NativeProcess>>,
    private readonly options: NativeLauncherOptions,
  ) {
    // A copy: the list is closed at construction, whatever its author does with the object afterwards.
    const declared = Object.entries(structuredClone(processes));
    for (const [name, { cwd, command }] of declared) {
      if (!isAbsolute(cwd))
        throw new NativeLaunchError('PATH_NOT_ABSOLUTE', `${name}: its working directory must be absolute`);
      if (!isAbsolute(String(command[0])))
        throw new NativeLaunchError('PATH_NOT_ABSOLUTE', `${name}: argv[0] must be an absolute path`);
    }
    this.processes = new Map(declared);
  }

  async start(name: string): Promise<NativeChild> {
    const declared = this.processes.get(name);
    if (declared === undefined)
      throw new NativeLaunchError('UNKNOWN_PROCESS', `no native process is named ${name}`);
    const [executable, ...args] = declared.command as [string, ...string[]];
    // Three pipes and no shell: the defaults of spawn. Its own process group, so that the whole of it can be killed.
    const child = spawn(executable, args, { cwd: declared.cwd, env: declared.env, detached: true });
    // A child that no longer reads answers a write with EPIPE: without a listener, that error would end the parent.
    child.stdin.on('error', () => {});
    const { graceMs, schedule, log } = this.options;
    // UTF-8, the default of the decoder: a character cut between two chunks is given whole with the next one.
    const decoder = new StringDecoder();
    child.stderr.on('data', (chunk: Buffer) => log(name, decoder.write(chunk)));
    await new Promise<void>((started, failed) => {
      child.once('spawn', started);
      child.once('error', (error) =>
        failed(new NativeLaunchError('SPAWN_FAILED', `${name}: ${error.message}`)),
      );
    });
    const exited = new Promise<SandboxExit>((done) =>
      child.once('exit', (code, signal) => done({ code, signal })),
    );
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      exited,
      close: () => {
        child.stdin.end();
        const cancel = schedule(() => killGroup(child.pid, 'SIGKILL'), graceMs);
        return exited.finally(cancel);
      },
    };
  }
}
