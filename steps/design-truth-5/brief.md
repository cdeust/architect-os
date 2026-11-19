# Step V.1, closing pass: the baseline of brick 0, decided, and two wordings

The four passes before are in the worktree (`steps/design-truth-1/` to `-4/`: read the four briefs, which hold the rule and the limits). The review of the fourth pass accepted it and left three proposals. One was a question of design: is the cost campaign of brick 0 the baseline that the design's decision D-7 leaves open? The maintainer put it to a reviewer of another provider, read-only; its decision is below, as it wrote it, with the exact replacements. The maintainer adopts it.

## What to do

1. `docs/design/platform-v3-srt.md`: apply the five replacements of the decision's table (section 1 near line 17; the two cells of the table of the state of the bricks near line 21; row 0 of section 8 near line 432; section 9.2 near line 499), and add to the status cell of decision D-7, in the table of decisions, the cross-reference the decision gives (« Gardée pour M1 et M2. Baseline de coût réalisée le 4 novembre 2026 (§22, §23). »), nothing else in that row. Before each replacement, read the current text and check it is the one the decision quotes; if it is not (an earlier pass changed it), apply the decision's meaning to the text as it stands and say so.
2. `README.md`: the row of brick 0 says « done »; the decision says it stays as it is. Check that no other sentence of the README calls the baseline of M1 and M2 done or dated; correct any that does.
3. Search the figures of `docs/design/platform-v3-srt.html`, the thirteen slides of `docs/communication/deck/slides/` with their notes, `docs/communication/deck/deck.json` and `docs/communication/video-script.md` for the baseline of brick 0 and for D-7, and bring each in line with the two things the decision separates (the cost baseline, done; the baseline of M1 and M2, open, at the owner's date).
4. `docs/design/platform-v3-srt.md`, near line 23, the entry that moved to « Fait » for the key of the broker cites only `features/sandbox/recall.feature`; the refusal of a key file that is not mode 0600 is proved by `modules/broker/features/broker-start.feature` (the scenario of a key file the broker cannot trust). Cite both, each for what it proves.
5. `docs/communication/video-script.md`, the note of the durations near line 38: say how the total is computed (from the total of the words, or as the sum of the rounded acts) so that a reader who adds the column does not find a second duration; if the two differ, give one, the way the note says it is computed, everywhere a total duration is given in the file.

## Limits

As in the four briefs before. No code, profile nor scenario changes. The two journals, `steps/`, `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3.html` are not touched; a numbered decision is never renumbered nor rewritten.

## Checklist

- [ ] `npx prettier --check .`: green. `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `git status --short`: documentation only, and `modules/broker/broker.json` from an earlier pass.

---

## The decision, as its author wrote it

Brick 0’s launch-cost baseline is complete, the design table should put it under « Fait », and D-7 remains open for the separate M1/M2 baseline. README.md:75 · baseline/README.md:3 · platform-v3-srt.md:17–21 · journal.md:102

**What the campaign proves.** On 4 November 2026, the campaign ran 20 short defect fixes under `host`, `host-bare` and `srt`, with three repetitions per configuration. It measured session cost at public prices and reported input and output tokens by launch configuration. The README’s « done » applies precisely to that experiment. README.md:75 · README.md:178–188 · journal.md:750–756 · campaign report:3–9

**What D-7 leaves open.** The v3 protocol calls for 20 representative platform tasks, including memory recall, spec writing and PR review. M1 counts the tokens entering the client’s context over a task. M2 totals tokens for the task by layer and model, so a fall in M1 can be checked against a rise elsewhere. The SRT design says the broker supplies its layer and the client measurement comes from the brick 1c hook. Writing campaign figures to `baseline/results/` satisfies the location named in §8. The campaign report supplies neither the representative task set nor the layer breakdown required there. I found no recorded date for the M1/M2 run or owner decision accepting the cost campaign in its place. platform-v3.html:55–63 · platform-v3-srt.md:91 · platform-v3-srt.md:430–433 · platform-v3-srt.md:499 · campaign report:5–9

**Exact edits to the design.** For table cells, the quoted fragment is the text to replace.

| Location | Current text | Replacement |
|---|---|---|
| §1, line 17 | « Aucune ne bloque une porte tant que le propriétaire n'a pas fixé la date de la baseline (D-7, brique 0). » | « Aucune ne bloque une porte tant que le propriétaire n'a pas fixé la date de la baseline de M1 et M2 (D-7). » |
| Recherche, Fait, line 21 | « 1a.0 prouvée » | « baseline de coût de la brique 0 mesurée sur 20 tâches, 3 configurations et 180 sessions (journal §22, §23) ; 1a.0 prouvée » |
| Recherche, Prévu, line 21 | « M1, M2, R aux briques 1c à 3 ; baseline à la brique 0 » | « baseline de M1 et M2 à la date du propriétaire (D-7) ; M1, M2, R aux briques 1c à 3 » |
| §8, row 0, line 432 | `0 \| Baseline \| 20 tâches, M1, M2 ; à la date du propriétaire \| Chiffres écrits dans baseline/results/` | ``0 | Baseline | Coût mesuré sur 20 tâches, 3 configurations et 180 sessions (journal §22, §23). Baseline de M1 et M2 sur 20 tâches représentatives à la date du propriétaire (D-7) | Résultats de coût dans `baseline/results/` ; relevés de M1 et M2 par tâche encore attendus`` |
| §9.2, line 499 | « Ouvertes : la date de la baseline (D-7) et le nom définitif, au propriétaire. » | « Ouvertes : la date de la baseline de M1 et M2 (D-7) et le nom définitif, au propriétaire. » |

The other substantive mismatch is **§8 row 0**, included above. Its generic exit currently makes any figures in the directory look sufficient. The numbered D-7 decision itself stands. Its status cell may receive the cross-reference « Gardée pour M1 et M2. Baseline de coût réalisée le 4 novembre 2026 (§22, §23). » The design’s separately numbered decision 7 concerns the CI gate. platform-v3-srt.md:432 · journal.md:102 · journal.md:750–756 · platform-v3-srt.md:475

