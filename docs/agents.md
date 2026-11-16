# Agents

Two kinds of agents exist in this repository: worker agents that serve users at run time, and review subagents that serve maintainers at pull request time.

## Worker agents

A worker agent is a Claude Agent SDK `query()`, created per execution by `services/<name>/worker`, with no state between runs. There are two, one per realisation of the platform ([architecture.md](architecture.md)): the worker of the native path, in a sandbox, and the worker of the first realisation, in a container image of its own.

### The worker of the native path (`services/memory/worker/task-serve.ts`)

| Aspect       | Value                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role         | Serve one task of an agent tool (`recall`, `remember`), then end. One sandbox per task, stopped with the task.                                                                                                                 |
| Entry point  | `task-serve.ts`, given the task profile as its argument. The gateway is on its stdin and stdout: the worker is the MCP client, with the tools `task_input`, `call` and `task_complete` (`infrastructure/platform-channel.ts`). |
| Task profile | `agents/<name>.md`, in the format of Claude Code: a frontmatter (`name`, `description`, `tools`, `model`) checked against `AgentFileSchema`, then the system prompt. Refused whole when it is outside its schema.              |
| Tools        | The tools the profile lists, and they can only be MCP tools: the schema refuses any other name. They are served by one in-process MCP server and relayed to the gateway, which routes them. No built-in tool is offered.       |
| Isolation    | The profile `worker` of `packages/sandbox/profiles`: one port, the broker; the token of the task as its only credential; its own folders. Under srt, or in a container before a rootless daemon.                               |
| Limits       | `maxTurns`, sent by the gateway with the task. No budget in dollars (design, decision 11): the gateway bounds a task by its calls and its deadline.                                                                            |
| Output       | `outputFormat` with the JSON schema of the tool's data, generated from `packages/contracts`. The gateway validates what the worker gives; the worker does not decide trust.                                                    |
| Failure      | A named code. When the Claude Code process itself fails, the message quotes the end of its error output, where the cause is (`infrastructure/sdk-task-agent.ts`).                                                              |
| Secrets      | None. `ANTHROPIC_BASE_URL` is the broker on the loopback; `ANTHROPIC_API_KEY` is the token of the task, which the broker revokes when the task ends.                                                                           |

Proven with the real Claude Code binary against a fake model: `features/integration/agent-worker.feature`; end to end through the entry file of the gateway: `features/sandbox/gateway-entry.feature`, `rootless/gateway-entry.feature`.

### The worker of the first realisation (`services/memory/worker/main.ts`)

| Aspect         | Value                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role           | Answer `recall` (ground a summary in stored memories) and perform `remember` (store one memory).                                                                                                                                                                                                 |
| Entry point    | `main.ts`: reads one `WorkerInput` JSON on stdin, writes one `WorkerOutput` JSON on stdout, exit code 0 (result written) or 2 (input unusable).                                                                                                                                                  |
| Core           | `run-worker.ts`: pure with respect to I/O; takes an `AgentPort`, `InternalTools` and the prompts. `sdk-agent.ts` is the only file importing the SDK.                                                                                                                                             |
| System prompt  | `prompts/<tool>.md`, one file per intent tool, loaded by `prompts.ts` at start (a missing or empty file stops the worker). The image copies `prompts/` next to `dist/worker`.                                                                                                                    |
| Internal tools | The entries of `INTERNAL_TOOLS` owned by `memory` (`memory_search`, `memory_insert`), exposed to the agent as an in-process SDK MCP server (`createSdkMcpServer`, `tool`) by one loop. They call `InternalTools`, whose HTTP adapter posts to memory's `/internal/<tool>` on the `exec` network. |
| Built-in tools | None: `tools: []`, `allowedTools` lists the internal tools, `permissionMode: 'dontAsk'`, `settingSources: []`, `strictMcpConfig: true`, `persistSession: false`. These stay in code: they are the security floor, not behaviour.                                                                 |
| Limits         | Turns (`maxTurns`, default 8), cost (`maxBudgetUsd`, default 0.5), wall time (runner timeout, default 120 s). Defaults live in `services/memory/src/main.ts` only; the service always sends turns and budget in `WorkerInput.limits` (required).                                                 |
| Output schema  | Passed to the SDK as `outputFormat: { type: 'json_schema', schema }`, generated from the tool's data schema in `packages/contracts` (`RecallDataSchema`, `RememberDataSchema`).                                                                                                                  |
| Validation     | The worker does not decide trust. The service parses stdout with `WorkerOutputSchema` then validates `data` with the tool schema; a violation is `WORKER_OUTPUT_INVALID` and the run is recorded as failed.                                                                                      |
| Cost           | `total_cost_usd` and `usage` from the SDK result message become `Result.cost`.                                                                                                                                                                                                                   |
| Secrets        | None in the container. `ANTHROPIC_BASE_URL` targets the secrets broker.                                                                                                                                                                                                                          |

Why the prompt is a plain `.md` read by the worker rather than a `.claude/agents/<tool>.md` subagent file loaded by the SDK: the documented loading path needs `settingSources: ['project']`, which also loads `CLAUDE.md` files from `cwd` and its parents and the project `settings.json` with its hooks (code.claude.com/docs/en/agent-sdk/claude-code-features, table "What it loads"), and the same page recommends `settingSources: []` for multi-tenant isolation. The worker keeps `settingSources: []` and passes the file body as `systemPrompt` (a `string`, per `Options.systemPrompt` in `sdk.d.ts`).

SDK facts used (checked in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`): `query`, `tool`, `createSdkMcpServer`, `Options.tools`, `Options.allowedTools`, `Options.maxTurns`, `Options.maxBudgetUsd`, `Options.outputFormat`, `Options.permissionMode`, `Options.settingSources`, `Options.persistSession`, `Options.strictMcpConfig`, `Options.env`, and the `result` message (`subtype`, `structured_output`, `total_cost_usd`, `usage`).

Not covered by the default test suite: a live run of `sdk-agent.ts` against Anthropic (it needs the broker and a key). Tests inject a scripted `AgentPort`.

### Adding a worker agent for a new service

1. Define the tool schemas in `packages/contracts` (and add the tool to `TOOLS` with its owner), and write `services/<name>/worker/prompts/<tool>.md`.
2. Create `services/<name>/` with the same layers and a `worker/` directory.
3. Give the agent only the internal tools it needs (entries of `INTERNAL_TOOLS` with its owner); keep the built-in tools off.
4. Register tests per [testing.md](testing.md) and add the service to `compose.yaml` and `features/infra/compose.feature`.

## Review subagents (`.claude/agents/`)

Format per the Claude Code subagent documentation: Markdown with YAML frontmatter (`name`, `description`, `tools`, `model`) and the system prompt as body. They are read-only reviewers used by `/review-pr` and by the Claude review workflow.

| Subagent                | Checks                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `architecture-reviewer` | Layers, component boundaries, composition root, guard integrity (`npm run arch`).                       |
| `test-reviewer`         | Every brick has unit tests per layer, port contract tests, an end-to-end case when on the call path.    |
| `security-reviewer`     | Secrets, worker and network isolation, database access outside `data`, gateway auth path, supply chain. |

`/review-pr` (`.claude/commands/review-pr.md`) is modelled on the command of the same name in `anthropics/claude-code-action`: it delegates to the three subagents, keeps only noteworthy feedback and posts inline comments. `CLAUDE.md` ("What the review must refuse") is the bar they apply.
