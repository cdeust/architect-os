# Step V.1, fourth pass: the maintainer's decisions on what the third pass listed

The three passes before are in the worktree (`steps/design-truth-1/`, `-2/`, `-3/`: read the three briefs, which hold the rule and the limits, and the third report, sections « For the maintainer » and « Found and not changed »). The review of the third pass accepted it and left five proposals; the third pass left a list for the maintainer. The maintainer decides each, below.

## Marks of the text that lag behind the tree (`docs/design/platform-v3-srt.md`)

1. The table of the state of the bricks, near line 22: the gate of the tests (brick 1a) and `features/sandbox/escape.feature` (brick 1b) are under « Prévu ». Both exist and run (`tools/test-gate`, `.github/workflows/gate.yml`; the section 8 of the same document gives the rows of `escape.feature`). They move to what is built, each with the file that proves it. Read the whole table against the tree and the section 8, and move every other entry that is built; list them.
2. Near line 265, the mark `[à prouver : 1b]`: `features/descriptive/manifest.feature` proves that a tool of kind agent cannot be marked stable, that a server reached over HTTP is refused, the call cycles and two modules writing one table. The mark becomes proved for those, with the feature. The clause « Le réseau interne découle de `kind` » is not a rule of the schema, and the same document says near line 207 that the network list comes from the template of the profile: write that.
3. Near line 441, the mark `[à prouver]`: the broker started by the gateway with its standard streams kept is proved (`features/sandbox/gateway-native.feature`, `broker-start.feature`); a user id of its own for the broker is not. Split the mark: proved for the first, with the features; to be proved for the second, with the brick that carries it (read the roadmap of `README.md`; if no row carries it, say so in the report and do not invent one).

## The places that restate them

4. `docs/communication/video-script.md`: the badge of the gate of the CI says « conçu, à prouver (1a) » while the voice states it in the present: the gate is built; say so, with what proves it. The shot list gives 3:22 for the voice recording while the summary table gives another duration: one duration, computed the way the table computes it (say how), in both places.
5. `docs/communication/deck/slides/porte-ci.html`, its notes end « Cette porte s'écrit à la brique 1a »: it is written; say what it does today.
6. `docs/communication/deck/slides/brique-base.html`, the badge « TUI à prouver »: figure 3 of the design says the TUI is proved in a pty and the first real launch is the owner's. The badge says the same.
7. `docs/communication/deck/slides/mesure.html`, its notes: « en ajout seulement » is true under Postgres (say so, as the text does), and the proof on the side of the gateway and of `data` cites `data/features/*.feature` with the two files it names.
8. `docs/communication/deck/deck.json`, the description of the slide `s2`: « tout le reste sous sandbox » becomes what the text says (the gateway starts modules and workers under srt; plugins belong to brick 1c; the gate of the CI still runs the candidate code as the host). Run the scenario that loads `deck.json` if there is one, and say.
9. `docs/design/platform-v3-srt.html`, the caption of figure 2: it says « preuve prévue » where the text says « à prouver »: the restatement uses the mark of the text.

## Then

For each change of points 1 to 3, search the figures, the thirteen slides with their notes, `deck.json` and the video script for the same statement, and bring each in line. In the report: a table of the nine points (done, how) and of every other place changed.

## Limits

As in the three briefs before. No code, profile nor scenario changes. The two journals, `steps/`, `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3.html` are not touched. Tables of decisions and dated accounts are history. If your sandbox cannot render a page or a slide, say so plainly and list what you checked in the source.

## Checklist

- [ ] `npx prettier --check .`: green. `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `git status --short`: documentation only, and `modules/broker/broker.json` from the pass before.
