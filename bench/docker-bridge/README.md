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

## What this does not show

One host, one run, one image. It does not show the platform's module or worker running this way, the agent's own binary in such a container, the cost of a start, or the behaviour under rootless Docker or Podman. Those belong to the brick that builds the adapter (journal, §48).
