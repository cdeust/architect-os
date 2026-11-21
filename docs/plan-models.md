# Draft a proposal with a signed-in CLI

Choose one provider and an available native model. Sign in using that CLI’s own interactive account flow first. Architect OS starts the chosen CLI once from a new empty directory and sends the accepted handoff and Step name on stdin. It does not load, copy or put an account credential into the child environment.

| Provider | Native executable | Native account                                |
| -------- | ----------------- | --------------------------------------------- |
| `claude` | `claude`          | Claude account using Claude Code              |
| `gpt`    | `codex`           | ChatGPT account using Codex                   |
| `gemini` | `agy`             | Personal Google account using Antigravity CLI |

```sh
npm run --silent plan -- draft "$PROVIDER" "$MODEL" delivery define.json draft-01.jsonl "$TIMEOUT_MS" > proposal.json
npm run --silent plan -- prepare define.json proposal.json policy.json > preview.json
```

The final operand is the CLI process timeout in milliseconds. A provider can accept a request before the timeout. The draft path has no output-token or monetary cap. Use a new receipt path per attempt. Each receipt binds the requested provider/model, Define digest and run ID to a duration and terminal outcome. A valid draft also records its digest. The operator's approval is still required before materialization. To prepare an existing proposal again, pass its saved file directly to `plan prepare`.

Executable discovery ignores the working directory and inherited PATH. The default installation is `~/.local/bin/{claude,codex,agy}`. For Codex, `/opt/homebrew/bin/codex` and `/usr/local/bin/codex` take precedence. Select a different trusted installation explicitly with `AOS_PLAN_CLAUDE_BIN`, `AOS_PLAN_GPT_BIN` or `AOS_PLAN_GEMINI_BIN`. These must be absolute executable paths with the expected basename. Repository installations are refused. The child gets a closed environment and an isolated working directory. Provider-managed authentication and organizational settings belong to the native client.

Claude uses print mode with tools, MCP configuration, slash commands and session persistence disabled. Codex uses ephemeral JSON output, read-only sandboxing and its ChatGPT login method with user configuration, plugins, apps, shell, MCP and web search disabled. The receipt excludes raw diagnostics and native session IDs. When the CLI omits the served model, cost or token categories, the receipt records `null`. Native token counts may include the CLI's system context.

Google retired the consumer Gemini CLI sign-in route in June 2026. Use the Antigravity CLI for this provider. Set `AOS_PLAN_GEMINI_HOME` to the profile home signed in using the personal Google account. Antigravity runs in sandboxed Plan mode with strict tool permissions and AI credits disabled. Set up this profile through the CLI’s personal-account sign-in and verify the included quota there. The preflight refuses enabled ADC, configured MCP servers, hooks and installed plugins. The receipt records `billing_verified: false` because billing entitlement is absent from the native stream. Antigravity may retain native conversation history. AOS rejects tool or subagent events, model/permission mismatches, incomplete streams and ambiguous stderr output. Native usage fields do not establish an invoice amount. [Google migration](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals) · [Antigravity headless protocol](https://antigravity.google/docs/cli/headless/)

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

The proposal SHA-256 was `10e539ffedfdbd10769019f77ef88d58371f20393da06719047b480ad47eea43`. The shipped Plan preparation command consumed the proposal and produced a pending preview with approval SHA-256 `3bf718da5c1e9efb33132cfb84af25757f1f1d9734c5e77360fa374bf5c92eac`. This observation measures the Codex session including its host context. The native CLI adapters have separate offline process-contract scenarios.

A refused draft records a fixed native failure category when available, including CLI diagnostics, incomplete or unexpected events, provider refusal, process failure and unavailable output. Model text and diagnostic bytes are discarded. A warning can refuse a proposal while retaining the counters from an otherwise valid response.
