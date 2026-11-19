# Step W.0, closing: the seven points of the review, and one claim corrected in every place it is made

The passes before are in the worktree (`steps/runtime-root-0n/`, `-0o/`, `-0p/`: read the three briefs). Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`). The maintainer takes the seven points.

The pass before corrected a false sentence in the feature and left the same sentence in two other files. A claim is corrected **in every place it is made**: for each point below that changes what is said, search the tree (`README.md`, `docs/`, `CLAUDE.md`, the features, the comments of the step and support files, the descriptions and alternative texts of the images) for every statement of the same claim and correct each; list in the report, for each point, the places you found.

1. The claim that the hand-drawn picture states nothing of what a profile opens: false (its Claude Code box names two profiles, gives them a session token and their own folders; an arrow shows what they reach). It is still in `docs/testing.md` and in `README.md` (« states none of these lists »). Everywhere: the hand-drawn picture shows who starts what and what holds the credential, and is read by the reviewer of each change; what each profile opens, closes, reaches and receives is stated by the generated image, which the gate holds equal to the files.
2. `docs/testing.md`, the paragraph of this feature: it says as a fact that the function starts no process, which the feature marks as read by the reviewer; and it lists two refusals where the function has one per kind of text. It says what the feature says, no more and no less.
3. `features/arch/isolation-diagram.feature`: two claims have no scenario (all the texts are drawn in a monospace family; each text carries its own size). A scenario reads the produced image and shows both: every text element of the image carries the family the measure assumes and a size, and the size each kind is drawn at is the size it is measured with. Removing the size of the role, or drawing a kind at another size than its measure, makes it fail: try both and say what failed.
4. The room of a line and the longest item are two numbers (112 and 110, two characters being kept for the separator). The titles and the steps say which one they mean: an item as long as the longest item is drawn on a line of its own; an item one character longer is refused; the outline row of the item names the longest item, not the room of the line, or names both. No title says a thing the code contradicts.
5. The scenario of the token shows both halves: the name of the variable appears, and the template of its value does not.
6. The scenario of the command: the snapshot of the temporary copy lists directories as well as files and compares what identifies a write (not only the content), so that « exactly one file was written » is literal: a new empty directory, or a file rewritten with the same bytes, is seen.
7. The comment of the font family says exactly what was measured: which families, what the generic family resolved to in the render, and that the first family of the list was not measured, by name.

Regenerate, render both images and look at them; recount the suite the way the README says it is counted.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `npm run diagram:isolation` run twice: no change the second time.
- [ ] `CLAUDE.md` differs from `HEAD` by the line of the command only.
