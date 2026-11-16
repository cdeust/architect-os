import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LOOPBACK, RELAY_SOCKET_VARIABLE, relayServer } from './container-relay.js';
import {
  SandboxError,
  type Sandbox,
  type SandboxExit,
  type SandboxRequest,
  type SandboxRunner,
} from './port.js';
import { killGroup } from './process-group.js';
import { loadTemplate, resolveProfile, type SrtSettings } from './profile.js';
import { sandboxesParent } from './srt-runner.js';

/**
 * The Docker adapter of a platform process, a module or a worker (docs/design/platform-v3-srt.md, §6, "Docker sur le
 * chemin natif"): the same profile templates as the srt adapter, in a container with no network at all. The one port the
 * template allows, `127.0.0.1:<port>` of the host, is reached through a Unix socket of its own to this sandbox, in a
 * folder mounted read-only; in the container, `entry` (container-entry.ts) listens on the same `127.0.0.1:<port>` and
 * relays to that socket, so the process keeps the variables it has under srt. All options are required, none has a
 * default.
 */
export interface DockerProcessRunnerOptions {
  readonly profilesDir: string;
  /** The Docker client: a name resolved in PATH. */
  readonly docker: string;
  /** `name@sha256:<64 hexadecimal characters>`: an image is designated by its digest, never by a tag. */
  readonly image: string;
  /** Absolute path of `node` inside the image. */
  readonly node: string;
  /** The root of the platform: mounted read-only in the container at the same path, `${repo}` of the profiles. */
  readonly root: string;
  /** The parent of the temporary folders of the host, as for the srt adapter; the folder of each relay lives in its `aos-sb`. */
  readonly tmpRoot: string;
  /** Memory bound of the container, in bytes, swap included: a whole number of at least 1. */
  readonly memoryBytes: number;
  /** Bound of the number of processes of the container: a whole number of at least 1. */
  readonly pidsLimit: number;
  /** Variables of the launcher: `callbackPort` for a module; `brokerPort` and `taskToken` for a worker. */
  readonly variables: Readonly<Record<string, string>>;
}

/** What the Docker client is given of the host, a closed list (the same as the first Docker adapter): what finds the daemon. */
const CLIENT_ENV = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT'];
/** The prefix of the variables the Docker client reads for itself (`DOCKER_TLS_VERIFY`, `DOCKER_API_VERSION`, ...). */
const CLIENT_PREFIX = 'DOCKER_';
/** What a template cannot set: what the client is given of the host, and what the adapter sets itself in the container. */
const RESERVED_ENV = [...CLIENT_ENV, RELAY_SOCKET_VARIABLE];

const IMAGE_WITH_DIGEST = /^[a-z0-9][^\s@]*@sha256:[0-9a-f]{64}$/;
/**
 * The longest path of a Unix socket the adapter listens on. The kernel bounds it (107 characters under Linux, 103 under
 * macOS up to 26) and some hosts do not: the adapter refuses beyond the smallest bound, on every host alike.
 */
const SOCKET_PATH_MAX = 103;
/**
 * A path that `--mount` can carry: absolute and not `/` itself (Docker refuses it as a destination), without the comma
 * that separates the fields of the option, a double quote or a control character (the client reads the option as one
 * CSV record; measured, `bench/docker-bridge/lifecycle.sh`).
 */
