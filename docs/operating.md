# Operating the platform as one process

This page is for whoever runs the platform on a host: what the process needs, what it refuses, how it stops, and what it leaves. It describes the native path (`docs/design/platform-v3-srt.md`, §2 and §6): one process, started by `node gateway/dist/src/serve.js`, which starts `data` and the broker as its children and isolates every module and worker. Each statement names the scenario or the measure that holds it.

## Hosts

| Host                  | Means of isolation                        | Proven by                                                                                                                   |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| macOS                 | `srt`                                     | `features/sandbox/` in the CI job `gate-macos`                                                                              |
| Linux                 | `srt`, or Docker before a rootless daemon | `features/sandbox/` in `gate-linux`; `rootless/*.feature` in the workflow `rootless.yml`, on x86-64 and arm64               |
| Windows, through WSL2 | as Linux                                  | under `srt`: the suite, the bench and the overhead measures (journal, §38, §39). The Docker mode has not been run there yet |

Native Windows is not planned. Podman is not supported: one engine, proven.

The means is written by the operator and never detected: `GATEWAY_SANDBOX` has no default, and the process does not fall back from one means to the other. `srt` is the preferred means wherever it runs; Docker is for the hosts where it cannot (no unprivileged user namespace, a policy that forbids it).

## Configuration

Every variable is required unless said otherwise, and none has a default. A refusal names the variable and what is expected of it, never its value (`gateway/features/native-config.feature`). Nothing else of the environment reaches the children: `data` is given its database URL, the broker its configuration file.

| Variable                   | What it is                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_TOKENS`           | `token=subject` pairs separated by `;`. A token has at least 32 characters among letters, digits and `-._~+/`; a subject has no blank           |
| `GATEWAY_PORT`             | The port of the clients, on the loopback only. Put a reverse proxy in front of it to serve another interface (`deploy/edge/Caddyfile`)          |
| `GATEWAY_QUOTA_PER_MINUTE` | Calls per minute, for one subject and one tool, a whole number of at least 1                                                                    |
| `GATEWAY_PROFILE`          | The client profile of `topology/clients.json`. One exists, `owner`: every authenticated client has its rights                                   |
| `GATEWAY_SANDBOX`          | `srt` or `docker`                                                                                                                               |
| `BROKER_CONFIG`            | Absolute path of the broker's JSON file (`modules/broker/broker.json`): its port, its upstream, and the file, mode 0600, that holds the API key |
| `DATABASE_URL`             | A `postgres://` URL, or `memory` for the store that keeps nothing across a restart                                                              |
| `NODE_EXTRA_CA_CERTS`      | Optional: the absolute path of a certificate authority, given to the broker alone, for a host behind an inspecting proxy                        |

With `GATEWAY_SANDBOX=docker`, five more, each of which must be absent with `srt`:

