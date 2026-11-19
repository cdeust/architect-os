# Step W.0, closing: the three proposals of the review that accepted the change

The pass before is in the worktree (`steps/runtime-root-0q/`: read its brief). Its review accepted the change and left three proposals about the scenarios of the generated image; the maintainer takes them. Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`). Change nothing else than what these three points need.

1. `features/arch/isolation-diagram.feature`, the scenario of the item one character longer than the longest: its title says the item is refused « not drawn past the border », which is true only when another item follows it. The title says the reason exactly: the item is refused because, with the separator that may follow it, the line would pass its room. The two numbers (the room of a line, the longest item) stay apart in every title and step.
2. `features/steps/isolation-diagram.ts`: the step of that refusal pins the length of the refused item (the longest item plus one), so that the refusal of another item cannot make the scenario pass.
3. The check of the family reads the attributes of the `text` elements only: a family set on a `tspan` would pass unseen. The scenario also refuses a `font-family` or a `font-size` on a `tspan` of the produced image; show it on a copy of the produced markup with one added.

Regenerate if the function changed, render the generated image and look at it; recount the suite the way the README says it is counted if a scenario was added.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `CLAUDE.md` differs from `HEAD` by the line of the command only.
