import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmdirSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { basename, join } from 'node:path';
import { readCapped } from './capped.js';
import type { ProbeTargets } from './container-probe.js';
import { LOOPBACK, RELAY_SOCKET_VARIABLE, relayServer } from './container-relay.js';
import { firstLine, firstUnmet, isRootless, securityOptions } from './docker-isolation.js';
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
  /**
   * Memory bound of the container, in mebibytes, swap included: a whole number of at least 6, the least Docker accepts.
   * Mebibytes and not bytes: the kernel rounds a bound down to a page, and the check at start reads back the very bound
   * it asked for (measured, `bench/docker-bridge/canary.sh`).
   */
  readonly memoryMiB: number;
  /** Bound of the number of processes of the container: a whole number of at least 1. */
  readonly pidsLimit: number;
  /**
   * The bound of the check at start, in milliseconds: of `docker info`, and of the canary container, which must have
   * printed its report by then. A whole number of at least 1.
   */
  readonly checkTimeoutMs: number;
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
const UID = 10001;
/** Docker refuses a memory bound under 6 MB (measured); a mebibyte in bytes, to read the bound back from the cgroup. */
const MEMORY_MIB_MIN = 6;
const MIB = 1048576;
const USER = `${UID}:${UID}`;

/** What the canary container tries: an address outside (TEST-NET-1, which nothing answers), and the cgroup files of Linux. */
const PROBE_OUTSIDE = { host: '192.0.2.1', port: 80 };
const CGROUP = '/sys/fs/cgroup';
/** The longest output of the canary, its report or its error output: one line of JSON, a few hundred bytes. */
const PROBE_OUTPUT_MAX = 16384;

/** A `tmpfs` that the non-root user of the container owns and nothing can execute from. */
const tmpfs = (path: string): string[] => [
  '--tmpfs',
  `${path}:rw,noexec,nosuid,size=64m,uid=${UID},gid=${UID},mode=0700`,
];
const bind = (source: string, target: string): string[] => [
  '--mount',
  `type=bind,source=${source},target=${target},readonly`,
];

interface ContainerEnv {
  /** What the docker client must hold in its own environment: the values of the variables passed by name. */
  readonly client: Readonly<Record<string, string>>;
  /** The `--env` options of `docker run`. */
  readonly args: readonly string[];
}

/**
 * The environment of the container. What the template sets is passed by name (`--env NAME`), its value in the
 * environment of the docker client: an argv is readable by every user of the host (`ps`), an environment by its owner
 * alone, and for a worker one of these values is the token of its task. What the adapter sets itself is no secret and
 * is passed by value.
 */
function containerEnv(set: Readonly<Record<string, string>>): ContainerEnv {
  return {
    client: set,
    args: [
      ...Object.keys(set).flatMap((name) => ['--env', name]),
      ...['--env', `HOME=${HOME}`, '--env', `${RELAY_SOCKET_VARIABLE}=${RELAY}/${SOCKET}`],
    ],
  };
}

/**
 * Refuses a template that sets a variable of the docker client, or one the adapter sets itself: it would change the
 * client, or leave to Docker which of two values the container gets.
 */
