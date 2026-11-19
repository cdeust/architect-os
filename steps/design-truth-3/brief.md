# Step V.1, third pass: three places left, and one kind of statement swept everywhere

The two passes before are in the worktree (`steps/design-truth-1/`, `steps/design-truth-2/`: read both briefs, which hold the rule and the limits, and the second report, which has a table of every figure and slide). The review of the second pass found three places where a figure, a slide or the voice-over still disagrees with the corrected text of `docs/design/platform-v3-srt.md`, and one wording.

## The four points

1. `docs/communication/video-script.md`, near line 71: the voice-over still says everything else already runs under srt. The corrected text (`platform-v3-srt.md`, section 2) says: the gateway starts the rest, modules and workers, under srt; plugins belong to brick 1c; outside the platform, the gate of the CI still runs the candidate code under the account of the host. The voice-over says the same, in its own register.
2. `docs/communication/deck/slides/mesure.html`: the slide marks the operational bounds as to be proved, and its notes end on proofs planned at steps 1b.2 to 1b.4. The text marks them proved, with the scenarios that prove them (`gateway/features/gateway.feature`, `gateway/features/agent-tools.feature`, `features/integration/agent-worker.feature`). The slide and its notes say what is proved and by what.
3. `docs/design/platform-v3-srt.html`, the caption of figure 2: it still says the call identifier and its invalidation at return are to be proved; the text marks them proved (`gateway/features/gateway.feature`, the scenario of a fresh call identifier, invalid once it returned).
4. `modules/broker/broker.json`, its `description`: the routes also admit a query string; say so (« avec ou sans paramètres de requête »), and run the scenarios that load the file.

## One kind of statement, swept everywhere

Points 2 and 3 are the same kind: a mark of proof that lags behind the text. The text of `docs/design/platform-v3-srt.md` carries its proofs in brackets (« prouvé … », « à prouver … », « prévu … »). For every such mark of the text, find where the same thing is said in the figures of `docs/design/platform-v3-srt.html`, in the thirteen slides of `docs/communication/deck/slides/` with their notes, and in `docs/communication/video-script.md`, and bring the lagging one in line with the text. Where the text itself says « à prouver » or « prévu » and a scenario of the tree now proves the thing, do not change the text on your own judgement: list it in the report, with the scenario, for the maintainer.

In the report: a table of every bracketed mark of the text (its line, its state) and the places that restate it (in line / corrected / none).

## Limits

As in the two briefs before. No code, profile nor scenario changes, apart from the one `description` of point 4. The two journals, `steps/`, `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3.html` are not touched. Render the figure you change and look at it; if your sandbox cannot render, say so plainly.

## Checklist

- [ ] `npx prettier --check .`: green. `npx cucumber-js --profile replay features/arch features/descriptive modules/broker/features`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `git status --short`: documentation, and `modules/broker/broker.json` alone outside it.
