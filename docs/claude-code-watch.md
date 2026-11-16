# The watch of Claude Code

The platform runs on two packages of Anthropic, pinned to exact versions: the Claude Agent SDK, whose package holds the Claude Code binary that the workers and the orchestration loop launch, and the sandbox runtime (srt). This page records what was read of their changelog and what was decided, so that a pin moves for a reason and with a proof. The workflow `pins.yml` turns red when a published version is ahead of a pin.

Sources: the changelog of Claude Code, `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`; the release notes of the sandbox runtime, `https://github.com/anthropics/sandbox-runtime/releases`; the documentation index, `https://code.claude.com/docs/llms.txt`; a page, `https://code.claude.com/docs/en/<page>.md`.

## State

| Package                          | Pinned  | Read up to | Read on          |
| -------------------------------- | ------- | ---------- | ---------------- |
| `@anthropic-ai/claude-agent-sdk` | 0.3.325 | 2.1.325    | 16 November 2026 |
| `@anthropic-ai/sandbox-runtime`  | 0.0.83  | 0.0.83     | 16 November 2026 |

The SDK 0.3.N holds the Claude Code binary 2.1.N.

## From 2.1.313 to 2.1.325 (1,043 entries)

The pin had stayed at 2.1.312 while 2.1.325 was published: nothing watched it. Read on 16 November 2026 for what touches a headless run (`-p`), the Agent SDK, the sandbox, hooks and what a session sends to the API.

| Version | Entry                                                                                                                                            | Decision                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1.325 | A security issue fixed in how zstd-compressed responses are decoded                                                                              | Taken with the pin                                                                                                                                                                                                                           |
| 2.1.323 | Code Mode: Claude writes JavaScript that makes several tool calls in one step (experimental, off by default)                                     | Does not apply to the loop nor to the workers: its page says it does not work with `-p`, with the Agent SDK, behind a custom `ANTHROPIC_BASE_URL`, nor with telemetry off. In an interactive session it is the user's own setting to turn on |
| 2.1.323 | `CLAUDE_CODE_DISABLE_AGENT_PROGRESS_SUMMARIES`: turns off the progress summaries of subagents and the requests that write them                   | Not taken: a worker starts no subagent. To look at again if a profile ever allows one                                                                                                                                                        |
| 2.1.319 | `CLAUDE_CODE_DISABLE_FEATURE_FLAGS`: stops feature-flag fetching without turning telemetry off                                                   | Not taken: the worker profile already sets `DISABLE_TELEMETRY` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and a worker reaches one port, the broker                                                                                     |
| 2.1.317 | `onFailure: "block"` for the hook callbacks of the Agent SDK                                                                                     | Does not apply: the worker registers no hook                                                                                                                                                                                                 |
| 2.1.314 | `permissions.blockWritesOutsideWorkingDirectories`: Write, Edit and NotebookEdit refuse a path outside the working directories, in every mode    | Candidate for the sessions of the orchestration loop, beside srt. Not taken yet: it is a behaviour of the loop to add with its scenario, not a line to slip in with a pin                                                                    |
| 2.1.325 | Sandboxed Bash commands follow the normal permission flow by default (`sandbox.autoAllowBashIfSandboxed`); refused writes to `.claude` under srt | Do not apply: they are about the Bash sandbox Claude Code starts for itself; the platform and the loop start srt themselves, around the whole process                                                                                        |

## The sandbox runtime, from 0.0.82 to 0.0.83

Read on 16 November 2026 in the release notes of `github.com/anthropics/sandbox-runtime`.

| Version        | Entry                                                                                                        | Decision                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 0.0.82         | The HTTP proxy logs only fixed fields of an upstream error, since a message or a stack can carry credentials | Taken with the pin                                                         |
| 0.0.82         | With `network.mitmProxy`, a SOCKS connection to one of its hosts goes through the MITM socket                | Does not apply: no profile of the platform sets `mitmProxy`                |
| 0.0.82, 0.0.83 | Windows: a narrower profile read grant, an optional MXC backend and its options                              | Do not apply: native Windows is not a supported host (design, decision 17) |

What proves the pin: the gate, whose scenarios launch the real binary before a fake model (`features/integration/agent-worker.feature`) and the whole platform by its entry file under real srt, with the escape test (`features/sandbox/`), on Linux and macOS.

## How to move a pin

1. Read the changelog between the pinned version and the published one, for what touches a headless run, the Agent SDK, the sandbox, hooks, and what a session sends to the API.
2. Add a section to this page: the range, the entries that apply, and the decision for each.
3. Move one pin at a time, `npm install --ignore-scripts`, and replay the scenarios that launch the binary or srt before moving the other.
4. Update the table of the state, then the gate and the CI as for any change.
