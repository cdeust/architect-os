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

For Codex the host keeps its original witness file open for the whole run. After confirming VM removal it checks the file identity and reads at most 21 bytes from that descriptor for the expected 20-byte marker. A failed stop retains the workspace and reports both its path and the VM name for recovery. The original probe failure remains available alongside a cleanup failure.

| Native result on 22 November 2026                                                             | Outcome                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex 0.170.0 with its own workspace-write sandbox and an in-guest loopback Responses fixture | Exit 0. Two fixture requests, one tool result, one completed turn. The host observed one file containing the expected 20 bytes. Its SHA-256 was `e05e5da7e17f4f88a5ac214b4b96c31fb88f51782123872b22e58da2d4f891ce`. The terminal event reported eight input and four output tokens from the synthetic responses. |
| Codex 0.170.0 with a read-only guest and a host fixture over stdin/stdout                     | Exit 0. One native request, one completed response, matching synthetic usage of eight input and four output tokens. The host found the shared workspace empty after VM shutdown.                                                                                                                                 |
| Google Antigravity 1.5.14 with a fresh home and an offline ACP session                        | Exit 1. Initialization succeeded. Session creation returned `-32000`. The host received a refusal receipt.                                                                                                                                                                                                       |

All three runs completed without an upstream model call. Qualification of an account route requires a separate tool-free subscription turn through a host-owned consent and metered proxy. The offline results grant no authority to change a project worktree.

## A single text turn through the host

The native Codex client runs with a fresh home and a read-only sandbox. Its loopback server uses the existing SBX process pipes. The host sends the prompt, receives the native request, sends the answer and receives the final receipt. The native request releases a single challenge chosen by the host. The host validates the model, the complete answer and the token counts before sending a new text-only event stream to the guest. After Codex exits, the host compares the native receipt with its own observation, stops the VM and checks the shared workspace is empty.

The CLI command above uses a synthetic response. Its receipt identifies the fixture, zero upstream requests, and synthetic token counts. The host entry point `runHostedTurn(archive, requestText)` accepts a model response from a separately controlled host broker. That broker owns consent, subscription eligibility, the upstream destination, and evidence of the actual request and its billing. The bench has no token parameter. A successful broker callback alone proves the native exchange and does not establish account eligibility or cost.
