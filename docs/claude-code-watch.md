# The watch of Anthropic

The platform holds things of Anthropic: two pinned packages (the Claude Agent SDK, whose package holds the Claude Code binary that the workers and the orchestration loop launch, and the sandbox runtime), and the behaviours its mechanisms rely on, described in the documentation of Claude Code and of the API. `tools/watch/watch.json` names each of these sources, the files that rely on it, and what was read of it (design: `docs/design/anthropic-watch.md`). This page records what was read and what was decided, so that a pin moves, or a mechanism changes, for a reason and with a proof.

## State

The state is the register, not a table here. `npm run watch -- check` compares it with the sources and says, source by source, `à jour`, `en retard` or `illisible`; the workflow `watch.yml` runs it every Monday.

## How a reading is done

1. `npm run watch -- check --keep <a folder outside the repository>`: for each page or changelog that moved, the new text is kept beside the one read last time. Read the difference, not the page.
2. Classify each change. **Mandatory**: a deprecation, a change of default, a removal, a migration, a security fix; it is taken, at a named step, before the platform is forced to. **Pertinent**: it touches a mechanism of the platform or offers it something; it is kept, with its decision. **Not applicable**: it touches nothing of the platform; it is recorded with its reason. A change is kept because it is pertinent, whether or not it brings security or lowers a cost (the owner's decision, 17 November 2026): security and cost order what is done first, they filter nothing out. For a page, `check` names the files to read again.
3. Add a section to this page: the source, the range or the date, the entries that apply and the decision for each, and what the reading cost.
4. `npm run watch -- read <id>...` records the reading in the register. A pin is not recorded this way: it moves in its manifest (below).

No source leaves the register because its changes led to no decision: it costs one comparison a week, and taking it out would mean reading it whole again the day it matters (the owner's decision, 17 November 2026).

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

1. Read the changelog between the pinned version and the published one (`check` gives both), for what touches a headless run, the Agent SDK, the sandbox, hooks, and what a session sends to the API.
2. Add a section to this page: the range, the entries that apply, and the decision for each; record the reading of the changelog with `npm run watch -- read`.
3. Move one pin at a time, `npm install --ignore-scripts`, and replay the scenarios that launch the binary or srt before moving the other.
4. `npm run watch -- check` says the pin is up to date; then the gate and the CI as for any change.
