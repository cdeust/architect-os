# CLAUDE.md

## Commands

```bash
export ARCHITECT_OS_RUNTIME_ROOT='<existing physical root marked by the installer>'
LAUNCHER='<absolute path to the trusted launcher checkout>'
./aos -- npm ci --ignore-scripts  # Install (Node 26 LTS, see .nvmrc; exact versions, lockfile committed)
./aos -- npm test               # tsc -b, then cucumber-js: every scenario of the default profile (unit, port contracts, end to end, typecheck, format, architecture guard)
./aos -- npm run gate           # the CI gate (docs/design/platform-v3-srt.md §7): plan, cucumber, Stryker on the perimeter, verdict
./aos -- npm run gate -- --job macos   # features/sandbox only
./aos -- npm run check          # = npm test. Must be green before every PR.
./aos -- npm run typecheck      # tsc -b, strict (also a scenario)
./aos -- npm run format:check   # prettier --check (npm run format to fix; also a scenario)
./aos -- npm run arch           # dependency-cruiser: layers, boundaries, cycles (also a scenario)
"$LAUNCHER/aos" -- npm --prefix "$LAUNCHER" run review # from a worktree: the read-only reviewer session, prompt from the launcher
"$LAUNCHER/aos" -- npm --prefix "$LAUNCHER" run step -- <folder>  # requires a host-issued ARCHITECT_OS_STEP_EVIDENCE receipt before any builder session (packages/sandbox/README.md)
./aos -- npm run diagram:isolation   # after a build (npm run typecheck): rewrite docs/diagrams/isolation-profiles.svg whole from packages/sandbox/profiles when it differs (features/arch/isolation-diagram.feature requires the file equal to it)
./aos -- npm run evidence -- ask <ledger> <desk> <id> < question.txt  # evidence desk: record a question, publish the skill (tools/evidence/README.md)
./aos -- npm run evidence -- verify <ledger> <desk>                   # evidence desk: verify the answers left in the desk; exit 0, 1 (rejected or deferred), 2 (refused) or 3 (unexpected error)
./aos -- npm run watch -- check [--keep <dir>]                        # the watch of Anthropic: the register against its sources; exit 0, 1 (a source moved), 2 (register refused) or 3 (a source unreadable)
./aos -- npm run watch -- read <id>... [--keep <dir>]                 # the watch of Anthropic: record that these sources were read (docs/claude-code-watch.md)
./aos -- npm run define -- <run_id> <prd-gen-plugin-root>       # read a pending Define v1 handoff over MCP stdio (docs/define.md)
./aos -- npm run plan -- prepare <define> <proposal> <policy>  # preview a Plan bundle, then materialize it after operator approval (docs/plan.md)
./aos -- npm run deliver -- <name> [--until ci]                        # deliver the commit of this worktree (tools/deliver): trial branch, gate, CI for the hash, both branches; exit 0, 1 (stopped at a phase), 2 (refused), 3 (a program failed)
```

