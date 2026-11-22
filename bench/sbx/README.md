# Builder qualification in Docker Sandboxes

These operator-run probes exercise the pinned Linux ARM64 clients in Docker Sandboxes 0.54.0. They implement the offline part of the [builder qualification design](../../docs/design/orchestration-fable-5-2.md). Step continues to use its admitted Claude builder under SRT.

Start the commands through the repository launcher, with the two release archives on the development volume. The Codex input is the npm tarball for `@openai/codex@0.170.0-linux-arm64`. The [Antigravity probe](antigravity.md) records Google's original release URL and checksum. The host selects the installed shell template and its agent kit by separate immutable references from `isolation.json`. Before staging the client it checks the actual VM image digest and installed kit against those references. Both probes verify the archive and Linux executable.

```sh
./aos -- node --test bench/sbx/*.test.mjs
./aos -- python3 -B -m unittest discover -s bench/sbx
./aos -- node bench/sbx/text-turn.mjs "$CODEX_LINUX_ARM64_TGZ"
./aos -- node bench/sbx/text-turn.mjs "$CODEX_LINUX_ARM64_TGZ" --moderation-fixture
./aos -- node bench/sbx/codex.mjs "$CODEX_LINUX_ARM64_TGZ"
./aos -- node bench/sbx/agy.mjs "$AGY_LINUX_ARM64_TGZ" 180000
```

The host creates one synthetic workspace under the admitted run. Before either client starts, it checks the host mounts, runtime mounts, published ports, static MCP server set and effective network policy. An active sandbox-scoped wildcard denial must cover TCP and UDP, with zero allow rules. The policy engine must explicitly refuse a destination for each protocol. The host checks that the unprivileged client cannot write the guest daemon socket before staging either client. The guest receives the pinned probe assets and runs the client under UID 65534. The host removes the named VM and verifies its absence before deleting the temporary workspace.

For Codex the host keeps its original witness file open for the whole run. After confirming VM removal it checks the file identity and reads at most 21 bytes from that descriptor for the expected 20-byte marker. On SIGINT, SIGTERM or SIGHUP the host cancels the current exchange and waits for shutdown. A failed stop or inconclusive VM creation retains the workspace and reports its path and VM name for recovery. The original probe failure remains available alongside a cleanup failure.

| Native result on 22 November 2026                                                             | Outcome                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex 0.170.0 with its own workspace-write sandbox and an in-guest loopback Responses fixture | Exit 0. Two fixture requests, one tool result, one completed turn. The host observed one file containing the expected 20 bytes. Its SHA-256 was `e05e5da7e17f4f88a5ac214b4b96c31fb88f51782123872b22e58da2d4f891ce`. The terminal event reported eight input and four output tokens from the synthetic responses. |
| Codex 0.170.0 with a read-only guest and a host fixture over stdin/stdout                     | Exit 0. One native request, one completed response, matching synthetic usage of eight input and four output tokens. The host found the shared workspace empty after VM shutdown.                                                                                                                                 |
| Google Antigravity 1.5.14 with a fresh home and an offline ACP session                        | Exit 1. Initialization succeeded. Session creation returned `-32000`. The host received a refusal receipt.                                                                                                                                                                                                       |

All three runs completed without an upstream model call. Qualification of an account route requires a separate tool-free subscription turn through a host-owned consent and metered proxy. The offline results grant no authority to change a project worktree.

## Where the account credential lives

Docker's `sbx` CLI creates and inspects the VM. The bench creates it with `--deny-network '**'`, `--static-mcp none` and `--pull never`, then verifies the resulting policy and mounts. [Docker SBX CLI](https://docs.docker.com/reference/cli/sbx/) · [Sandbox creation options](https://docs.docker.com/reference/cli/sbx/create/)

Docker also offers `sbx secret set openai --oauth`. Its local OpenAI OAuth flow stores the credential at global scope. Docker documents the system Keychain as its credential store on macOS. The subscription bench uses a separate, host-owned OpenAI consent flow. The broker holds the access token in memory. Only the synthetic challenge and verified response data cross the VM pipes. No OAuth credential is registered with SBX for these trials. [Docker OAuth command](https://docs.docker.com/reference/cli/sbx/secret/set/) · [Docker credential storage](https://docs.docker.com/ai/sandboxes/configuration/credentials/)

## A single text turn through the host

The native Codex client runs with a fresh home and a read-only sandbox. Its loopback server uses the existing SBX process pipes. The host sends the prompt, receives the native request, sends the answer and receives the final receipt. The native request releases a single challenge chosen by the host. The host validates the model, the complete answer and the token counts before sending a new text-only event stream to the guest. After Codex exits, the host compares the native receipt with its own observation, stops the VM and checks the shared workspace is empty.

The CLI command above uses a synthetic response. Its receipt identifies the fixture, zero upstream requests, and synthetic token counts. The host entry point `runHostedTurn(archive, requestText)` accepts a model response from a separately controlled host broker. That broker owns consent, subscription eligibility, the upstream destination, and evidence of the actual request and its billing. The bench has no token parameter. A successful broker callback alone proves the native exchange and does not establish account eligibility or cost.

### Astra subscription trials on 22 November 2026

Each trial used the host account broker, a tool-free challenge, and a separate authorization for one request. The owner attested that credit fallback was disabled. In all three trials the account catalog listed `gpt-6.2-astra` and both the catalog and Responses endpoints returned HTTP 200.

| Trial | Host observation                                                                                                             | Native completion | Measured tokens and cost |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------ |
| 1     | Host recorded `UNEXPECTED_EVENT`. The owner confirmed the subscription quota was exhausted. The event name was not retained. | No                | Unknown                  |
| 2     | The host saw `response.created`, then refused `response.metadata`. The receipt records the SHA-256 of its name.              | No                | Unknown                  |
| 3     | The host recorded `UPSTREAM_REFUSED` with `kind=provider_metadata` and `disposition=requires_native_handling`.               | No                | Unknown                  |

The second event-name SHA-256 was `037e125ea2d6a409e3e17d05b062ce57c418a2d6443a96ccbc21a13252500441`. It matches `response.metadata` in Codex 0.170.0. The third receipt classified the metadata but retained no field names, values or upstream response body. The specific control and provider terminal status are unknown for that trial. [Codex 0.170.0 stream implementation](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/codex-api/src/sse/responses.rs#L216-L292)

HTTP 200 establishes that the endpoint answered. The server-sent event (SSE) stream carries the provider's terminal status and usage. The host observer can record a completed, failed or incomplete terminal linked to the response ID and model from `response.created`. It records input, output and total tokens when the counts are valid and agree. The native decoder separately decides whether it can release the answer. A conflicting routing state or a policy notification can still stop the guest even when the host has observed a metered terminal. Dollar cost requires separate billing evidence. [Subscription inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)

The native offline fixture exercises an exact model confirmation, one consistent routing state and an empty verification list. The host preserves active controls and refuses unknown ones before sending any text to the guest. A second native fixture injects a moderation notification before a metered terminal. The host records eight input and four output fixture tokens and refuses delivery. The guest receives no answer, and the VM is removed. The text-only route also rejects an explicit continuation, commentary or partial answer. [Codex completion](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/codex-api/src/sse/responses.rs#L494-L515) · [Message phases](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/protocol/src/models.rs#L975-L992)

The three historical receipts retain their original unknown usage and cost.