function refuseReserved(profile: string, set: Readonly<Record<string, string>>): void {
  const clash = Object.keys(set).find(
    (name) => name.startsWith(CLIENT_PREFIX) || RESERVED_ENV.includes(name),
  );
  if (clash !== undefined)
    throw new SandboxError(
      'PROFILE_INVALID',
      `${profile} : ${clash} is a variable of the docker client or of the adapter`,
    );
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

/** A file of the compiled sandbox package, under the platform root mounted in the container. */
const compiled = (root: string, file: string): string =>
  join(root, 'packages', 'sandbox', 'dist', 'src', file);

/**
 * The arguments of `docker run` of a container: the one place where the options of confinement are written, for a
 * sandbox and for the canary of the check alike. `args` is what the program is given after the node of the image.
 */
function dockerRunArgs(
  o: DockerProcessRunnerOptions,
  run: { name: string; relayFolder: string; port: number; env: ContainerEnv; args: readonly string[] },
): string[] {
  return [
    'run',
    '--rm',
    '-i',
    // The entry is not the first process of the container: Docker's init is, and reaps the orphans of the program.
    '--init',
    // The daemon keeps no copy of what the container writes: its stdout is the MCP stream of a module.
    '--log-driver',
    'none',
    '--name',
    run.name,
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
    `${o.memoryMiB}m`,
    // Equal to the memory bound: no swap beyond it.
    '--memory-swap',
    `${o.memoryMiB}m`,
    '--pids-limit',
    String(o.pidsLimit),
    ...tmpfs(WORK),
    ...tmpfs(CONFIG),
    ...tmpfs(TMP),
    ...tmpfs(HOME),
    ...bind(o.root, o.root),
    ...bind(run.relayFolder, RELAY),
    '--workdir',
    WORK,
    ...run.env.args,
    o.image,
    o.node,
    compiled(o.root, 'container-entry.js'),
    String(run.port),
    '--',
    o.node,
    ...run.args,
  ];
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

/**
 * Built once for a platform: its options do not change from one sandbox to the next. A module and each task of a worker
 * have variables of their own, and a runner of their own (`withVariables`); all of them share the one check at start.
 */
export class DockerProcessRunner {
  /** The check under way or the check that succeeded, shared by whoever asks; a check that failed is forgotten. */
  private checked: Promise<void> | undefined;

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
    for (const [name, bound, least] of [
      ['memoryMiB', options.memoryMiB, MEMORY_MIB_MIN],
      ['pidsLimit', options.pidsLimit, 1],
      ['checkTimeoutMs', options.checkTimeoutMs, 1],
    ] as const)
      // Docker reads 0 and -1 as "no bound"; beyond the exact whole numbers, the text of a number is no longer digits.
      if (!Number.isSafeInteger(bound) || bound < least)
        throw new SandboxError(
          'ISOLATION_UNAVAILABLE',
          `${name} is not a whole number of at least ${least}: ${bound}`,
        );
    for (const path of [options.root, options.tmpRoot])
      if (!MOUNTABLE.test(path))
        throw new SandboxError('ISOLATION_UNAVAILABLE', `not a path a mount can carry: ${path}`);
  }

  /**
   * The runner of the sandboxes that hold these variables of the launcher: `callbackPort` for a module; `brokerPort`
   * and `taskToken` for a worker.
   */
  withVariables(variables: Readonly<Record<string, string>>): SandboxRunner {
    return { start: (request) => this.start(request, variables) };
  }

  /** `request.cwd` is not used: the working directory is a `tmpfs` of the container, the root is an option. */
  private async start(
    request: SandboxRequest,
    variables: Readonly<Record<string, string>>,
  ): Promise<Sandbox> {
    const o = this.options;
    const [program, ...args] = request.command;
    if (program !== 'node')
      throw new SandboxError('COMMAND_NOT_FOUND', `argv[0] must be node, the node of the image: ${program}`);
    const profile = resolveProfile(loadTemplate(o.profilesDir, request.profile), {
      ...variables,
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
    refuseReserved(request.profile, profile.env.set);
    await this.check();
    return this.launch({ port, env: containerEnv(profile.env.set), args });
  }

  /** What the Docker client is given of the host. */
  private clientEnv() {
    return Object.fromEntries(CLIENT_ENV.map((key) => [key, this.hostEnv[key]]));
  }

  /**
   * The check at start, which every start asks for first (docs/design/platform-v3-srt.md, §6): the daemon is rootless,
   * and a canary container, launched as a sandbox is, is confined as the design says. A check that succeeded is not
   * run again; a refusal is not remembered, and a daemon that was down may come back. Concurrent calls share one check.
   *
   * @throws SandboxError ISOLATION_UNAVAILABLE naming the first condition that does not hold, what was read and what
   * was expected; COMMAND_NOT_FOUND naming the canary container when its removal could not be run, whatever the
   * canary reported: a container may be left.
   */
  check(): Promise<void> {
    this.checked ??= this.requireRootless()
      .then(() => this.requireConfined())
      .catch((error: unknown) => {
        this.checked = undefined;
        throw error;
      });
    return this.checked;
  }

  /** `docker info` must end within the bound of the check, and name a rootless daemon. */
  private async requireRootless(): Promise<void> {
    const o = this.options;
    const { error, stdout, stderr } = await new Promise<{
      error: Error | null;
      stdout: string;
      stderr: string;
    }>((done) =>
      execFile(
        o.docker,
        ['info', '--format', '{{json .SecurityOptions}}'],
        { env: this.clientEnv(), timeout: o.checkTimeoutMs, encoding: 'utf8' },
        (error, stdout, stderr) => done({ error, stdout, stderr }),
      ),
    );
    if (error !== null)
      throw new SandboxError('ISOLATION_UNAVAILABLE', `docker info: ${firstLine(stderr) || error.message}`);
    const entries = securityOptions(stdout);
    if (entries === null)
      throw new SandboxError(
        'ISOLATION_UNAVAILABLE',
        `docker info printed ${JSON.stringify(firstLine(stdout))}, not a JSON array of strings`,
      );
    if (!isRootless(entries))
      throw new SandboxError(
        'ISOLATION_UNAVAILABLE',
        `the daemon is not rootless: ${JSON.stringify(entries)}`,
      );
  }

  /** The canary container must report, within the bound of the check, what the adapter asked of Docker. */
  private async requireConfined(): Promise<void> {
    const o = this.options;
    // The listener answers a value of its own, to be read through the relay by the probe of the container.
    const value = randomUUID();
    const listener = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.end(value);
    });
    let canary: Sandbox | undefined;
    try {
      await once(listener.listen(0, LOOPBACK), 'listening');
      const port = (listener.address() as AddressInfo).port;
      const targets: ProbeTargets = {
        port,
        outside: PROBE_OUTSIDE,
        // Half the bound of the check: a connection that gets no answer is named by the probe before the check gives up.
        boundMs: Math.ceil(o.checkTimeoutMs / 2),
        unwritable: ['/', o.root, RELAY],
        writable: [WORK, CONFIG, TMP, HOME],
        cgroup: CGROUP,
      };
      canary = await this.launch({
        port,
        env: containerEnv({}),
        args: [compiled(o.root, 'container-probe-entry.js'), JSON.stringify(targets)],
      });
      const [report, said] = await this.outputs(canary);
      // The probe did not run to its end (no such image, no node at that path, a platform root that is not built):
      // the reason is on the error output, of the client or of the container.
      if (report.trim() === '')
        throw new SandboxError(
          'ISOLATION_UNAVAILABLE',
          `canary: the container printed nothing; its error output: ${JSON.stringify(said.trim())}`,
        );
      const unmet = firstUnmet(report, {
        value,
        uid: UID,
        targets,
        memory: o.memoryMiB * MIB,
        pids: o.pidsLimit,
      });
      if (unmet !== null) throw new SandboxError('ISOLATION_UNAVAILABLE', `canary: ${unmet}`);
    } finally {
      listener.close();
      // The client killed, the container removed by its name, the relay closed and its folder removed.
      await canary?.stop();
    }
  }

  /**
   * What the canary wrote, on its output and on its error output: each up to its end and within the bound of an
   * output, both within the bound of the check.
   */
  private outputs(canary: Sandbox): Promise<[string, string]> {
    const ms = this.options.checkTimeoutMs;
    // The timer of such a signal does not keep the process alive, and there is nothing to clear once the canary ended.
    const late = new Promise<never>((_, fail) =>
      AbortSignal.timeout(ms).addEventListener('abort', () =>
        fail(new SandboxError('ISOLATION_UNAVAILABLE', `canary: the probe has not ended within ${ms} ms`)),
      ),
    );
    const written = Promise.all([
      readCapped(canary.stdout, PROBE_OUTPUT_MAX),
      readCapped(canary.stderr, PROBE_OUTPUT_MAX),
    ]).catch((error: Error) => {
      throw new SandboxError('ISOLATION_UNAVAILABLE', `canary: ${error.message}`);
    });
    return Promise.race([written, late]);
  }

  /**
   * Opens a relay to `port` of the host and launches a container in which the entry relays the same port to it and
   * runs `node <args>`: the one way a container is started, for a sandbox and for the canary.
   */
  private async launch(run: { port: number; env: ContainerEnv; args: readonly string[] }): Promise<Sandbox> {
    const o = this.options;
    const relay = await openRelay(o.tmpRoot, run.port);
    const name = `aos-sandbox-${randomUUID()}`;
    const dockerArgs = dockerRunArgs(o, { name, relayFolder: relay.folder, ...run });
    const clientEnv = this.clientEnv();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(o.docker, dockerArgs, {
        env: { ...clientEnv, ...run.env.client },
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