For an OpenAI Step, configure the host runtime and archive as described in [the SBX builder guide](packages/sandbox/README.md#codex-in-docker-sbx). The offline native scenarios take a fake upstream and never require a subscription. The owner signs in once at installation using `sbx:sign-in`. Later Steps use the host OS credential store and silently renew the grant. Each VM has a scoped POST route to the Step’s loopback Responses proxy and access to the npm registry. The host verifies the rules before staging and again after the client exits. The live acceptance trial requires the maintainer’s signal.

## What This Is

An MCP platform for agent work. A client calls one tool; the gateway authenticates, counts, audits and routes; an agent tool is served by a sandboxed Claude Agent SDK worker, a data tool by a module; every answer is a validated `Result`. One architecture, one realisation (`docs/architecture.md`).

The platform is one process (`node gateway/dist/src/serve.js`), which isolates what it runs under srt.

```
client -> gateway -> module (sandbox, MCP on stdio)
               \-> worker (sandbox, one per task) -> broker -> api.anthropic.com
               \-> data (child, MCP on stdio) -> postgres (pgvector)
```

| Dir                    | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/edge/`         | An example of an edge in front of the gateway's loopback port (Caddyfile). Nothing in this tree starts it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `gateway/`             | The single MCP server for clients. Auth, tool catalogue, routing per tool, quotas, audit. Nothing else.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `services/memory/`     | The worker of a task: `worker/task-serve.ts`, one sandbox per task, started by the gateway. It runs the task profile of `agents/<name>.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `data/`                | Only component that imports `pg`. Typed operations served from `sql/` by one executor, as MCP tools generated from `DATA_OPS` (`src/serve-mcp.ts`, stdio); migrations.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/contracts/`  | Only shared package: `Result<T>`, `Run`, `RunEvent`, zod schemas of tools and data operations, the evidence desk contract (`evidence.ts`). No logic.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/sandbox/`    | `SandboxRunner` port and its srt adapter; the profile templates; the launcher of the native children; the host auth proxy; the Builder port, pinned Codex client in SBX and host SIWC proxy; `npm run code`, `npm run review` and `npm run step`.                                                                                                                                                                                                                                                                                                                                        |
| `modules/broker/`      | The broker (1b.2): sole holder of the API key, task tokens granted and revoked by MCP on its stdio, one usage record per answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `modules/memory/`      | The module of the memory domain on the native path: its data tools, served as MCP on its stdio, in a sandbox.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `agents/`, `topology/` | Descriptive files of the native path: the task profiles (`agents/<name>.md`), and the catalogue of the tools, the servers of the modules and the client profiles.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tools/test-gate/`     | The CI gate (`npm run gate`). Layers `domain`, `infrastructure`, composition root `src/main.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tools/evidence/`      | The evidence desk (`npm run evidence`): questions for a librarian (Claude Science, or a session under srt), answers verified on the host against the DOI registry. Layers `domain`, `application`, `infrastructure`, composition root `src/main.ts`, entry `src/cli.ts`, the skill in `skill/`.                                                                                                                                                                                                                                                                                          |
| `tools/watch/`         | The watch of Anthropic (`npm run watch`): a committed register of sources, `watch.json`, compared with what is published; it prints ids, versions, addresses and counts, never the text it read. Layers `domain`, `application`, `infrastructure`, composition root `src/main.ts`, entry `src/cli.ts`.                                                                                                                                                                                                                                                                                   |
| `steps/`               | What each step of the loop saw, written by the host at its end and committed with the code: `steps/<name>/brief.md`, `step.json`, the scout questions and `record.json` (the tree, a hash of each input and of the launcher files, costs, verdicts). Never edited by hand: the gate reads it (`features/descriptive/steps.feature`), and the builder profile cannot write it.                                                                                                                                                                                                            |
| `tools/deliver/`       | The delivery of a commit (`npm run deliver`; design: `docs/design/orchestration-fable-5-2.md` §14): its decisions and its six phases, bound to one commit hash, over six ports (`Repository`, `Forge`, `Gate`, `Clock`, `DeliveryLog`, `Progress`), each with a contract, an in-memory double and a real adapter (git, the GitHub client, the gate as a child process, a timer, a log file, a stream). Programs are started through `src/infrastructure/host-process.ts` alone. Layers `domain`, `application`, `infrastructure`, composition root `src/main.ts`, entry `src/cli.ts`.    |
| `tools/runtime/`       | The admission of a run, `./aos -- PROGRAM [ARG ...]`, required before repository commands (design: loop §14): a root marked by its installer with an environment, the floors of `tools/runtime/admission.json`, a run with its receipt, its locations given to the command. `aos` (sh) runs `src/cli.ts` with plain Node before any install: built-ins only, modules through `#runtime/*` (`package.json` `imports`). Port `RuntimeFilesystem`, two adapters. Layers `domain`, `application`, `infrastructure`, composition root `src/main.ts`, entries `src/cli.ts`, `src/npm-names.ts` |
| `features/`            | End-to-end and cross-cutting scenarios (`integration`, `arch`, `descriptive`, `infra`, `repository`, `sandbox`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `bench/`               | Outside production: nothing in production imports it, the gate neither counts nor mutates it (DC-8). No dependency-cruiser rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Details: `docs/architecture.md`, `docs/infrastructure.md`, `docs/design.md`, `docs/agents.md`, `docs/testing.md`.

## Layers (gateway, services/_, modules/_, data)

Each component has `src/domain`, `src/application`, `src/infrastructure`, `src/presentation`, `features/`, and one composition root `src/main.ts`.

- `domain` imports only `domain` and `@architect-os/contracts`. It holds entities and **ports** (interfaces).
- `application` imports `domain`. Use cases, constructor-injected ports.
- `infrastructure` imports `domain` and `application`. **Adapters**, with an in-memory adapter for every port.
- `presentation` imports `application`. MCP or HTTP translation only.
- `src/main.ts` is the only place that builds objects. No service locator, no global singleton, nothing imports `main.ts` but its tests and, where there is one, the process entry `src/serve.ts`, which only hands it `process.env` and `process.stderr` and sets the exit code.
- No import between components. They talk by MCP on the stdio of a child, or over the loopback; the only shared code is `@architect-os/contracts`.

## Descriptive files before code

A behaviour that a descriptive file can express is not written in code. Code is reserved for what a file cannot carry: protocol translation (MCP, HTTP), process control, validation against a schema, security floors (tool allow-lists, isolation flags, secrets), and one generic loader or executor per kind of file.

| Behaviour                                                                                           | Descriptive file                                                              | Read by                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| Data operation (SQL)                                                                                | `data/sql/<op>.sql` + one row in `data/sql/operations.json`                   | `data/src/infrastructure/sql-store.ts`               |
| Database invariant                                                                                  | `data/migrations/<NNNN>_<name>.sql` (constraint, trigger)                     | `data/src/infrastructure/migrate.ts`                 |
| Task profile of an agent: prompt, tools, model                                                      | `agents/<name>.md`                                                            | `services/memory/worker/agent-file.ts`               |
| Catalogue of the tools, servers of the modules, client profiles                                     | `topology/catalog.json`, `topology/modules.mcp.json`, `topology/clients.json` | `gateway/src/infrastructure/topology-files.ts`       |
| Intent tool, internal tool, data op                                                                 | declarative zod tables in `packages/contracts` (single source)                | generic loops in gateway, services, worker           |
| What the platform holds of Anthropic, and what was read of it                                       | `tools/watch/watch.json`, `tools/watch/indexes/<id>.txt`                      | `tools/watch/src/application/load.ts`                |
| How a commit is delivered: remote, branches, trial prefix, required jobs, append-only files, bounds | `tools/deliver/deliver.json`                                                  | `tools/deliver/src/infrastructure/deliver-schema.ts` |
| The free-space floors of each environment a runtime root may be marked with, their provenance       | `tools/runtime/admission.json`                                                | `tools/runtime/src/infrastructure/policy-file.ts`    |
| Where the admission takes its host Node from: installer and runner locations, in order              | `tools/runtime/node-locations`                                                | `aos`                                                |
| Review agents and commands                                                                          | `.claude/agents/*.md`, `.claude/commands/*.md`                                | Claude Code                                          |

Every descriptive file has a scenario that loads the committed file, checks it against its schema, and shows that a broken copy is rejected; a broken file makes `npm run check` red.

## Hard boundaries (enforced by `npm run arch`)

- `pg` only in `data/src/infrastructure`. SQL only in `data/sql/` and `data/migrations/`, executed only by `data/src/infrastructure`. No DB access anywhere else. Data exposes typed operations, never free-form SQL.
- `@anthropic-ai/claude-agent-sdk` only in `services/*/worker`.
- `@modelcontextprotocol/sdk` only in `presentation` and `infrastructure` of `gateway`, `services/*`, `modules/*` and `data`, and in their `features/` (step definitions).
- `node:child_process` only in `packages/sandbox`, the `SandboxRunner` port through which every process is launched (component infrastructure may import it), with three named exceptions in `.dependency-cruiser.cjs`: `tools/test-gate/src/infrastructure/git.ts` (the one file through which the gate runs git), `tools/test-gate/src/infrastructure/replay.ts` (the one through which it replays mutation verdicts) and `tools/deliver/src/infrastructure/host-process.ts` (the one through which the delivery command starts git, the client of the forge and the gate, on the host). `@anthropic-ai/sandbox-runtime` only in `packages/sandbox`, no exception.
- The host-side Define reader launches the operator-installed prd-gen plugin through the MCP SDK. `tools/define/src/infrastructure/prd-gen.ts` is the only file of that command permitted to import the SDK, and it uses fixed launcher paths. The direct `node:child_process` rule still applies.
- The host starts git, and the client of the forge, with a closed list of environment variables taken from the host by name, plus what the caller sets itself, and with the options that stop git from starting a file monitor or a hook: never with `process.env`, whole or spread. The fingerprint of a tree and the gate read no global nor system configuration of git (`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` set to an empty file, no `HOME` in their list): a fingerprint and a verdict do not depend on the machine. The delivery alone keeps the host's configuration, where the helper that identifies it to the forge lives (`packages/sandbox/src/tree-fingerprint.ts`, `tools/test-gate/src/infrastructure/git.ts`, `tools/deliver/src/infrastructure/host-process.ts`; the list of the delivery is the key `environment` of `tools/deliver/deliver.json`, taken from a closed set). `features/arch/closed-git-environment-text.feature` refuses a copy that gives `process.env` back, and the suite removes the `GIT_` variables of its own environment when it loads (`features/support/git-environment.ts`).
- No import cycles.
- The gateway contains no business logic: the gateway runs no agent, and reaches data only through its typed operations: to write the registry (tasks, usage) and to forward the data operations of a module, refused outside its `writes_tables` (docs/design/platform-v3-srt.md, §2).

## Adding a brick

Every new brick (tool, port, adapter, component, worker) arrives with its tests and passes `npm run check`:

Tests are Gherkin scenarios (`@cucumber/cucumber`; steps in TypeScript, step text unique across the repository):

1. Unit scenarios per layer it touches, in `<component>/features/` (steps in `<component>/features/steps/`).
2. A contract for each port it defines: a `Scenario Outline` with one `Examples` row per adapter, the in-memory one included.
3. If it is on the path of a call, an end-to-end scenario in `features/integration/` (client -> gateway -> module or worker -> data in memory, through the entry file of the gateway).
4. If it adds a boundary, a rule in `.dependency-cruiser.cjs` and a fixture scenario row in `features/arch/`.
5. If it adds a descriptive file, a load-and-schema scenario with a rejected broken copy.
6. A changed production line has 0 surviving mutant (the gate, doc §7). An equivalent mutant is marked `// Stryker disable next-line <Mutator>: équivalent: <invariant>`.

Common bricks need no new TypeScript:

- Agent tool: its zod schemas and owner in `TOOLS` (`packages/contracts/src/tools.ts`), its declaration in `topology/catalog.json` and the task profile of its agent, `agents/<name>.md` (`docs/agents.md`, Adding an agent). The gateway catalogue and the gateway route are derived; the worker is the same for every agent.
- Internal tool: one entry in `INTERNAL_TOOLS` (`packages/contracts/src/data-ops.ts`) naming the data operation it is a view of.
- Data operation: its schemas and the tables it writes (`writes`, checked against its SQL when the statement table loads) in `DATA_OPS`, `data/sql/<op>.sql`, a row in `data/sql/operations.json`, and, for the in-memory store, one handler in `data/src/infrastructure/in-memory.ts`. The shared `DataStore` contract runs on both stores.

## Conventions

- TypeScript strict, ESM, `.js` suffix in relative imports. Prettier formats (`npm run format`).
- Dependencies are pinned to exact versions; verify with `npm view <pkg> version`; commit `package-lock.json`. `watch.yml` asks every Monday for the advisories on the locked dependencies (`npm audit`, red from a moderate one); one is fixed in the lockfile, then the gate.
- The Claude Agent SDK (which holds the Claude Code binary) and the sandbox runtime move by `docs/claude-code-watch.md`: the changelog read between the two versions, a decision per entry that applies, one pin at a time. `tools/watch/watch.json` names every source the platform holds of Anthropic (pins, changelogs, documentation indexes, the pages its mechanisms rely on) and what was read of it; the workflow `watch.yml` is red when one moved since.
- Never invent an SDK API: read the published `.d.ts` under `node_modules/<pkg>` and cite the file in the comment.
- Failures are values: a tool call returns `Result` with `status: 'failed'` and a named `error.code`; do not throw across a service boundary.
- Secrets go through the secrets broker only (brick 1a.0: the host auth proxy of `packages/sandbox` alone holds the owner's Claude credential; the sandbox gets a session token. Brick 1b.2: `modules/broker` alone holds the API key, in a 0600 file; a worker gets a task token). `gate.yml` holds no secret: the real call of the broker (T-04R) is `.github/workflows/broker-live.yml`, on `main` only, and it stores no credential either: it exchanges the identity token of its run for a short-lived access token, under a rule the owner created at Anthropic; the four identifiers of that rule give no access and sit in the secret store only so that the public log of a run masks them (`docs/infrastructure.md`). Never put an API key, token or password in a worker container, an image, the repository, a log or a test.
- The incremental Linux mutation proof uses `test-gate inventory --job linux` and `test-gate inventory-check --job linux`. The verifier expects the native whole-file report for those lots. The hosted Gate still uses line ranges and its existing replay. See [the mutation contract](docs/design/platform-v3-srt.md#7-porte-de-ci).
- Never compare a branch to `main` (no merge-base, no branch tip comparison, no update-branch) in CI, scripts or tools. Review the PR diff as GitHub presents it. One written exception: the gate (`tools/test-gate`) diffs the working tree against the first parent `HEAD^1` (in a PR, the first parent of GitHub's merge commit, i.e. the PR diff as GitHub presents it; on `main`, the previous commit) to derive added and removed pickles, the changed lines and the `.feature` diff. No merge-base, no branch tip, no update-branch.
- Commits: imperative subject, no attribution trailer.

## What the review must refuse

Request changes on a PR that has any of these:

- A brick without tests (see "Adding a brick"), or a port without a contract test, or a path-of-call change without an end-to-end case.
- An import that violates the guard, or a change that weakens `.dependency-cruiser.cjs` or removes a guard fixture.
- Any database access (`pg`, SQL strings) outside `data/` (`sql/`, `migrations/`, `src/infrastructure`), or a data operation that accepts free-form SQL.
- Business logic in `gateway/` (anything beyond auth, catalogue, routing, quota, audit).
- Agent execution outside `services/*/worker`, or a worker that gets a secret or a route to `data`/`postgres`.
- A Result path that throws instead of returning a named failure, or worker output used without schema validation.
- Behaviour written in code where a descriptive file can express it (see "Descriptive files before code"), or a descriptive file without its load-and-schema scenario.
- A branch-to-`main` comparison in CI or tooling, an unpinned dependency (`^`, `~`, `latest`), or a lockfile out of sync.
- A `tags`, `name` or `retry` option in `cucumber.mjs`, a skipped, pending or undefined step, or a computed `Examples` table.
- A `Stryker disable` that lacks the justified form `// Stryker disable next-line <Mutator>: équivalent: <invariant>`.
- A change to `tools/test-gate` or `.github/workflows/gate.yml` that the PR does not explain (R-6).
- Docs (`docs/`, this file) left stale by a change that alters architecture, boundaries or commands.
- A change that adds or changes an element of the system and leaves its diagram (`docs/diagrams/`) or the text of the README that describes it as they were. The table of bricks (`docs/bricks.md`) and the count of the suite are not enough.
- A change that builds a point marked `next` and leaves the mark, in the README or in a diagram, or that records a decision of design without building it and leaves it out of the roadmap of the README (« What comes next ») and of the diagram it belongs to.

Reviewers: use `/review-pr` (`.claude/commands/review-pr.md`); it delegates to `architecture-reviewer`, `test-reviewer` and `security-reviewer` in `.claude/agents/`.
