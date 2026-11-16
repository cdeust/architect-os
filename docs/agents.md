# Agents

Two kinds of agents exist in this repository: worker agents that serve users at run time, and review subagents that serve maintainers at pull request time.

## Worker agents

A worker agent is a Claude Agent SDK `query()`, created per execution by `services/<name>/worker`, with no state between runs. There is one: the worker of a task, in a sandbox, started and stopped by the gateway ([architecture.md](architecture.md)).

### The worker of a task (`services/memory/worker/task-serve.ts`)

| Aspect       | Value                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role         | Serve one task of an agent tool (`recall`, `remember`), then end. One sandbox per task, stopped with the task.                                                                                                                 |
| Entry point  | `task-serve.ts`, given the task profile as its argument. The gateway is on its stdin and stdout: the worker is the MCP client, with the tools `task_input`, `call` and `task_complete` (`infrastructure/platform-channel.ts`). |
| Task profile | `agents/<name>.md`, in the format of Claude Code: a frontmatter (`name`, `description`, `tools`, `model`) checked against `AgentFileSchema`, then the system prompt. Refused whole when it is outside its schema.              |
| Tools        | The tools the profile lists, and they can only be MCP tools: the schema refuses any other name. They are served by one in-process MCP server and relayed to the gateway, which routes them. No built-in tool is offered.       |
| Isolation    | The profile `worker` of `packages/sandbox/profiles`: one port, the broker; the token of the task as its only credential; its own folders. Under srt.                                                                           |
| Limits       | `maxTurns`, sent by the gateway with the task. No budget in dollars (design, decision 11): the gateway bounds a task by its calls and its deadline.                                                                            |
| Output       | `outputFormat` with the JSON schema of the tool's data, generated from `packages/contracts`. The gateway validates what the worker gives; the worker does not decide trust.                                                    |
| Failure      | A named code. When the Claude Code process itself fails, the message quotes the end of its error output, where the cause is (`infrastructure/sdk-task-agent.ts`).                                                              |
| Secrets      | None. `ANTHROPIC_BASE_URL` is the broker on the loopback; `ANTHROPIC_API_KEY` is the token of the task, which the broker revokes when the task ends.                                                                           |

Proven with the real Claude Code binary against a fake model: `features/integration/agent-worker.feature`; end to end through the entry file of the gateway: `features/sandbox/gateway-entry.feature`.

### Adding an agent

An agent is declared, not coded: the worker is the same for every agent.

1. Write its task profile, `agents/<name>.md`: its prompt, the tools of the platform it may call, its bounds.
2. Declare its tools in `topology/catalog.json`, with their input and output schemas; the topology is loaded whole or refused before anything is launched.
3. Add its scenarios per [testing.md](testing.md): the tool end to end through the entry file of the gateway, with the real Claude Code binary against a fake model.

## Review subagents (`.claude/agents/`)

Format per the Claude Code subagent documentation: Markdown with YAML frontmatter (`name`, `description`, `tools`, `model`) and the system prompt as body. They are read-only reviewers used by `/review-pr` and by the Claude review workflow.

| Subagent                | Checks                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `architecture-reviewer` | Layers, component boundaries, composition root, guard integrity (`npm run arch`).                       |
| `test-reviewer`         | Every brick has unit tests per layer, port contract tests, an end-to-end case when on the call path.    |
| `security-reviewer`     | Secrets, worker and network isolation, database access outside `data`, gateway auth path, supply chain. |

`/review-pr` (`.claude/commands/review-pr.md`) is modelled on the command of the same name in `anthropics/claude-code-action`: it delegates to the three subagents, keeps only noteworthy feedback and posts inline comments. `CLAUDE.md` ("What the review must refuse") is the bar they apply.