| Variable                    | What it is                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_DOCKER_IMAGE`      | The image of the sandboxes, `name@sha256:<digest>`: by its digest, never by a tag. It holds node and nothing of the platform |
| `GATEWAY_DOCKER_NODE`       | The absolute path of node inside that image (`/usr/local/bin/node` in the official image)                                    |
| `GATEWAY_DOCKER_MEMORY_MIB` | The memory bound of one sandbox, swap included, at least 6                                                                   |
| `GATEWAY_DOCKER_PIDS`       | The bound of the processes of one sandbox, threads included                                                                  |
| `GATEWAY_DOCKER_CHECK_MS`   | The bound of the check at start: of `docker info`, and of the canary container                                               |

In that mode the process also needs what finds the Docker client and its daemon: `PATH` (the client is `docker`), `DOCKER_HOST`, and `HOME` when the client reads its configuration there.

The bounds are those of a real task. The scenarios run a worker, with the agent's binary, under 2048 MiB and 512 processes (`rootless/gateway-entry.feature`); the smallest values that work have not been measured.

## The Docker mode on Linux

The gateway starts no daemon, tunes none and downloads nothing. Four things are the operator's.

**A rootless daemon, started without a bridge.** No container of the platform has a network, so the daemon needs none:

```bash
dockerd-rootless.sh --iptables=false --ip6tables=false --bridge=none
```

Run it as a unit of the user (`systemd --user`), so that systemd applies the bounds of its containers: with cgroup v2 not delegated to the user, Docker ignores `--memory` and `--pids-limit`, and the check at start refuses to go on. `docker info` must say `rootless` among its security options and `systemd` as its cgroup driver. The workflow `rootless.yml` shows one way, on a throwaway runner.

**The right to make a user namespace.** Ubuntu 24.04 and later refuse it to a program without an AppArmor profile that allows it. On a host that lasts, give it to `rootlesskit` alone, by the profile Docker's documentation of the rootless mode describes. The workflow lifts the restriction for every program (`kernel.apparmor_restrict_unprivileged_userns=0`): that is for a runner that is thrown away, not for a host.

**The image, fetched once.** `docker pull <name>@sha256:<digest>`. A start never downloads: an image that is not there is a refusal that names it (`rootless/check.feature`).

**A platform root other users can read.** The user of a container is neither root nor the user of the host: it reads the root through a read-only mount, as any other user of the host would. The folder of the platform and what it holds must be readable by others (mode 755 and 644); its parent folders need not be (measured, `bench/docker-bridge/README.md`). The converse is a rule for the operator: a file of the platform root that others can read is read by every sandbox (`rootless/escape.feature`). Keep no secret there in such a file; the API key lives in a file of mode 0600 outside the root, which only the broker reads.

Before anything is launched, the process checks the means: the daemon must be rootless, and a canary container, launched by the code that launches a sandbox, must report what the design asks (no interface but `lo`, no write outside its `tmpfs`, the one relayed port answering, its three bounds read back from its cgroup). The check takes about 0.2 s (measured on arm64, `bench/docker-bridge/README.md`). A refusal is one line on the standard error, `gateway: ISOLATION_UNAVAILABLE: ...`, exit code 1, with no child started and no port open:

| The line holds                                                  | What to look at                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `the daemon is not rootless: [...]`                             | `DOCKER_HOST` names a daemon with root. It is refused; no variable accepts it   |
| `docker info: no answer within <n> ms`                          | The daemon is slow or down; `GATEWAY_DOCKER_CHECK_MS`                           |
| `docker info: Cannot connect to the Docker daemon at ...`       | `DOCKER_HOST`, or the daemon is not started                                     |
| `docker info: spawn docker ENOENT`                              | No `docker` in the `PATH` given to the process                                  |
| `canary: the container printed nothing; ... No such image`      | The image was not fetched, or the digest is wrong                               |
| `canary: the container printed nothing; ... exec ... failed`    | `GATEWAY_DOCKER_NODE` is not the path of node in that image                     |
| `canary: the container printed nothing; ... Cannot find module` | The platform is not built (`npx tsc -b`), or its root is not readable by others |
| `canary: memory.max: read ..., expected ...` (or `pids.max`)    | The bounds do not apply: cgroup v2 is not delegated to the user of the daemon   |

One difference with `srt` is accepted and written in the design (§6, "Sous-processus de l'agent"): in a container the agent's own isolation of its subprocesses is off, because bubblewrap cannot run there. The container, which holds one task and its token, is the boundary.

## Stopping

`SIGTERM` or `SIGINT` stops the process: it ends its connections, closes its tasks, kills the sandboxes still alive after 10 s, then closes its two children, each given 5 s. At worst 17 s pass between the signal and the end: 10 s, then 2 s that `srt` gives a group it kills, then 5 s for a child (the two bounds of the process are held by `gateway/features/serve-native.feature`). Give the supervisor more than that before it kills: launchd leaves 20 s by default (`ExitTimeOut`), systemd 90 s (`TimeoutStopSec`).

A signal that arrives while the process starts waits for the start to end. Under Docker the start begins with the check: add `GATEWAY_DOCKER_CHECK_MS`, twice at worst (once for `docker info`, once for the canary), to the delay of the supervisor.

The exit code is 0 when the process was asked to stop, 1 otherwise: a refused configuration, a means that does not confine, a child that ended. The process does not outlive `data` or the broker.

## What the process writes, and what it leaves

- **Standard output**: the audit log, one JSON object per line: every call of a client, by its subject, with its outcome.
- **Standard error**: its own refusals (`gateway: ...`) and what its children write, each line prefixed by the name of its process.
- **Temporary files**: `<temporary folder>/aos-sb`, mode 0700, holds one folder per sandbox, removed when the sandbox ends. Under Docker it holds the Unix socket through which a container reaches its one port: a cleaner of temporary files that removed the socket of a module that lives for days would cut that module off. Exclude the folder from such a cleaner (`x /tmp/aos-sb` in a `tmpfiles.d` file).
- **After a clean stop**: nothing. No container is left (asked of the daemon itself, `rootless/gateway-entry.feature`), no relay folder, no listening port.
- **After a kill that cannot be caught** (`SIGKILL`, a power cut): the two children end with their standard input. A sandbox may be left: under `srt`, its processes (measured: killing `srt` alone leaves most of its descendants, journal, §1, T-06); under Docker, its container, named `aos-sandbox-<uuid>`, which `docker rm -f` removes. Folders may be left under `aos-sb`. Nothing removes them at the next start: that is not built.

## What this page does not cover

Postgres in production (backups, roles); the edge in front of the loopback port (TLS, rate limits by address); several gateways on one host or one daemon; rotation of the client tokens and of the API key. None of it is built or measured for the native path yet.
