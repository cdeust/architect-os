# Step W.0, closing: the seven points of the review of the measured texts

The passes before are in the worktree (`steps/runtime-root-0n/`, `-0o/`: read both briefs). Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`). The maintainer takes the seven points; none is left for later.

1. `features/arch/isolation-diagram.feature` says of the hand-drawn picture that it states nothing of what a profile opens. No scenario backs it, and it is not true: the box of Claude Code names two profiles and gives them a session token and their own folders, and an arrow says what they reach. The sentence becomes what it is: a statement read by the reviewer of each change, like the one after it; and the feature says exactly what the tripwire refuses (a template string, a host of a network list) and nothing more. Read every sentence of the feature once more: each is either shown by a scenario, named by its title, or marked as read by the reviewer.
2. `features/support/isolation-rows.ts`: every text the function writes carries the size it is measured with (the role takes it from its own attribute, not from the group around it); and the constants (the names of the profiles, the labels of the lists) are measured against their columns like any other text, so that a longer name is refused and not drawn over the next column.
3. The scenarios show that the image itself passes each kind of text through the measure with its own kind: for the title, the subtitle, the header and the role, a scenario gives the function a text of that kind too long for its room (through the entry the function offers for it, or a parameter added for the cases if the texts are constants) and the production of the image is refused. Replacing `fit(TITLE, 'title')` by an escape alone, or by the kind of an item, must make a scenario fail: try it and say what failed.
4. One value for the room of an item, used by the outline and by the list scenarios; the scenario of a long item shows that the item is drawn and sits on a line of its own.
5. The scenario of the command lists the whole temporary copy, the directory of the profiles included, and shows that exactly one file was written.
6. The comment of the font family names the families the list holds; if the factor was measured for one family, the comment says which, and what the others give or that it was not measured for them.
7. `CLAUDE.md`: confirm once more that the only difference against `HEAD` is the line of the command.

Regenerate, render both images and look at them; recount the suite the way the README says it is counted.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `npm run diagram:isolation` run twice: no change the second time.
