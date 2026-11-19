# Operating the platform as one process

This page is for whoever runs the platform on a host: what the process needs, what it refuses, how it stops, and what it leaves. It describes the native path (`docs/design/platform-v3-srt.md`, §2 and §6): one process, started by `node gateway/dist/src/serve.js`, which starts `data` and the broker as its children and isolates every module and worker. Each statement names the scenario or the measure that holds it.

## Hosts

| Host                  | Means of isolation | Proven by                                                                                                                                |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                 | `srt`              | `features/sandbox/` in the CI job `gate-macos`                                                                                           |
| Linux                 | `srt`              | `features/sandbox/` in the CI job `gate-linux`                                                                                           |
| Windows, through WSL2 | `srt`              | the suite passed, the srt bench gave the result of Linux CI test by test, and the overhead measures were also taken there (journal, §38) |

Native Windows is not planned. There is one means of isolation, `srt`: Docker is not one (design, decisions 21 and 22).

## Configuration

Every variable is required unless said otherwise, and none has a default. A refusal names the variable and what is expected of it, never its value (`gateway/features/native-config.feature`). Nothing else of the environment reaches the children: `data` is given its database URL, the broker its configuration file.

| Variable                   | What it is                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_TOKENS`           | `token=subject` pairs separated by `;`. A token has at least 32 characters among letters, digits and `-._~+/`; a subject has no blank           |
| `GATEWAY_PORT`             | The port of the clients, on the loopback only. Put a reverse proxy in front of it to serve another interface (`deploy/edge/Caddyfile`)          |
| `GATEWAY_QUOTA_PER_MINUTE` | Calls per minute, for one subject and one tool, a whole number of at least 1                                                                    |
| `GATEWAY_PROFILE`          | The client profile of `topology/clients.json`. One exists, `owner`: every authenticated client has its rights                                   |
| `BROKER_CONFIG`            | Absolute path of the broker's JSON file (`modules/broker/broker.json`): its port, its upstream, and the file, mode 0600, that holds the API key |
| `DATABASE_URL`             | A `postgres://` URL, or `memory` for the store that keeps nothing across a restart                                                              |
| `NODE_EXTRA_CA_CERTS`      | Optional: the absolute path of a certificate authority, given to the broker alone, for a host behind an inspecting proxy                        |

## Stopping

`SIGTERM` or `SIGINT` stops the process: it ends its connections, closes its tasks, kills the sandboxes still alive after 10 s, then closes its two children, each given 5 s. At worst 17 s pass between the signal and the end: 10 s, then 2 s that `srt` gives a group it kills, then 5 s for a child (the two bounds of the process are held by `gateway/features/serve-native.feature`). Give the supervisor more than that before it kills: launchd leaves 20 s by default (`ExitTimeOut`), systemd 90 s (`TimeoutStopSec`).

A signal that arrives while the process starts waits for the start to end.

The exit code is 0 when the process was asked to stop, 1 otherwise: a refused configuration, a child that ended. The process does not outlive `data` or the broker.

## What the process writes, and what it leaves

- **Standard output**: the audit log, one JSON object per line: every call of a client, by its subject, with its outcome.
- **Standard error**: its own refusals (`gateway: ...`) and what its children write, each line prefixed by the name of its process.
- **Temporary files**: `<temporary folder>/aos-sb`, mode 0700, holds one folder per sandbox, removed when the sandbox ends.
- **After a clean stop**: nothing: no process of a sandbox, no folder, no listening port.
- **After a kill that cannot be caught** (`SIGKILL`, a power cut): the two children end with their standard input. A sandbox may be left: its processes (measured: killing `srt` alone leaves most of its descendants, journal, §1, T-06). Folders may be left under `aos-sb`. Nothing removes them at the next start: that is not built.

## What this page does not cover

Postgres in production (backups, roles); the edge in front of the loopback port (TLS, rate limits by address); several gateways on one host or one daemon; rotation of the client tokens and of the API key. None of it is built or measured for the native path yet.
