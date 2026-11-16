# Trial: one port of the host, reached from a container without a network

Outside production. It answers one question of the design (`docs/design/platform-v3-srt.md`, §6, Docker on the native path), before any code: can a container started with `--network none` reach exactly one listener of its host, and nothing else, as an srt sandbox reaches the one port its profile allows?

```bash
sh bench/docker-bridge/trial.sh          # on a Linux host with Docker and python3
```

On macOS Docker runs in a Linux VM, and a Unix socket of the macOS host cannot be mounted into it: run the trial inside the VM, which is then the host (`colima ssh --profile <profile> -- sh -s < bench/docker-bridge/trial.sh`).

## Result, 15 November 2026

Linux 6.8.0-64 aarch64, Docker 28.3.3, inside the Colima VM `aos-bench` of measure A (started for the trial, stopped after it; the Docker context of the host left unchanged). Image `node:22-alpine`.

| What the container tried | Result |
| --- | --- |
| An HTTP request to `127.0.0.1:4100`, forwarded inside the container to the mounted socket | `200 pong`, from the listener of the host |
| Its network interfaces | `lo` only |
| `1.1.1.1:80` | `ENETUNREACH` |
| The Docker bridge gateway of the host, `172.17.0.1:22` | `ENETUNREACH` |
| A write in the mounted folder | `EROFS` |
| A write in its image | `EROFS` |

The container ran as uid 10001, read-only, with every capability dropped and no privilege escalation: the options of the Docker adapter.

## Under a rootless daemon, 15 November 2026

The Docker mode of the platform runs before a rootless daemon only (design, §6). `rootless.sh` asks what holds there.

```bash
DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock sh bench/docker-bridge/rootless.sh
```

Same VM (Ubuntu 24.04.2, Linux 6.8.0-64 aarch64, Docker 28.3.3, cgroup v2 with `cpuset cpu io memory pids` delegated to the user), with `uidmap`, `docker-ce-rootless-extras`, `slirp4netns` and `dbus-user-session` installed for the trial. The daemon, started as the user, said: `security ["name=seccomp,profile=builtin","name=rootless","name=cgroupns"] cgroup systemd v2`. Played twice, same results.

| Question | Result |
| --- | --- |
| Does the daemon start as the user? | Not with its defaults: it fails to create its bridge (`iptables ... Permission denied`). Started with `--iptables=false --ip6tables=false --bridge=none` it runs; no container of the platform has a network |
| Does a container start? | Not on this host without `--security-opt apparmor=unconfined`: `Could not check if docker-default AppArmor profile was loaded ... permission denied`, exit 126. Docker's documentation lists AppArmor among what rootless mode does not support |
| The relay through the Unix socket | `200 pong`; interfaces `lo` only; `1.1.1.1:80` is `ENETUNREACH` |
| Can the user of the container (uid 10001) read a file of the host user in the read-only mount? | Yes (its owner is seen as uid 0); a write there is `EROFS`; a write in the `tmpfs` succeeds |
| Which uid does the container have on the host? | 534288, a subordinate uid of the user: neither root nor the user |
| `--memory 64m`, a program that takes 300 MB | Killed, exit 137; without the bound it ends with `ALLOCATED 300 MB` |
| `--pids-limit 16`, a program that starts 40 children | 9 started, 31 refused; without the bound, 40 started |

Documentation read the same day, kept outside the repository with its fingerprints: Docker Engine, rootless mode, troubleshooting (known limitations) and tips (limiting resources), and the AppArmor page.

## What the adapter relies on, 15 and 16 November 2026

The adapter (`packages/sandbox/src/docker-process-runner.ts`) was reviewed before it was committed, and each option the review asked for was measured before the same rootless daemon (`lifecycle.sh`, played four times in the night of 15 to 16 November, same results).

```bash
DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock sh bench/docker-bridge/lifecycle.sh
```

| Question | Result |
| --- | --- |
| Five orphans of the program, without `--init` | The first process is `node`; 5 zombies |
| The same, with `--init` | The first process is `docker-init`; 0 zombies |
| The default log driver | `json-file`: the daemon keeps on disk what the container writes on its stdout (4,167 bytes for 4,097 written) |
| `--log-driver none` | Nothing kept; the client still receives the stdout; `docker logs` refuses |
| Bounds in bytes, `--memory-swap` equal to `--memory`, a program that takes 300 MB | Killed, exit 137 |
| The client killed by SIGKILL, a program that does not read its stdin | The container is still up; `docker rm -f` by its name removes it, exit 0 |
| The client killed by SIGKILL, a program that ends when its stdin ends | The container is gone |
| `docker rm -f` of a container that does not exist | Exit 0, with `No such container` |
| A mounted folder whose name holds a space, or an equals sign | Mounted |
| A mounted folder whose name holds a double quote, or a comma | Refused by the client, exit 125 (`parse error`, `invalid field`) |
| The root of the host mounted on the root of the container | Refused by the daemon: `destination can't be '/'` |

## Joining the two connections of a relay, 16 November 2026

The first relay destroyed one connection as soon as the other closed. `join.mjs` shows what that loses, with no Docker at all: a client that reads nothing until the relay has taken the whole answer.

```bash
node bench/docker-bridge/join.mjs
```

macOS 27, node 26.11.1, played twice:

| Answer | Destroy on close | End each direction (the adapter) |
| --- | --- | --- |
| 16,384 bytes | 8,192 received | 16,384 received |
| 32,768 bytes | 16,384 received | 32,768 received |
| 49,152 bytes | 16,384 received | 49,152 received |

The sizes are small on purpose, and the loss depends on the host: it shows only when the answer is larger than what the kernel holds for a Unix socket (8 KiB here, about 208 KiB on Linux) and small enough for the relay to take it whole while its client reads nothing. That is why it is a trial and not a scenario of the gate.

## What this does not show

One host, one image. It does not show the platform's module or worker running this way, the agent's own binary in such a container, the cost of a start, a `stop` that follows a start at once, a host without AppArmor, a host where cgroup v2 is not delegated, Windows through WSL2, or Podman. Those belong to the end-to-end step of the brick (journal, §48, §50, §51).
