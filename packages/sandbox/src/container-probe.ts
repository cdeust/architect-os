import { closeSync, openSync, readFileSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { LOOPBACK } from './container-relay.js';

/**
 * What runs in the canary container of the Docker adapter (docker-process-runner.ts, `check`): it reports what the
 * container is, and decides nothing, the adapter judges. Node built-ins only: it runs in an image that holds nothing
 * but node. Its file, container-probe-entry.ts, is one line: all of it is here, given its host as an argument.
 */

/** The files of the cgroup of the container that bound its memory, its swap and its processes. */
export const CGROUP_FILES = ['memory.max', 'memory.swap.max', 'pids.max'] as const;

/** Everything the probe tries, given by the adapter: nothing is chosen here. */
export interface ProbeTargets {
  /** The loopback port to read from, as a module does: through the entry and the relay. */
  readonly port: number;
  /** The address outside, a connection to it must fail. */
  readonly outside: { readonly host: string; readonly port: number };
  /** The longest a connection of the probe stays silent before it is given up, in milliseconds. */
  readonly boundMs: number;
  /** The folders where a write is tried and must fail. */
  readonly unwritable: readonly string[];
  /** The folders where a write is tried and must succeed. */
  readonly writable: readonly string[];
  /** The folder of the cgroup files. */
  readonly cgroup: string;
}

/** What an attempt gave: its content, or the error code it ended with (`no answer` when it did not end in time). */
export type Outcome = { readonly content: string } | { readonly error: string };

export interface ProbeReport {
  readonly read: Outcome;
  readonly uid: number;
  readonly interfaces: readonly string[];
  readonly outside: Outcome;
  readonly writes: Readonly<Record<string, Outcome>>;
  readonly cgroup: Readonly<Record<(typeof CGROUP_FILES)[number], Outcome>>;
}

const failure = (error: unknown): Outcome => ({ error: String((error as NodeJS.ErrnoException).code) });

/**
 * Connects to `host:port` and lets `onConnect` say what the attempt gave once connected. A refusal gives its error
 * code, a connection that stays silent for `boundMs`, connected or not, gives `no answer`. The socket is always
 * destroyed, and its bound with it.
 */
function contact(
  host: string,
  port: number,
  boundMs: number,
  onConnect: (socket: Socket, finish: (outcome: Outcome) => void) => void,
): Promise<Outcome> {
  return new Promise((done) => {
    const socket = connect({ host, port });
    const finish = (outcome: Outcome) => {
      socket.destroy();
      done(outcome);
    };
    socket.setTimeout(boundMs, () => finish({ error: 'no answer' }));
    socket.once('error', (error) => finish(failure(error)));
    socket.once('connect', () => onConnect(socket, finish));
  });
}

/** What the port answers, up to the end of the connection; decoded once whole. */
const readAll = (socket: Socket, finish: (outcome: Outcome) => void): void => {
  const chunks: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => chunks.push(chunk));
  socket.once('close', () => finish({ content: Buffer.concat(chunks).toString() }));
};

/**
 * Creates a file in the folder, and removes it. The file must not exist: where a write should have failed and does
 * not, the probe does not remove a file that was there before it.
 */
function tryWrite(folder: string): Outcome {
  const file = join(folder, `.aos-probe-${process.pid}`);
  try {
    closeSync(openSync(file, 'wx'));
    rmSync(file);
    return { content: 'written' };
  } catch (error) {
    return failure(error);
  }
}

function tryRead(file: string): Outcome {
  try {
    return { content: readFileSync(file, 'utf8').trim() };
  } catch (error) {
    return failure(error);
  }
}

/** Probes the container, and returns what it found. */
async function probeContainer(targets: ProbeTargets): Promise<ProbeReport> {
  const read = await contact(LOOPBACK, targets.port, targets.boundMs, readAll);
  const outside = await contact(
    targets.outside.host,
    targets.outside.port,
    targets.boundMs,
    (_socket, finish) => finish({ content: 'connected' }),
  );
  return {
    read,
    uid: (process as { getuid(): number }).getuid(),
    interfaces: Object.keys(networkInterfaces()).sort(),
    outside,
    writes: Object.fromEntries(
      [...targets.unwritable, ...targets.writable].map((folder) => [folder, tryWrite(folder)]),
    ),
    cgroup: Object.fromEntries(
      CGROUP_FILES.map((name) => [name, tryRead(join(targets.cgroup, name))]),
    ) as ProbeReport['cgroup'],
  };
}

/** What the probe uses of its process. */
export interface ProbeHost {
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): unknown };
}

/**
 * The probe as the canary container runs it: its one argument is the JSON of its targets, its report is one line of
 * JSON on its output. An argument that is not JSON is an error of the adapter: it throws, and node says it on the
 * error output, which the check quotes.
 */
export async function runContainerProbe(host: ProbeHost): Promise<number> {
  const targets = JSON.parse(host.argv[2] as string) as ProbeTargets;
  host.stdout.write(`${JSON.stringify(await probeContainer(targets))}\n`);
  return 0;
}
