# Architecture

One architecture: one process, which isolates what it runs. The gateway launches; a module, memory for one, is a data brick that launches nothing. A first realisation, one container per component behind a proxy, was removed (design, decision 21): its memory service owned the intent tools and launched its own workers through the socket of the Docker daemon.

## The platform

```
client --> gateway --> module (sandbox, MCP on stdio)       a data tool
               \--> worker (sandbox, one per task) --> broker --> api.anthropic.com
               \--> data (child, MCP on stdio) --> postgres + pgvector, or a store in memory
```

One process tree, started by `./aos -- node gateway/dist/src/serve.js` with nothing but its configuration.

- The **gateway** authenticates, counts, audits and routes. It runs no agent and touches no data. It serves its clients over HTTP on the loopback only.
- **data** and the **broker** are its two children outside any sandbox, started from a closed list of commands and variables with nothing inherited from the host. `data` alone holds the database URL; the broker alone holds the API key, and gives one token per task.
- A **module** (`modules/memory`) is started in a sandbox at its first call and speaks MCP on its stdio. It reaches one port, a callback of the gateway, through which its data operations pass, refused outside the tables it declares.
- A **worker** (`services/memory/worker/task-serve.ts`) is started in a sandbox once per task and stopped with it. It is the MCP client of the gateway on its own stdio, runs the task profile of `agents/<name>.md`, and reaches one port, the broker, with the token of its task.
- The **means of isolation** is `srt` (`packages/sandbox/src/srt-runner.ts`), driven by the committed profile templates.
- What exists is declared in `topology/`: the catalogue of the tools, the servers of the modules, the client profiles. The topology is loaded whole or refused before any module is launched.

Proven by the entry file, not by a composition written for a test: `features/sandbox/gateway-entry.feature` under real srt on Linux and macOS. No profile escapes its sandbox: `features/sandbox/escape.feature`.

## Define at the host

The local [Define reader](define.md) calls prd-gen over stdio and validates its handoff before emitting planning data.
The only MCP SDK import for this command lives in `tools/define/src/infrastructure/prd-gen.ts`. The host starts the
operator-selected plugin as a private copy of its pinned files, only when their digest equals the one the operator gave, under Node's permission model, to query its existing run. The gateway and sandboxed builders do not participate in the read.

## Plan at the host

The [Plan reader](plan.md) validates Define data, the proposed acceptance coverage and the independent Step policy.
Its preview binds those inputs and the prospective files to one digest. A matching operator decision enables
materialization into a fresh intake folder outside Git checkouts. Step still owns sessions, checks and the `steps/` archive.

## Layers inside a component

```
presentation  ->  application  ->  domain  <-  infrastructure
  (MCP/HTTP)      (use cases)     (entities,    (adapters: pg, MCP client,
                                   ports)        srt, in-memory)
src/main.ts: the composition root, the only place objects are built
```

- `domain` imports only `domain` and `@architect-os/contracts`.
- `application` imports `domain`. `infrastructure` imports `domain` and `application`. `presentation` imports `application`.
- Dependencies are injected by constructor. There is no service locator and no global singleton.
- Every port has a real adapter and an in-memory adapter; the in-memory ones make the whole system runnable in a single test process.
- Components never import each other. They call each other by MCP on the stdio of a child, or over the loopback.

The rules are enforced by `./aos -- npm run arch` (`.dependency-cruiser.cjs`) and proved by `features/arch/guard.feature`, which writes temporary violating files and checks the guard turns red.

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
