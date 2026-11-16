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

## What a container reads of its own confinement, 16 November 2026

The check at start of the adapter judges a canary container on what it reports of itself. `canary.sh` asks what such a container can read, before the same rootless daemon (played four times, the rounding of the memory bound twice, same results).

```bash
DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock sh bench/docker-bridge/canary.sh
```

| Container | uid | Interfaces | `192.0.2.1:80` | Write at `/` | `memory.max` | `memory.swap.max` | `pids.max` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The options of the adapter, 256 MiB, 64 processes | 10001 | `lo` | `ENETUNREACH` | `EROFS` | `268435456` | `0` | `64` |
| Without the bounds | 10001 | `lo` | `ENETUNREACH` | `EROFS` | `max` | `max` | `2299` |
| Without `--read-only` | 10001 | `lo` | `ENETUNREACH` | `EACCES` | `max` | `max` | `2299` |
| Without `--user` | 0 | `lo` | `ENETUNREACH` | `EROFS` | `max` | `max` | `2299` |

The daemon says of itself, by `docker info --format '{{json .SecurityOptions}}'`: `["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]`.

The kernel rounds a memory bound down to a page (4,096 bytes on this host): `--memory 268435457` and `268439551` both read back `268435456`, `268439552` reads back itself. Docker refuses a bound under 6 MB (`Minimum memory limit allowed is 6MB`, exit 125). So the adapter takes its memory bound in mebibytes, at least 6, and reads back the very number it asked for.

This daemon was started without a bridge, as the design asks of the operator, so a container without `--network none` has no network either: the trial cannot show the probe seeing a network.

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

## The real adapter before a real rootless daemon, 16 November 2026

Until this trial the adapter and its check at start had only run before a fake Docker client. `adapter/` runs the compiled adapter itself (`DockerProcessRunner`, the code the gateway calls), on the Linux host, before the rootless daemon: its check, then a few starts of the profile `module` with a program that reports what it is (`adapter/module-probe.mjs`), then the refusals.

```bash
npx tsc -b && sh bench/docker-bridge/adapter/bundle.sh /tmp/aos-bundle.tgz     # on the host of the repository
colima ssh --profile <profile> -- sh -c 'cat > /tmp/aos-bundle.tgz' < /tmp/aos-bundle.tgz
colima ssh --profile <profile> -- sh -s < bench/docker-bridge/adapter/host.sh  # in the VM, which is the Linux host
```

Same VM (Ubuntu 24.04.2, Linux 6.8.0-64 aarch64, Docker 28.3.3, the daemon started without a bridge). Image `node:26-bookworm-slim`, by its digest `node@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1`, fetched by the trial before the adapter is called; node 26.13.1, the node of the host being the one of the image, copied out of it. Bounds: 256 MiB, 64 processes, a check bounded at 30 s. Played three times: once with the adapter of commit `8dd8cee`, then twice with the adapter corrected by what the pass before showed.

| Question | Result (third pass) |
| --- | --- |
| The check at start, before the rootless daemon | Passes, 235 ms (196 and 220 ms at the passes before); asked again, 0 ms; no container and no relay folder left |
| A module reads its callback port | `200 pong from the host`, through the entry and the relay; uid 10001, working directory `/work`; its environment is what the template sets, its home, the relay socket, and what the image sets (`PATH`, `HOSTNAME`, `NODE_VERSION`): nothing of the host |
| A module writes in the platform root, in `/work` | `EROFS`; written |
| A module tries another port of the loopback of the host, where a listener answers | `ECONNREFUSED`: its loopback is its own |
| A module takes 400 MiB under a bound of 256 | Killed by the kernel; the sandbox ends with 1 and the entry says `container entry: /usr/local/bin/node ended by SIGKILL` |
| A module starts 100 children under a bound of 64 processes | 49 started, 51 refused |
| A start, to the first output of the module; then its stop | 62 to 82 ms; 35 to 48 ms (five times) |
| A stop that follows a start at once | 6 ms, the client killed, no container left |
| After every start and stop above | No container, no relay folder |
| The daemon with root of the same host | Refused, 18 ms: `the daemon is not rootless: ["name=apparmor","name=seccomp,profile=builtin","name=cgroupns"]` |
| An image that is not there | Refused, 27 ms, nothing downloaded: `No such image: node@sha256:0000...` |
| No node at that path in the image | Refused: `exec /usr/local/bin/nodex failed: No such file or directory` |
| A platform root 755 under a home that others cannot enter (750) | Passes: the mount gives the folder, not its parents |
| A platform root that others cannot enter (700) | Refused: the node of the container cannot read the entry (`Cannot find module <root>/packages/sandbox/dist/src/container-entry.js`) |
| A check bounded at 5 ms | Refused: `docker info: no answer within 5 ms` |
| A check bounded at 60 ms | Refused: `canary: the probe has not ended within 60 ms` |
| No daemon at that address; no docker client in `PATH` | Refused: `Cannot connect to the Docker daemon at ...`; `spawn docker ENOENT` |

What the first two passes showed, and the adapter now does (the first three rows were seen at the first pass):

| Seen | Cause | Now, measured at the third pass |
| --- | --- | --- |
| A wrong path of node gave `Cannot find module '/usr/local/bin/nodex'` | The image declares an entrypoint, a script that ran before the entry and rewrote a command it did not know into `node <command>` | `--entrypoint <node>`: the entrypoint of the image is not run; a node that is not an absolute path is refused at construction |
| An image that was not there made `docker run` try to download it, inside the bound of the check | The default of `docker run` | `--pull never`: a start never downloads; the client names the image it did not find |
| A module killed at its memory bound ended with the code 1 and nothing on its error output | The entry gave 1 for any signal, in silence | The entry says which signal ended its program |
| `docker info` ended by the bound of the check said `Command failed: docker info ...` (second pass, with a bound of 5 ms) | The message of node for any failed command | `docker info: no answer within <n> ms` |

The first module-probe started 100 children that were node: under the bound of processes one of them hung at its start, and the container never ended. That was the probe, not the adapter: the children are now `/bin/sleep`, and each run of the trial is bounded at 20 s.

## What this does not show

One host, one image, by hand: a trial is not a scenario. What these trials left open on the platform's side is now played by scenarios before a real rootless daemon, in CI on an x86-64 runner (`rootless/*.feature`, journal §55): the platform's own module and worker in containers, the agent's binary there, the escape test. Still not shown by anything: a host without AppArmor, a host where cgroup v2 is not delegated, Windows through WSL2, Podman (not supported).
