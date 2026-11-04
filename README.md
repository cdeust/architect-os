# architect-os

A four-tier MCP system. Clients call one intent tool on a single gateway; the owning service runs a sandboxed Claude Agent SDK worker and answers with a validated `Result`. Data access lives in one typed component.

```
client --> proxy --> gateway --> services/memory --> worker (container)
                                        |
                                        +--> data --> postgres + pgvector
```

| Path                  | Role                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `proxy/`              | Caddyfile; the only exposed component (`/mcp`, `/healthz`).            |
| `gateway/`            | Single MCP server for clients: auth, catalogue, routing, quota, audit. |
| `services/memory/`    | Intent tools `recall` and `remember`; `worker/` is the agent image.    |
| `data/`               | The only component that imports `pg`; typed operations from `sql/`.    |
| `packages/contracts/` | `Result<T>`, `Run`, `RunEvent`, zod tool schemas.                      |
| `docs/`               | Architecture, infrastructure, design decisions, agents, testing.       |

The architecture is enforced, not just described: `npm run arch` fails on a wrong layer import, a cross-component import, `pg` outside `data/src/infrastructure`, the agent SDK outside a worker, the MCP SDK outside presentation/infrastructure, or a cycle.

## Cost baseline: 180 measured sessions

What does a coding session cost depending on how Claude Code is launched, and what does isolation cost? Three configurations, with the same model (`claude-sonnet-5-5`), Claude Code version (2.1.318), prompt, permission mode and single allowed command:

- **host**: Claude Code as the owner uses it every day, with plugins, MCP servers, hooks and memory;
- **host-bare**: the same Claude Code with `--bare`, every input explicit, no sandbox;
- **srt**: the code tool of this repository (`packages/sandbox`): `--bare` inside the srt sandbox, the model reached through a local proxy that alone holds the credential.

Twenty tasks on six public repositories of the owner (Python and TypeScript). Each injects a one-line defect into a disposable copy of a pinned commit and asks to make the named tests pass again without touching them; the check is verified to pass at the commit and fail with the defect before every session, and runs again on the host after it. Three repetitions per task and configuration. Cost is `total_cost_usd` of `claude -p --output-format json`, at public prices. The target repositories are never pushed; their branches and tags are compared before and after.

| Configuration | Solved  | Mean cost per session | Mean input tokens |
| ------------- | ------- | --------------------- | ----------------- |
| host          | 60 / 60 | $0.192                | 169,300           |
| host-bare     | 60 / 60 | $0.028                | 31,900            |
| srt           | 60 / 60 | $0.032                | 41,600            |

Cost ratios paired by task, mean and 95 % interval (bootstrap over the 20 tasks): host-bare / host **0.146** (0.123 to 0.173); srt / host **0.166** (0.131 to 0.212), about 83 % less; srt / host-bare **1.108** (1.021 to 1.213), about 11 % more. Every session solved its task without modifying a test.

**The saving does not come from srt.** It comes from the context the usual configuration loads at every session: about 42,000 tokens written to the cache, against 6,000 with `--bare`. Anyone gets it with `--bare`, without a sandbox. **Isolation costs about 11 %**: a little more context and a few more turns, partly because a test that depends on the host's `/tmp` and `HOME` fails inside the sandbox and the agent spends turns on it. **Limits**: one model and one version; one-line defects with named tests, easier than a real issue; one usual configuration, the owner's, so the saving depends on what a configuration loads; public prices, while the sessions ran on the owner's subscription.

Everything is in `baseline/`: tasks, harness, defect generator, raw data and analysis, and the experiment log with its failures (`docs/design/journal.md`, §22 and §23). The campaign cost $15.11 at public prices.

```bash
npm run baseline:campaign
npm run baseline:analyze -- baseline/results/campaign-<date>.jsonl
```

## Quick start

Requires Node 26 LTS (`.nvmrc`) and npm.

```bash
nvm use            # or any Node 26
npm ci
npm run check      # every scenario: typecheck, prettier, tests, architecture guard
```

The end-to-end test (`features/integration/end-to-end.feature`) runs a `recall` through gateway, memory, worker and data in one process, with a scripted agent and no network.

## Local stack

```bash
cp .env.example .env           # fill the placeholders
docker compose build
docker compose --profile build-only build memory-worker
docker compose up
curl http://127.0.0.1:8080/healthz
```

Workers need the secrets broker to reach Anthropic; it is not part of this skeleton (see `docs/infrastructure.md`).

## Working with Claude

`CLAUDE.md` holds the commands, boundaries and the "what the review must refuse" list. `.claude/agents/` has three review subagents, `.claude/commands/review-pr.md` runs them, and `.github/workflows/` runs Claude on `@claude` mentions and on pull requests (workflows from `anthropics/claude-code-action`).

## Documentation

[Architecture](docs/architecture.md) | [Infrastructure](docs/infrastructure.md) | [Design decisions](docs/design.md) | [Agents](docs/agents.md) | [Testing](docs/testing.md) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md) | [Changelog](CHANGELOG.md)

## License

MIT, see [LICENSE](LICENSE).
