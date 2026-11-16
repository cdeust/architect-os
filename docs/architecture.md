# Architecture

One architecture, two realisations in this tree. The **native path** is the one the platform is built on: one process, which isolates what it runs. The **first realisation** puts each component in a container behind a proxy; it stays, and its stack is started in CI. Both share the contracts, the layers inside a component, the `Result` envelope and the rules below; they differ in how components reach each other and in how an agent is isolated. The design of the native path, its threat model and its bricks are in [design/platform-v3-srt.md](design/platform-v3-srt.md); how to run it on a host is in [operating.md](operating.md).

## The native path

```
client --> gateway --> module (sandbox, MCP on stdio)       a data tool
               \--> worker (sandbox, one per task) --> broker --> api.anthropic.com
               \--> data (child, MCP on stdio) --> postgres + pgvector, or a store in memory
```

One process tree, started by `node gateway/dist/src/serve.js` with nothing but its configuration.

- The **gateway** authenticates, counts, audits and routes. It runs no agent and touches no data. It serves its clients over HTTP on the loopback only.
- **data** and the **broker** are its two children outside any sandbox, started from a closed list of commands and variables with nothing inherited from the host. `data` alone holds the database URL; the broker alone holds the API key, and gives one token per task.
- A **module** (`modules/memory`) is started in a sandbox at its first call and speaks MCP on its stdio. It reaches one port, a callback of the gateway, through which its data operations pass, refused outside the tables it declares.
- A **worker** (`services/memory/worker/task-serve.ts`) is started in a sandbox once per task and stopped with it. It is the MCP client of the gateway on its own stdio, runs the task profile of `agents/<name>.md`, and reaches one port, the broker, with the token of its task.
- The **means of isolation** is written by the operator and never detected: `srt`, or Docker before a rootless daemon (`packages/sandbox/src/platform-sandboxes.ts`). The same profile templates drive both. Before anything is launched the means is checked; a means that does not confine is a refusal to start.
- What exists is declared in `topology/`: the catalogue of the tools, the servers of the modules, the client profiles. The topology is loaded whole or refused before any module is launched.

Proven by the entry file, not by a composition written for a test: `features/sandbox/gateway-entry.feature` under real srt on Linux and macOS, and `rootless/gateway-entry.feature` with the module and the workers in containers before a real rootless daemon, on x86-64 and arm64. No profile escapes its sandbox: `features/sandbox/escape.feature`, `rootless/escape.feature`.

## The first realisation: one container per component

Four tiers. Each tier has one job and talks only to its neighbour. Decisions and the alternatives we rejected are in [design.md](design.md). What its stack does today, and what it does not, is in [infrastructure.md](infrastructure.md): it starts, serves its catalogue and refuses a call without a token; it runs no agent.

```
                 public            app                          exec            data
client --> [ proxy ] --> [ gateway ] --> [ services/memory ] --> [ worker x N ]
                              |                  |
                              |                  +------------> [ data ] --> [ postgres + pgvector ]
                              |                                    (app + data networks)
                              +-- auth, catalogue, routing, quota, audit (ports)
```

## The four tiers

1. **proxy** (`proxy/Caddyfile`). The only exposed component. Forwards `/mcp` to the gateway and answers `/healthz`. TLS terminates here in production. No logic.
2. **gateway** (`gateway/`). The single MCP server clients see. It lists the tool catalogue, authenticates the caller (port `Authenticator`), applies the quota (port `QuotaPolicy`), routes the call to the service that owns the tool (port `ServiceClient`) and journals it (port `AuditLog`). It runs no agent; it reaches data only through its typed operations, to write the registry (tasks, usage) and to forward the data operations of a module within its `writes_tables`. It forwards the service answer without interpreting it. Brick 1b.4 adds the routing of the tasks (`gateway/src/application/task-router.ts`): a call identifier per call of a module, the bounds of the task (deadline, number of calls, depth) and its end; the modules of `topology/modules.mcp.json` are launched through the `SandboxRunner` and spoken to over MCP on their stdio (`gateway/src/infrastructure/module-host.ts`).
3. **services** (`services/memory/`). One micro-service per domain. Its `src/` is a light internal MCP server exposing intent tools (`recall`, `remember`). For each call it validates the input, creates the run (through data), launches the worker through the `ContainerRunner` port, validates the worker output against the tool schema, records the outcome and answers with a `Result`. Its `worker/` is the image that runs the Claude Agent SDK agent with the service's internal tools.
4. **data** (`data/`). The only component that imports `pg`. It exposes typed operations (`runs.create`, `runs.appendEvent`, `runs.complete`, `runs.get`, `runs.events`, `memory.insert`, `memory.search`, `usage.append`, `usage.aggregate`) over an internal HTTP API and, since brick 1b.3, as MCP tools generated from `DATA_OPS` on the stdio of its parent the gateway (`data/src/serve-mcp.ts`), never free-form SQL. Each operation declares the tables it writes (`writes`); the loader refuses SQL that writes other tables. The usage records of the broker are append-only (`migrations/0004_usage_records.sql`: UPDATE, DELETE and TRUNCATE raise 55000) and summed per task, layer and model by `usage.aggregate`; the gateway forwards them (`gateway/src/application/usage-forwarder.ts`). Each operation is a named SQL file in `data/sql/`, listed with its parameters in `data/sql/operations.json` and run by one generic executor (`SqlDataStore`); input and output are checked against the contract schemas. Versioned SQL lives in `data/migrations/`.

