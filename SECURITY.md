# Security Policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). If that option is unavailable, contact the maintainer, Clement Deust, by email at the address on his GitHub profile.

Please include: the affected component (`gateway`, `data`, `modules/broker`, `modules/memory`, `services/memory` for the worker, `packages/sandbox`, a tool under `tools/`), the version or commit, steps to reproduce, and the impact you observed. We aim to acknowledge a report within 5 working days.

## Scope and design notes

- The gateway is the single entry. It listens on the loopback only, and authenticates, counts and audits every call; an edge in front of it is the operator's (`deploy/edge/` holds an example, which nothing in this tree starts).
- Modules and workers run in `srt` sandboxes, one per task for a worker. A worker holds no secret: it reaches one port, the broker, with a token of its task that the broker revokes when the task ends. See `docs/architecture.md` and `docs/infrastructure.md`.
- The API key is held by the broker alone, in a file only its user reads. Only `data` holds the database address and accesses the database, through typed operations.
- Secrets never belong in the repository. If you find one, report it as above.
- Dependencies are pinned to exact versions with a committed lockfile. Every Monday a workflow (`.github/workflows/watch.yml`) asks for the advisories published on the locked dependencies, and compares what the platform holds of Anthropic with what is published (`docs/design/anthropic-watch.md`).

## Supported versions

The project is pre-release; only the default branch is supported.
