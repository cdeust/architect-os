# Step V.1, second pass: the places the first pass missed, and the figures and slides read whole

The first pass is in the worktree (`steps/design-truth-1/`: read its brief, which holds the rule and the limits, and its report). It corrected the design of the platform passage by passage; its review found the same statements, corrected in the text, still standing in the figures of `docs/design/platform-v3-srt.html` and in the slides of `docs/communication/deck/slides/`. The rule of the first brief holds: a statement corrected in one place is corrected in every place it is made.

## The eleven points of the review

1. `docs/design/platform-v3-srt.html`, figure 1, a label says the broker forwards one route « seul »; `modules/broker/broker.json` admits two (`/v1/messages` and `/v1/messages/count_tokens`), as the text and the table of the same page now say.
2. Same figure: a label states `peer` on a Unix socket as present; the text now says data is reached through `DATABASE_URL`, `trust` in CI, `peer` on a server planned (brick D).
3. Same figure: its legend says every link between the gateway and a child is MCP on stdio; the callback of a module is MCP over HTTP on the loopback, as the description of the figure and the text now say.
4. Same figure: the link of the client shows the three meta-tools as the present interface; today the client calls `recall` and `remember`, and the meta-tools are brick 3. The caption says what is target for the client tools as it does for the executor.
5. `docs/communication/deck/slides/topologie.html`: the visible heading still says plugins run under srt today; its speaker notes were corrected (plugins belong to brick 1c).
6. `docs/communication/deck/slides/brique-base.html`: its speaker notes still give protection hooks as the reason for the write denials; decision 2 replaced them by the session's `permissions.deny` rules.
7. `docs/design/platform-v3-srt.md`, the mention added to the row of decision 3: a space before the full stop.
8. `docs/communication/deck/slides/isolation.html`: a box keeps the badge « Prouvé au banc » while it now holds a sentence about the future (the executor of brick 3) and a claim about the `checker` profile that a scenario of the escapes proves, not the bench. What the badge covers is only what the bench showed: move the other sentences out of the box, or narrow the badge and name the proof of each claim.
9. `docs/design/platform-v3-srt.md`, the table of who holds what: the row of the CI now describes only today's federation and drops the token of the `ci-review` profile, which is the design of bricks 1c and 2. One clause says what those bricks will add, so that the design does not vanish from the table.
10. `docs/design/platform-v3-srt.md`, section 5, the list of the variables the adapter resolves leaves out `worktreeName` (`packages/sandbox/src/profile.ts`). Read the function and give the list it holds, whole.
11. `modules/broker/broker.json`: its `description` says « POST /v1/messages seul » while its own `routes` admit two. This one file outside the documentation may be changed, in its `description` only: write what the routes say. Run the scenarios that load that file and say they are green.

## Then read whole, not only at the eleven places

The first pass corrected sentences; the figures and the slides were not read as wholes. For each of these, read every label, legend, caption, heading, note and alternative text against the corrected text of `docs/design/platform-v3-srt.md`, and correct what states as present a thing the text now says is reversed, planned or otherwise:

- every figure of `docs/design/platform-v3-srt.html`;
- every slide of `docs/communication/deck/slides/` (thirteen files), speaker notes included;
- `docs/communication/video-script.md`.

In the report: a table with one row per figure and per slide: read, what was corrected, or nothing to correct.

## Limits

As in the first brief: tables of decisions and dated accounts are history; the two journals and `steps/` are not edited; `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3.html` (the vision of 29 October, which carries a dated notice) are not touched; no code, profile nor scenario changes, apart from the one `description` of point 11; nothing of a workstation, an account or a private path is written. Render the figures you change and look at them; if your sandbox cannot render, say so plainly.

## Checklist

- [ ] `npx prettier --check .`: green. `npx cucumber-js --profile replay features/arch features/descriptive modules/broker/features`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `git status --short`: documentation, and `modules/broker/broker.json` alone outside it.
