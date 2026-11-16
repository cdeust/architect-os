import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { connect, createServer, type Server, type Socket } from 'node:net';
import type { Stream } from 'node:stream';

/**
 * What runs in a container of the Docker adapter of a platform process, and what the adapter shares with it. This file
 * and `container-entry.ts` run in an image that holds nothing but node: node built-ins only, no package.
 */

/** The loopback address of the host (for the adapter) and of the container (for the entry): IPv4 only. */
export const LOOPBACK = '127.0.0.1';

/** The environment variable that holds, in the container, the path of the relay socket the entry connects to. */
export const RELAY_SOCKET_VARIABLE = 'AOS_RELAY_SOCKET';

/**
 * Pipes two connections into each other. Each direction ends on its own: the end of one side ends the writing of the
 * other once what was written to it is flushed (`pipe`), and the connection lives until both directions have ended. A
 * failure of one side (a reset, a refused connection, an abort) destroys the other: nothing is left to deliver.
 * Destroying the other when one merely closes would lose the end of an answer its reader had not taken yet.
 */
function joinSockets(a: Socket, b: Socket): void {
  for (const [one, other] of [
    [a, b],
    [b, a],
  ] as const) {
    one.pipe(other);
    one.on('error', () => other.destroy());
  }
}

/** Where a relay sends each connection: a port of the loopback, or a Unix socket. */
export type RelayTarget = { readonly host: string; readonly port: number } | { readonly path: string };

/**
 * A server, not yet listening, that joins each connection it accepts to a connection of its own to `target`. Aborting
 * `ended` destroys the connections under way. Both ends allow a half-open connection: a client that ends its request
 * still reads its answer, and a server that ends its answer still reads the rest of the request.
 */
export function relayServer(target: RelayTarget, ended: AbortSignal): Server {
  return createServer({ allowHalfOpen: true }, (client) =>
    joinSockets(client, connect({ ...target, allowHalfOpen: true, signal: ended })),
  );
}

/** What the entry uses of its process: `process` itself in the container, a stand-in for the scenarios. */
export interface EntryProcess extends EventEmitter {
  /** `[node, entry file, port, '--', program, ...arguments]`. */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: Stream;
  readonly stdout: Stream;
  readonly stderr: Stream & { write(text: string): unknown };
}

/**
 * The entry of a container: relays `127.0.0.1:<port>` to the socket of `RELAY_SOCKET_VARIABLE`, starts the program
 * with the stdio of the process, forwards SIGTERM to it, and resolves with its exit code (1 when a signal ended it).
 * When it cannot listen, cannot start the program, or a signal ended the program (the kernel kills it at the memory
 * bound of the container), it says so on stderr and resolves with 1. It is not the first
 * process of the container: the adapter runs it under `--init`, which reaps the orphans of the program.
 */
export function runContainerEntry(host: EntryProcess): Promise<number> {
  const [, , port, , program, ...args] = host.argv;
  // Aborted with the program: it ends the connections under way, so that nothing keeps the process of the entry alive.
  const ended = new AbortController();
  const server = relayServer({ path: host.env[RELAY_SOCKET_VARIABLE] as string }, ended.signal);
  return new Promise((done) => {
    // A failure to listen ends the entry before the program is started. A failure of the listener once the program
    // runs is only said: the program goes on.
    server.on('error', (error) => {
      host.stderr.write(`container entry: relay on ${LOOPBACK}:${port}: ${error.message}\n`);
      done(1);
    });
    server.listen({ port: Number(port), host: LOOPBACK }, () => {
      const child = spawn(program as string, args, { stdio: [host.stdin, host.stdout, host.stderr] });
      const forward = () => child.kill('SIGTERM');
      host.on('SIGTERM', forward);
      const end = (code: number) => {
        host.off('SIGTERM', forward);
        server.close();
        ended.abort();
        done(code);
      };
      child.once('error', (error) => {
        host.stderr.write(`container entry: cannot start ${program}: ${error.message}\n`);
        end(1);
      });
      child.once('exit', (code, signal) => {
        if (signal !== null) host.stderr.write(`container entry: ${program} ended by ${signal}\n`);
        end(code ?? 1);
      });
    });
  });
}
