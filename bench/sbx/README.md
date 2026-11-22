# Offline builder qualification in Docker Sandboxes

These operator-run probes exercise the pinned Linux ARM64 clients in Docker Sandboxes 0.54.0. They implement the offline part of the [builder qualification design](../../docs/design/orchestration-fable-5-2.md). Step continues to use its admitted Claude builder under SRT.

Start the commands through the repository launcher, with the two release archives on the development volume. The Codex input is the npm tarball for `@openai/codex@0.170.0-linux-arm64`. The [Antigravity probe](antigravity.md) records Google's original release URL and checksum. The locally installed Docker shell template must match the digest in `isolation.json`. Both probes verify the archive and Linux executable.

```sh
./aos -- node --test bench/sbx/*.test.mjs
./aos -- python3 -B -m unittest discover -s bench/sbx
./aos -- node bench/sbx/text-turn.mjs "$CODEX_LINUX_ARM64_TGZ"
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

## A single text turn through the host

The native Codex client runs with a fresh home and a read-only sandbox. Its loopback server uses the existing SBX process pipes. The host sends the prompt, receives the native request, sends the answer and receives the final receipt. The native request releases a single challenge chosen by the host. The host validates the model, the complete answer and the token counts before sending a new text-only event stream to the guest. After Codex exits, the host compares the native receipt with its own observation, stops the VM and checks the shared workspace is empty.

The CLI command above uses a synthetic response. Its receipt identifies the fixture, zero upstream requests, and synthetic token counts. The host entry point `runHostedTurn(archive, requestText)` accepts a model response from a separately controlled host broker. That broker owns consent, subscription eligibility, the upstream destination, and evidence of the actual request and its billing. The bench has no token parameter. A successful broker callback alone proves the native exchange and does not establish account eligibility or cost.

### Astra subscription trials on 22 November 2026

Both trials used the host account broker, a tool-free challenge, and a separate authorization for one request. The account owner confirmed that credit fallback was disabled. The host received HTTP 200 for both the model catalog and the Responses request in each trial.

| Trial | Host observation                                                                                                             | Native completion | Measured tokens and cost |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------ |
| 1     | Host recorded `UNEXPECTED_EVENT`. The owner confirmed the subscription quota was exhausted. The event name was not retained. | No                | Unknown                  |
| 2     | The host saw `response.created`, then refused `response.metadata`. The receipt records the SHA-256 of its name.              | No                | Unknown                  |

The second event-name SHA-256 was `037e125ea2d6a409e3e17d05b062ce57c418a2d6443a96ccbc21a13252500441`. It matches `response.metadata` in the published Codex transport. This identifies the event type, but the receipt contains no payload. The second receipt does not establish another quota refusal. [Codex stream implementation](https://github.com/openai/codex/blob/104d2564181d8eb4e67d0c92005f3ab1052051d4/codex-rs/codex-api/src/sse/responses.rs#L216-L267)

The host stream decoder accepts empty metadata notifications and model confirmations for the response in progress. A different model, opaque state, policy notification or unknown field produces a refusal. The guest receives only verified final text and token counts. The native offline fixture exercises the decoder with a synthetic metadata notification. Neither live response body was retained, so the fixture cannot certify either historical response. [Subscription inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [Streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