`packages/contracts` is the only shared package: `Result<T>`, `Run`, `RunEvent`, the zod schemas of every intent tool (`TOOLS`), of every data operation (`DATA_OPS`) and of every internal tool (`INTERNAL_TOOLS`), and the worker wire format. It holds no logic. The gateway catalogue and routes, the service tool registration, the internal tool endpoint and the agent's tool list are generic loops over these tables.

## Layers inside a component

```
presentation  ->  application  ->  domain  <-  infrastructure
  (MCP/HTTP)      (use cases)     (entities,    (adapters: pg, MCP client,
                                   ports)        Docker, in-memory)
src/main.ts: the composition root, the only place objects are built
```

- `domain` imports only `domain` and `@architect-os/contracts`.
- `application` imports `domain`. `infrastructure` imports `domain` and `application`. `presentation` imports `application`.
- Dependencies are injected by constructor. There is no service locator and no global singleton.
- Every port has a real adapter and an in-memory adapter; the in-memory ones make the whole system runnable in a single test process.
- Components never import each other. They call each other over the network.

The rules are enforced by `npm run arch` (`.dependency-cruiser.cjs`) and proved by `features/arch/guard.feature`, which writes temporary violating files and checks the guard turns red.

## Network zones

| Zone     | Members                      | Notes                                                                                         |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `public` | proxy                        | The only zone with a published port.                                                          |
| `app`    | proxy, gateway, memory, data | `internal: true`. Service to service traffic.                                                 |
| `exec`   | memory, worker containers    | `internal: true`. Workers reach memory's internal tools and the secrets broker, nothing else. |
| `data`   | data, postgres               | `internal: true`. Workers and the gateway cannot reach the database.                          |

`features/infra/compose.feature` checks these memberships against `compose.yaml`.

## Path of a call (`recall`)

1. The client sends MCP `tools/call recall` to the proxy; the proxy forwards `/mcp` to the gateway.
2. Gateway presentation turns the MCP request into the `CallTool` use case with the bearer token. `CallTool`: lookup in `TOOLS`, `Authenticator`, `QuotaPolicy`, `ServiceClient.invoke('memory', 'recall', args)`, `AuditLog.record` (also on refusal).
3. Memory presentation (`createMemoryServer`) calls `IntentService.handle('recall', args)`:
   1. validate the input against `RecallInputSchema`; on failure answer `INVALID_INPUT` without creating a run;
   2. `RunRegistry.create` and event `run.created` (data: `runs.create`, `runs.appendEvent`);
   3. event `worker.started`; `ContainerRunner.run` starts the worker with the run id, tool, input and limits on stdin;
   4. event `worker.exited`; parse the worker stdout as `WorkerOutput`, then validate `data` against `RecallDataSchema`;
   5. event `output.validated` or `output.invalid`; `runs.complete`; event `run.completed`;
   6. answer with the `Result`.
4. The worker (`services/memory/worker`) runs the agent with the system prompt `prompts/<tool>.md` and the internal tools of `INTERNAL_TOOLS` (`memory_search`, `memory_insert`) as its only tools; these call the memory service's internal endpoint `POST /internal/<tool>` on the `exec` network, which validates the input and runs the data operation the tool names.
5. The gateway returns the service answer to the client unchanged.

`features/integration/end-to-end.feature` runs this whole path in one process: real MCP between client, gateway and memory, an in-process runner executing the real worker core with a scripted agent, and the real data component with in-memory repositories behind its HTTP API.

## The `Result` contract

```ts
type Result<T> = {
  status: 'ok' | 'needs_clarification' | 'failed';
  data: T | null; // null unless status is 'ok'
  evidence: { source: string; ref: string; excerpt?: string }[];
  run_id: string | null; // null only when no run was created (invalid input, data down)
  cost: { input_tokens: number; output_tokens: number; usd: number };
  error?: { code: ErrorCode; message: string }; // present when status is not 'ok'
};
```

- `ok`: `data` validated against the tool's data schema; no `error`.
- `failed`: `error.code` names the cause: `INVALID_INPUT`, `WORKER_UNAVAILABLE`, `WORKER_FAILED`, `WORKER_TIMEOUT`, `WORKER_OUTPUT_INVALID`, `DATA_UNAVAILABLE`, `INTERNAL`.
- `needs_clarification`: the agent needs more input; `error.message` carries the question and `error.code` is `NEEDS_CLARIFICATION`.
- Schemas: `resultSchema(dataSchema)` in `packages/contracts/src/result.ts` declares these invariants.
- Transport-level problems at the gateway (unknown tool, unauthorized, quota, service unavailable) are MCP tool errors with a JSON body `{ code, message }`, because no run exists yet.