const MOUNTABLE = /^\/[^,"\x00-\x1f]+$/;
const LOOPBACK_PORT = /^127\.0\.0\.1:([0-9]+)$/;

/** The paths of the container: four `tmpfs` (its home among them, which holds nothing of the host), the folder of the relay. */
const WORK = '/work';
const CONFIG = '/config';
const TMP = '/tmp';
const HOME = '/home/aos';
const SANDBOXES = '/sandboxes';
const RELAY = '/relay';
const SOCKET = 's';
const USER = '10001:10001';

/** A `tmpfs` that the non-root user of the container owns and nothing can execute from. */
const tmpfs = (path: string): string[] => [
  '--tmpfs',
  `${path}:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=0700`,
];
const bind = (source: string, target: string): string[] => [
  '--mount',
  `type=bind,source=${source},target=${target},readonly`,
];

/**
 * The environment of the container. What the template sets is passed by name (`--env NAME`), its value in the
 * environment of the docker client: an argv is readable by every user of the host (`ps`), an environment by its owner
 * alone, and for a worker one of these values is the token of its task. What the adapter sets itself is no secret and
 * is passed by value. A template that sets a variable of the client, or one the adapter sets itself, is refused: it
 * would change the client, or leave to Docker which of two values the container gets.
 */
function containerEnv(profile: string, set: Readonly<Record<string, string>>) {
  const clash = Object.keys(set).find(
    (name) => name.startsWith(CLIENT_PREFIX) || RESERVED_ENV.includes(name),
  );
  if (clash !== undefined)
    throw new SandboxError(
      'PROFILE_INVALID',
      `${profile} : ${clash} is a variable of the docker client or of the adapter`,
    );
  return {
    byName: Object.keys(set).flatMap((name) => ['--env', name]),
    byValue: ['--env', `HOME=${HOME}`, '--env', `${RELAY_SOCKET_VARIABLE}=${RELAY}/${SOCKET}`],
  };
}

/** The one port the template allows: exactly one entry `127.0.0.1:<port>`, a port from 1 to 65535, nothing denied. */
function relayPort(profile: string, network: SrtSettings['network']): number {
  const { allowedDomains, deniedDomains } = network;
  const match =
    allowedDomains.length === 1 && deniedDomains.length === 0
      ? LOOPBACK_PORT.exec(allowedDomains[0] as string)
      : null;
  const port = Number(match?.[1]);
  if (!(port >= 1 && port <= 65535))
    throw new SandboxError(
      'PROFILE_INVALID',
      `${profile} : the network must be exactly one entry 127.0.0.1:<port>, port 1 to 65535, and no denied domain`,
    );
  return port;
}

interface Relay {
  readonly folder: string;
  /** Ends the connections it relays, closes the listener, removes the folder. It does not throw. */
  close(): void;
}

/**
 * A folder of its own for this sandbox, under the parent of the sandboxes (which keeps the other users of the host out:
 * 0700, its owner's), and in it a Unix socket that relays each connection to `127.0.0.1:<port>` of the host and to
 * nothing else. The user of the container is not the user of the gateway: the folder is readable and the socket
 * writable by anyone who can reach them, which only the mount gives. A failure leaves nothing behind.
 *
 * @throws SandboxError ISOLATION_UNAVAILABLE when the socket cannot be listened on.
 */
async function openRelay(tmpRoot: string, port: number): Promise<Relay> {
  const folder = mkdtempSync(join(sandboxesParent(tmpRoot), 'r-'));
  const socket = join(folder, SOCKET);
  const ended = new AbortController();
  const server = relayServer({ host: LOOPBACK, port }, ended.signal);
  const close = () => {
    ended.abort();
    // Closing the listener removes its socket (libuv unlinks the path of a pipe it closes): the folder is then empty,
    // and removing it as an empty folder fails if the listener was left open.
    server.close();
    try {
      rmdirSync(folder);
    } catch {
      // Already removed (a cleaner of temporary files): there is nothing to remove, and nothing to bring down for it.
    }
  };
  try {
    if (socket.length > SOCKET_PATH_MAX)
      throw new Error(`a path of ${socket.length} characters, more than ${SOCKET_PATH_MAX}`);
    chmodSync(folder, 0o755);
    // `once` rejects on an `error` of the server: a listen that fails refuses this start, it does not bring the host down.
    await once(server.listen(socket), 'listening');
    chmodSync(socket, 0o666);
  } catch (error) {
    close();
    throw new SandboxError('ISOLATION_UNAVAILABLE', `relay socket ${socket}: ${(error as Error).message}`);
  }
  return { folder, close };
}

export class DockerProcessRunner implements SandboxRunner {
  /**
   * @throws SandboxError ISOLATION_UNAVAILABLE when the image does not carry a digest, when a bound does not bound, when
   * a path cannot be mounted.
   */
  constructor(
    private readonly options: DockerProcessRunnerOptions,
    private readonly hostEnv: Readonly<Record<string, string | undefined>>,
  ) {
    if (!IMAGE_WITH_DIGEST.test(options.image))
      throw new SandboxError(
        'ISOLATION_UNAVAILABLE',
        `image without a digest (name@sha256:<64 hexadecimal characters>): ${options.image}`,
      );
    for (const [name, bound] of [
      ['memoryBytes', options.memoryBytes],
      ['pidsLimit', options.pidsLimit],
    ] as const)
      // Docker reads 0 and -1 as "no bound"; beyond the exact whole numbers, the text of a number is no longer digits.
      if (!Number.isSafeInteger(bound) || bound < 1)
        throw new SandboxError(
          'ISOLATION_UNAVAILABLE',
          `${name} is not a whole number of at least 1: ${bound}`,
        );
    for (const path of [options.root, options.tmpRoot])
      if (!MOUNTABLE.test(path))
        throw new SandboxError('ISOLATION_UNAVAILABLE', `not a path a mount can carry: ${path}`);
  }

  /** `request.cwd` is not used: the working directory is a `tmpfs` of the container, the root is an option. */
  async start(request: SandboxRequest): Promise<Sandbox> {
    const o = this.options;
    const [program, ...args] = request.command;
    if (program !== 'node')
      throw new SandboxError('COMMAND_NOT_FOUND', `argv[0] must be node, the node of the image: ${program}`);
    const profile = resolveProfile(loadTemplate(o.profilesDir, request.profile), {
      ...o.variables,
      home: HOME,
      repo: o.root,
      worktree: WORK,
      worktreeName: basename(WORK),
      tmp: TMP,
      config: CONFIG,
      sandboxes: SANDBOXES,
    });
    const port = relayPort(request.profile, profile.settings.network);
    // What a template asks and this adapter cannot give is refused, never left out in silence.
    if (Object.keys(profile.files).length > 0)
      throw new SandboxError(
        'PROFILE_INVALID',
        `${request.profile} : the template declares files, which this adapter does not write`,
      );
    // The environment of the container is what the template sets, its home and the relay socket, nothing of the host:
    // the `pass` list of the template names host variables, which under Docker are not passed, and `unset` has nothing
    // to remove.
    const env = containerEnv(request.profile, profile.env.set);
    const relay = await openRelay(o.tmpRoot, port);
    const name = `aos-sandbox-${randomUUID()}`;
    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      // The entry is not the first process of the container: Docker's init is, and reaps the orphans of the program.
      '--init',
      // The daemon keeps no copy of what the container writes: its stdout is the MCP stream of a module.
      '--log-driver',
      'none',
      '--name',
      name,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      // Rootless Docker does not support AppArmor (docs.docker.com/engine/security/rootless/troubleshoot, known
      // limitations), and on a host where AppArmor is on its daemon refuses a container without this: there is no
      // profile to lose. The adapter runs before a rootless daemon only (design, §6).
      '--security-opt',
      'apparmor=unconfined',
      '--user',
      USER,
      '--memory',
      String(o.memoryBytes),
      // Equal to the memory bound: no swap beyond it.
      '--memory-swap',
      String(o.memoryBytes),
      '--pids-limit',
      String(o.pidsLimit),
      ...tmpfs(WORK),
      ...tmpfs(CONFIG),
      ...tmpfs(TMP),
      ...tmpfs(HOME),
      ...bind(o.root, o.root),
      ...bind(relay.folder, RELAY),
      '--workdir',
      WORK,
      ...env.byName,
      ...env.byValue,
      o.image,
      o.node,
      join(o.root, 'packages', 'sandbox', 'dist', 'src', 'container-entry.js'),
      String(port),
      '--',
      o.node,
      ...args,
    ];
    const clientEnv = Object.fromEntries(CLIENT_ENV.map((key) => [key, this.hostEnv[key]]));
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(o.docker, dockerArgs, {
        env: { ...clientEnv, ...profile.env.set },
        detached: true,
        shell: false,
      });
      // `once` rejects on an `error` of the client.
      await once(child, 'spawn');
    } catch (error) {
      relay.close();
      throw new SandboxError('COMMAND_NOT_FOUND', `docker client not started: ${(error as Error).message}`);
    }
    // A container that closes its stdin early does not bring the host down, which still writes (EPIPE) [E-02].
    child.stdin.on('error', () => undefined);
    const gone = new Promise<SandboxExit>((done) =>
      child.once('exit', (code, signal) => {
        // The client gone, by itself or killed by stop(): the port of the host is no longer reachable.
        relay.close();
        done({ code, signal });
      }),
    );
    // Killing or losing the client does not stop the container, and `--rm` acts only when the container ends: once the
    // client is gone, whoever ended it, the container is removed by its name. `once` rejects when the client of the
    // removal cannot be run.
    const removed = gone.then(() =>
      once(spawn(o.docker, ['rm', '-f', name], { env: clientEnv, shell: false }), 'close'),
    );
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      // Resolved once the removal was tried, and never rejected: stop() says when the removal could not be run.
      exited: removed.then(
        () => gone,
        () => gone,
      ),
      stop: async () => {
        killGroup(child.pid, 'SIGKILL');
        await removed.catch((error: Error) => {
          throw new SandboxError('COMMAND_NOT_FOUND', `container ${name} not removed: ${error.message}`);
        });
        return gone;
      },
    };
  }
}
