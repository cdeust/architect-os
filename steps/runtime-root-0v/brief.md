# Step W.0, closing: two decisions of the maintainer on what the last pass wrote

The pass before is in the worktree (`steps/runtime-root-0u/`: read its brief and its report). Its review refused it on a false reason it wrote in two places, and questioned a renaming. Not to be touched: `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md` (the maintainer corrected them by hand); the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`). Change nothing else than what these two points need.

## 1. Why three features of `features/arch` are outside the mutation profile: one reason that is true for each

The comment of `cucumber.mjs` and the paragraph of `docs/testing.md` now say that `no-container-command.feature` reads files « none of them instrumented ». False: its step lists every file git tracks or would track and reads each, production sources included, among them the three files the sentence before calls instrumented. Do not patch the sentence; establish the facts, then write them once:

- for each of the three features (`closed-git-environment-text`, `no-container-command`, `isolation-diagram`): what it reads (from its step file), whether it executes a production line in process (from its step file: an import of production code that the scenarios call, or none), and what would happen on the copy the mutation tool plays on (from `stryker.config.mjs` and the comment above: instrumented, unformatted sources);
- the reason each is outside the mutation profile is the one these facts give: a feature that executes no production line can kill no mutant; a feature that reads the text of instrumented sources would judge a text that is not the text of the tree. Say which applies to which, and for `isolation-diagram.feature`, which does call production code (the loader of the profiles), say exactly what that means for the profile (read `features/descriptive/cucumber-profiles.feature` and the earlier passes: was the loader's coverage by mutation decided, and where is it covered?). If the facts show that one of the three should be in the mutation profile, say so in the report and do not move it: that is a decision for the maintainer.
- `cucumber.mjs` holds the reason in at most four lines; `docs/testing.md` in one or two sentences; both say the same.

## 2. « committed » or « worktree »: the convention of the repository, defined once

The pass before renamed a shared Given from « the committed file » to « the file of the worktree » in two features, which leaves the Then steps and an outline title of the same feature saying « committed »: one scenario, two words. The maintainer's decision: the word of the repository stays. `CLAUDE.md` says every descriptive file has a scenario that « loads the committed file », and the features use the word throughout (count them). It means the file as it stands in the tree the suite runs on: in the gate, the checkout of the commit. So:

- restore the step texts and the titles the pass before changed for that reason, in both features, to the wording of `HEAD` where a text existed at `HEAD`, and to the same word for the texts this delivery added;
- define the word once, in `docs/testing.md`, in one sentence, where the conventions of the scenarios are described: « committed », in a title or a step, is the file as it stands in the tree the suite runs on; in the gate that is the commit, on a workstation it is the working tree, and a scenario that needs the difference says so.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `git diff HEAD -- features/arch/closed-git-environment-text.feature features/steps/closed-git-environment-text.ts`: what remains changed against `HEAD`, line by line, in the report, with the pass that asked for each.
