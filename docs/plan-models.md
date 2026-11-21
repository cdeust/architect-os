# Draft a proposal with Claude, GPT or Gemini

After reviewing an accepted Define handoff, an operator can send its requirements and acceptance criteria to one chosen model. Use an approved provider account, a model ID available on that account, an output-token cap and a timeout in milliseconds. Use a new private receipt path on each attempt.

```sh
npm run --silent plan -- draft "$PROVIDER" "$MODEL" delivery define.json draft-01.jsonl "$MAX_OUTPUT_TOKENS" "$TIMEOUT_MS" > proposal.json
npm run --silent plan -- prepare define.json proposal.json policy.json > preview.json
```

| Provider | Credential          | Request                                                                               |
| -------- | ------------------- | ------------------------------------------------------------------------------------- |
| `claude` | `ANTHROPIC_API_KEY` | [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)         |
| `gpt`    | `OPENAI_API_KEY`    | [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create) |
| `gemini` | `GEMINI_API_KEY`    | [Google generateContent](https://ai.google.dev/api/generate-content)                  |

The command sends only the validated handoff, requested Step name and drafting instructions. The API request contains no tools. One attempt makes at most one request to the selected endpoint. A timeout can occur after the provider accepted the request. Before retrying, inspect the receipt and the provider account. The draft must match the requested Step and cover each acceptance ID exactly once. The independent preview and approval still apply.

The receipt binds the requested provider/model, attempt ID, run ID, Define SHA-256, elapsed time, outcome, HTTP status when available and output SHA-256 on success. Tokens and model names come from the response, including when proposal validation refuses the output. Absent fields and unavailable monetary cost are `null`. Token categories follow the provider's API definitions. Cached and reasoning tokens can already be included in provider input/output totals. The model draft is a separate operation from the producer's deterministic checkpoint projections.

## Draft with an Antigravity subscription

Use Antigravity with your personal Google account. In `/config`, set **Use AI Credits** to **Off**. Verify that the CLI shows your personal account on its included quota. Remove `modelProvider` if it selects the Gemini API and check that `userSettings.enableAdc` in `~/.gemini/config/config.json` is absent or false. A Cloud Pay As You Go project, ADC and API keys are separate billing routes. See [Google authentication](https://antigravity.google/docs/cli/install/) and [AI credits](https://antigravity.google/docs/cli/credits/).

Run the exchange from the Architect OS checkout. Set `PLAN_FILES` to an absolute path to a private directory containing `define.json` and `policy.json`, `AGY_WORKSPACE` to an absolute path to a separate empty private directory, `MODEL` to a subscription model slug, and `AGY_TIMEOUT` to a duration accepted by the CLI. Check that no hooks, plugins or MCP servers are enabled for the CLI session before launching it. The example uses [Antigravity headless settings](https://antigravity.google/docs/cli/headless/) and [CLI deny rules](https://antigravity.google/docs/permissions#cli-fine-grained-permissions).

```sh
(
  set -euC
  umask 077
  npm run --silent plan -- agy-request "$MODEL" delivery "$PLAN_FILES/define.json" > "$PLAN_FILES/request.jsonl"
  SCHEMA='{"type":"object","required":["request_sha256","proposal"],"properties":{"request_sha256":{"type":"string"},"proposal":{"type":"object","required":["step","objective","verification","acceptance_ids"],"properties":{"step":{"type":"string"},"objective":{"type":"string"},"verification":{"type":"string"},"acceptance_ids":{"type":"array","items":{"type":"string"}}}}}}'
  SETTINGS='{"modelProvider":"","agentMode":"","useG1Credits":false,"toolPermission":"strict","permissions":{"deny":["read_file(*)","write_file(*)","read_url(*)","execute_url(*)","command(*)","mcp(*)"]}}'
  (
    cd "$AGY_WORKSPACE"
    env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u AGY_ADC_AUTH agy \
      --settings "$SETTINGS" --disable-slash-commands --print-timeout "$AGY_TIMEOUT" \
      --model "$MODEL" --json-schema "$SCHEMA" --input-format stream-json --output-format stream-json \
      < "$PLAN_FILES/request.jsonl" > "$PLAN_FILES/response.jsonl"
  )
  npm run --silent baseline:planning -- "$PLAN_FILES/agy-01.jsonl" agy-result \
    "$MODEL" delivery "$PLAN_FILES/define.json" "$PLAN_FILES/response.jsonl" > "$PLAN_FILES/proposal.json"
  npm run --silent plan -- prepare "$PLAN_FILES/define.json" "$PLAN_FILES/proposal.json" \
    "$PLAN_FILES/policy.json" > "$PLAN_FILES/preview.json"
)
```

The Architect OS commands in this exchange work offline. The shell stops if Antigravity exits unsuccessfully. On quota exhaustion, wait for the subscription quota to renew. Import checks for a successful single-turn stream in strict permission mode, rejects any reported tool or subagent step, and binds the proposal to the requested model, Step and exact Define bytes. The proposal goes through the same preview and approval. The receipt records local import duration and reported external duration and tokens separately, with billing unverified and monetary cost and served model ID unavailable. The stream supplies consistency checks. The operator verifies authentication and billing before running Antigravity.

## Recorded GPT draft

On 2026-11-21, a ChatGPT-authenticated, read-only `codex exec` session requested model `gpt-6.2-astra` once for accepted Define run `run_mwqft8u0_wlwcgz`. It produced a proposal covering AC-001, AC-002 and AC-003 in 16 seconds, reporting 17,503 input tokens, 234 output tokens and zero cached input, cache-write input and reasoning output tokens. The event stream recorded one agent message and no tool calls. Monetary cost and served model ID were unavailable.

The proposal SHA-256 was `10e539ffedfdbd10769019f77ef88d58371f20393da06719047b480ad47eea43`. The shipped Plan preparation command consumed the proposal and produced a pending preview with approval SHA-256 `3bf718da5c1e9efb33132cfb84af25757f1f1d9734c5e77360fa374bf5c92eac`. This observation measures the Codex session including its host context. The API-key drafting adapter is covered independently by its offline provider contract scenarios.
