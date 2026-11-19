# Step W.0, closing: the two places the search of the pass before missed

The pass before is in the worktree (`steps/runtime-root-0w/`: read its brief, which holds the rule: the reason two areas are outside the mutation profile is written once, in the comment of `cucumber.mjs`, and every other place points to it). Its review found two places that still state a reason of their own. Not to be touched: `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`). Change nothing else than what this needs.

The maintainer searched the tracked and untracked files of the tree, outside `steps/`, the two journals and `docs/design/`, for the words « mutation profile », « kill no mutant », « cannot detect a mutant », « instrumented » and « in-process ». Two places state a reason; both point to `cucumber.mjs` and state none:

1. `docs/testing.md`, the list item of the closed environment of git that speaks of `features/arch/closed-git-environment-text.feature` (near line 116): « it reads the text of production files, so it cannot be in the mutation profile, which plays on instrumented copies ». It says where the feature is and that the mutation profile leaves its area out, with the pointer; no reason.
2. `features/steps/cucumber-profiles.ts`, the comment near line 58: « Areas that execute no production line in-process: they cannot detect a mutant ». False for `features/arch` since this delivery (one of its features calls the loader of the profiles). The comment says what the constant is (the two areas the mutation profile leaves out) and points to `cucumber.mjs`.

Then run the same search yourself, with those five expressions and any other wording of the same reason you can think of (« on the copy », « sandbox copy », « fails by design », « no production line »), over the same files, and paste the result in the report with, for each hit, one of: the one place (`cucumber.mjs`), a pointer, or not about this reason. A hit that is none of the three is corrected.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
