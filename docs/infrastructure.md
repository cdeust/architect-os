# Infrastructure

## Local stack (`compose.yaml`)

```bash
cp .env.example .env        # fill placeholders; never commit .env
docker compose build        # builds gateway, memory, data images (root Dockerfile)
docker compose --profile build-only build memory-worker   # worker image launched by memory
docker compose up
curl http://127.0.0.1:8080/healthz
```

Services: `proxy` (Caddy), `gateway`, `memory`, `data`, `postgres` (`pgvector/pgvector:pg17`). Every long-running service drops all capabilities and sets `no-new-privileges`; `proxy`, `gateway` and `data` run with a read-only root filesystem.

`docker compose config` validates the file. `features/infra/compose.feature` parses it and asserts the network zones in CI (CI does not start Docker).

## Gateway routes

The gateway connects to every service that owns a tool of `TOOLS`; the URL of service `<name>` is read from `<NAME>_URL` (`MEMORY_URL` in `compose.yaml`). A missing variable stops the gateway at start.

## Proxy

`proxy/Caddyfile`: `:8080` locally. `/mcp` goes to `gateway:8080`, `/healthz` is answered by Caddy, everything else is 404. In production, replace `:8080` with the site address for automatic HTTPS. The proxy is the only service with a published port, bound to `127.0.0.1` locally.

## Networks

See the zone table in [architecture.md](architecture.md). `app`, `exec` and `data` are `internal: true`. Consequences:

- Workers have no route to the internet or to `data`/`postgres`. They reach memory's internal tools (`INTERNAL_TOOLS_URL`) and the secrets broker (`BROKER_URL`) and nothing else.
- Postgres is reachable only from `data`.

## Worker containers

Started through the `SandboxRunner` port: `SandboxContainerRunner` (`services/memory/src/infrastructure/sandbox-container-runner.ts`) asks the Docker adapter of `packages/sandbox` (`docker-runner.ts`) for one container per execution, writes the input as one JSON document on stdin and reads the output as one JSON document on stdout, at most 1 MiB on stdout and on stderr (beyond, `WORKER_OUTPUT_INVALID` and the container is removed). The container is named `aos-sandbox-<uuid>`; stopping it kills the client's process group and runs `docker rm -f` on that name:

```
docker run --rm -i --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL
  --security-opt no-new-privileges --user 10001:10001 --network architect-os_exec
  --memory 512m --pids-limit 128 --env INTERNAL_TOOLS_URL=... --env ANTHROPIC_BASE_URL=... <image>
```

Image (`services/memory/worker/Dockerfile`): Node 26, non-root uid 10001, no login shell, production dependencies only, and the system prompts copied to `dist/worker/prompts`. The only writable path is the `/tmp` tmpfs; the agent runs with `persistSession: false` and no setting sources, so nothing else is written. The container is named after the run (`agentic-worker-<run_id>`). The timeout is enforced by the runner: it kills the docker client, runs `docker rm -f` on the named container and answers `WORKER_TIMEOUT`; turn and budget limits are passed to the agent.

Local limitation: `memory` mounts the Docker socket to launch workers. That is root-equivalent on the host and is acceptable only on a developer machine. Production replaces the adapter (see ADR 4 in [design.md](design.md)).

## Secrets broker

Rule: no secret ever enters a worker container. The worker is given `ANTHROPIC_BASE_URL` pointing at the broker and a task token as its API key. `modules/broker` (brick 1b.2, `docs/design/platform-v3-srt.md` §2) is that broker: one listener on `127.0.0.1`, port fixed in `modules/broker/broker.json`; the API key in a file only its owner reads (0600, refused otherwise, at start and at each request); task tokens granted and revoked by the gateway with the MCP tools `token_grant` and `token_revoke` on the broker's stdio; only `POST /v1/messages` (and `count_tokens`) to `api.anthropic.com`, the key in `x-api-key`, the body unchanged and admitted by the request policy of 1a.0; one usage record per answer (task, parent, model, tokens, never content) sent to the gateway as `notifications/message`, logger `usage`. Not yet launched by the gateway (brick 1b.4): `compose.yaml` still wires `BROKER_URL`, and workers in compose cannot call Anthropic; tests use a scripted agent. The real call with a test key (T-04R) is `.github/workflows/broker-live.yml`, run on `main` only (push touching the broker, weekly schedule, manual dispatch; never a pull request): `gate.yml` holds no secret. The owner creates, once, the GitHub environment `broker-live` with a deployment branch policy that allows `main` only, and in it the secret `ANTHROPIC_TEST_KEY`, a test key of a workspace with a low spend limit. The workflow writes it to a 0600 file of the runner, runs `npm run broker:live` and removes the file; `features/descriptive/workflows.feature` refuses any copy of the workflow that widens its triggers, permissions or secrets, and any other workflow that names the environment or the secret. Locally, the same run is `ANTHROPIC_TEST_KEY_FILE=<0600 file> npm run broker:live`. Other secrets: `GATEWAY_TOKENS` (local development only, token table adapter) and `POSTGRES_PASSWORD` come from the git-ignored local env file or the platform secret store; only `data` and `postgres` receive the database password.

## Postgres, pgvector and migrations

- Image `pgvector/pgvector:pg17`. The data volume is `postgres-data`.
- `data/migrations/NNNN_name.sql`, applied in order, once each, inside a transaction, recorded in `schema_migrations` (`data/src/infrastructure/migrate.ts`). The `data` service applies pending migrations at start.
  - `0001_runs.sql`: registry of executions (`runs`, `run_events`).
  - `0002_memory.sql`: `CREATE EXTENSION vector`, schema `memory`, table `memory.memories` with `embedding vector(384)` and an HNSW cosine index. The dimension must equal `EMBEDDING_DIMENSION` in `packages/contracts/src/data-ops.ts`, which rejects any other length at the API.
  - `0003_runs_immutable.sql`: a trigger refuses any update of a completed run (SQLSTATE 55000, reported as `INVALID_OPERATION`).
- Never edit an applied migration: add a new numbered file.
- Operations: `data/sql/<op>.sql`, listed in `data/sql/operations.json` with their parameters (the SQL of each writes exactly the tables its operation declares in `DATA_OPS.writes`), the SQLSTATEs that mean a named failure (23503 unknown run: `NOT_FOUND`; 55000: `INVALID_OPERATION`) and the shape of the answer. The data image ships `sql/` and `migrations/` (the root Dockerfile copies `data/`).
- Without `DATABASE_URL`, `data` starts with the in-memory store (non-persistent, development only).

## CI

`.github/workflows/gate.yml`: the CI gate (`npm run gate`, docs/design/platform-v3-srt.md §7) on pull requests and pushes to `main`, in two jobs required by the ruleset on `main`: `gate-linux` (the whole suite, with Postgres) and `gate-macos` (`features/sandbox/` only), with `contents: read` and `actions: read`. Typecheck, format and the architecture guard are scenarios of the suite. `claude.yml` and `claude-code-review.yml` are copied from `anthropics/claude-code-action` examples (provenance in the PR that added them); the Claude review reads `CLAUDE.md` and does not run the tests, which is why the gate runs next to it.
