# Step W.0, closing: the two proposals of the review that accepted the change

The pass before is in the worktree (`steps/runtime-root-0r/`: read its brief). Its review accepted the change and left two proposals; the maintainer takes them. Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`). Change nothing else than what these two points need.

1. `features/support/isolation-rows.ts`, the comment on the longest item still says an item one character longer would run past the border. The reason is the one the title of the scenario now gives: with the separator that may follow it, the line would pass its room. Search the support file, the step file and the feature for any other statement of that reason and give it the same wording; list the places.
2. `docs/testing.md`, the paragraph of this feature lists its poisoned copies: it names the refusal of a `font-family` or a `font-size` set on a `tspan` of a copy of the produced markup. Then compare the paragraph with the titles of the scenarios of the feature, one by one, and say in the report that each title is covered and nothing more is claimed.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch/isolation-diagram.feature features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
