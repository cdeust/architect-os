# Step W.0, closing: the eight proposals of the review that accepted the generated rows

The pass before is in the worktree (`steps/runtime-root-0l/`: read its brief, it holds the rule). Its review accepted the change and left eight proposals. The maintainer takes them all: none is left for later. Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).

1. `docs/diagrams/isolation.svg`: two elements carry the same `id` (a box of the host part, written by hand, and a generated row). The generated markup uses ids no other part of the file uses (a prefix of its own), and a scenario refuses an id that appears twice in the file.
2. Outside the markers, the box of the host part and the description of the image say that the paths denied for reading are one list, the same in the five profiles: the generator can contradict it (remove one entry of one profile: it then writes that the lists differ, and the box still says the same). The sentence leaves the hand-written parts: the box points to the generated row, the description says where the lists are stated and states none.
3. The box « Claude Code --bare · builder, reviewer » names folders those profiles write (the configuration, the temporary directory): rule 4 of the brief before. It keeps what is not a list (new at each launch) and names no folder a profile opens. Read every other hand-written text of the file the same way and correct each; list them in the report.
4. `features/support/isolation-rows.ts`: a single item longer than the room of a line gets a line to itself and runs past the border. The function refuses to produce rows when an item does not fit, the way it refuses rows that overflow the height; a scenario shows it.
5. The check outside the markers searches bytes: a path or a host split by a comment or a CDATA section is drawn whole and matches nothing. One closed rule: outside the markers the file holds no CDATA section, no document type nor entity declaration, and no comment other than the two markers; if the file needs a comment for its maintainers, it goes in `docs/` and not in the image. Poisoned copies for each. The sentence of the feature that says what remains to a reader is then true again: check it against what you built.
6. The description of the image and `README.md` (the sentence « which a scenario compares with the five files in both directions ») describe the earlier check. They say how the rows are kept true today: produced from the five files by one function, the gate requiring equality, one command to regenerate.
7. `README.md`, the roadmap row of the place to write: the clause on the git writes can be read as the purpose of closing them. The design says the opposite: the writes are open today, which lets a build session create a commit and move a local ref other than `main`; step (1b) closes them. Write it so that it cannot be read the other way, then read the whole row again.
8. `CLAUDE.md`: the line added to the list of commands for the regeneration stays; check that the rest of the file is unchanged against `HEAD`, and say so.

Regenerate the region, render the diagram and look at it. Recount the suite the way the README says it is counted.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `npm run diagram:isolation` run twice: no change the second time.
