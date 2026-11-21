# Draft a proposal with a signed-in CLI

Choose one provider and an available native model. Sign in using that CLI’s own interactive account flow first. Architect OS starts the chosen CLI once from a new empty directory and sends the accepted handoff and Step name on stdin. It does not load, copy or put an account credential into the child environment.

| Provider | Native executable | Native account                                |
| -------- | ----------------- | --------------------------------------------- |
| `claude` | `claude`          | Claude account using Claude Code              |
| `gpt`    | `codex`           | ChatGPT account using Codex                   |
| `gemini` | `agy`             | Personal Google account using Antigravity CLI |

```sh
./aos -- npm run --silent plan -- draft "$PROVIDER" "$MODEL" delivery define.json draft-01.jsonl "$TIMEOUT_MS" > proposal.json
./aos -- npm run --silent plan -- prepare define.json proposal.json policy.json > preview.json
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
  ./aos -- npm run --silent plan -- agy-request "$MODEL" delivery "$PLAN_FILES/define.json" > "$PLAN_FILES/request.jsonl"
  SCHEMA='{"type":"object","required":["request_sha256","proposal"],"properties":{"request_sha256":{"type":"string"},"proposal":{"type":"object","required":["step","objective","verification","acceptance_ids"],"properties":{"step":{"type":"string"},"objective":{"type":"string"},"verification":{"type":"string"},"acceptance_ids":{"type":"array","items":{"type":"string"}}}}}}'
  SETTINGS='{"modelProvider":"","agentMode":"","useG1Credits":false,"toolPermission":"strict","permissions":{"deny":["read_file(*)","write_file(*)","read_url(*)","execute_url(*)","command(*)","mcp(*)"]}}'
  (
    cd "$AGY_WORKSPACE"
    env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u AGY_ADC_AUTH agy \
      --settings "$SETTINGS" --disable-slash-commands --print-timeout "$AGY_TIMEOUT" \
      --model "$MODEL" --json-schema "$SCHEMA" --input-format stream-json --output-format stream-json \
      < "$PLAN_FILES/request.jsonl" > "$PLAN_FILES/response.jsonl"
  )
  ./aos -- npm run --silent baseline:planning -- "$PLAN_FILES/agy-01.jsonl" agy-result \
    "$MODEL" delivery "$PLAN_FILES/define.json" "$PLAN_FILES/response.jsonl" > "$PLAN_FILES/proposal.json"
  ./aos -- npm run --silent plan -- prepare "$PLAN_FILES/define.json" "$PLAN_FILES/proposal.json" \
    "$PLAN_FILES/policy.json" > "$PLAN_FILES/preview.json"
)
```

The Architect OS commands in this exchange work offline. The shell stops if Antigravity exits unsuccessfully. On quota exhaustion, wait for the subscription quota to renew. Import checks for a successful single-turn stream in strict permission mode, rejects any reported tool or subagent step, and binds the proposal to the requested model, Step and exact Define bytes. The proposal goes through the same preview and approval. The receipt records local import duration and reported external duration and tokens separately, with billing unverified and monetary cost and served model ID unavailable. The stream supplies consistency checks. The operator verifies authentication and billing before running Antigravity.

## Recorded GPT draft

On 2026-11-21, a ChatGPT-authenticated, read-only `codex exec` session requested model `gpt-6.2-astra` once for accepted Define run `run_mwqft8u0_wlwcgz`. It produced a proposal covering AC-001, AC-002 and AC-003 in 16 seconds, reporting 17,503 input tokens, 234 output tokens and zero cached input, cache-write input and reasoning output tokens. The event stream recorded one agent message and no tool calls. Monetary cost and served model ID were unavailable.

The proposal SHA-256 was `10e539ffedfdbd10769019f77ef88d58371f20393da06719047b480ad47eea43`. The shipped Plan preparation command consumed the proposal and produced a pending preview with approval SHA-256 `3bf718da5c1e9efb33132cfb84af25757f1f1d9734c5e77360fa374bf5c92eac`. This observation measures the Codex session including its host context. The native CLI adapters have separate offline process-contract scenarios.

A refused draft records a fixed native failure category when available, including CLI diagnostics, incomplete or unexpected events, provider refusal, process failure and unavailable output. Model text and diagnostic bytes are discarded. A warning can refuse a proposal while retaining the counters from an otherwise valid response.

## Signed-in CLI measurement on 2026-11-21

At architect-os commit `7bf2ee04`, all three commands used the same accepted Define (SHA-256 `c748171d2920c8b03f7cf1a07d1575f87f5b237ad921fd8e635d4eba043a3312`). No native launcher proposal passed directly to prepare in this measurement.

| Native command                  | Process         | Input / output tokens | Reported USD | Result                                                                                                                                          |
| ------------------------------- | --------------- | --------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Haiku                    | Exit 1, 0.93 s  | 0 / 0                 | 0            | The account showed 100% weekly usage and additional credits disabled.                                                                           |
| Codex 0.162.1, GPT-6.2 Astra    | Exit 1, 4.38 s  | Unknown               | Unknown      | The standalone executable ran. An earlier local discovery refusal stopped before any process started.                                           |
| Antigravity, Gemini 4 Neon High | Exit 0, 17.51 s | 9,827 / 711           | Unknown      | The launcher refused the response. The existing native transcript yielded the proposal and counters. A separate prepare accepted it as pending. |

The Gemini transcript and launcher journal represent one attempt. The recovered proposal SHA-256 is `138845d4d6d7a424bc918c54ee5b91db269c9ee45023d73fe9e35c42c21e8aa6`; the separate recovery receipt SHA-256 is `95b75dd895a56c160b1057a6c6ed7aac0b0bfed2444484d154d36888c8ec34a5`. The original journal did not distinguish stderr warnings from rejected stream events. Google documents that individual accounts warn when given an enterprise-only unsandboxed rule. The personal-account command denies all commands with `command(*)`, which covers execution both inside and outside the sandbox. [Google CLI permission matching](https://antigravity.google/docs/permissions?tab=cli)

## Exit status and receipt versions

Both `plan draft` and `baseline:planning … draft` exit 0 only after accepting a proposal, 1 on provider or proposal refusal, and 2 on invalid arguments, invalid Define or an unavailable receipt. A refusal emits no proposal on stdout. Version 2 terminal receipts record the architect-os decision in `exit_code` and the launched process status in `native_exit_code`. When the CLI never starts or dies by signal, its native code is null. A native 0 with an architect-os 1 records a completed CLI whose answer was refused. Historical version 1 draft receipts used `exit_code` for the native process.

`agy-result` uses the same decision codes. It exits 2 for an unavailable local stream file, and 1 for a supplied stream that fails verification. Its version 2 receipt always records `native_exit_code: null` because the importer does not launch the process. Version 1 import receipts had no exit-code fields.
