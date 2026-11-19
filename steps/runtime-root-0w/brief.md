# Step W.0, closing: the reason the two areas are outside the mutation profile is written in one place

The pass before is in the worktree (`steps/runtime-root-0v/`: read its brief and its report, which holds the facts for each feature). Its review found the same reason stated in a third and a fourth place, with other words and, for one, falsely. Not to be touched: `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`). Change nothing else than what this needs.

## The decision of the maintainer

A reason written in four places drifts in four places. It is written **once**, in the comment of `cucumber.mjs` where the profile is defined, and every other place points to it and states nothing of its own:

1. `cucumber.mjs`: the comment says, from the facts the pass before established: the mutation profile is a scope by area, and the two areas `features/repository` and `features/arch` are outside it as wholes; then, feature by feature for `features/arch`, what each reads and whether it could kill a mutant (the guard of the architecture: a child process on fixture files, no production line in process; `closed-git-environment-text`: the text of three production files that the tool instruments, so on the copy it would judge another text; `no-container-command`: the text of every tracked file, no production line in process; `isolation-diagram`: five profile files and two images, and one production call, the loader of the profiles, which the mutation judges elsewhere, through `packages/sandbox/features/profile.feature`: this feature is outside only because its area is). The sentence on workers that collide on the fixture files says what is true today: the configuration runs one worker (`stryker.config.mjs`), and the collision is what happened when it ran several and would happen again if the number were raised. Keep it short and exact.
2. `stryker.config.mjs`: its comment says all of `features/arch` fails on the instrumented copy, which is false for one feature. It states no reason: it points to the comment of `cucumber.mjs`.
3. `features/descriptive/cucumber-profiles.feature`: its description gives one reason of its own; it says what the feature checks (that no area is forgotten by the profiles) and points to `cucumber.mjs` for why two areas are outside the mutation profile.
4. `docs/testing.md`: one sentence that says the two areas are outside the mutation profile and where the reasons are written; no restated reason.
5. Search the tree (`README.md`, `docs/`, `CLAUDE.md`, the features, the comments) for any other statement of why a feature or an area is outside the mutation profile; each points to `cucumber.mjs`. List the places in the report.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] The paths of the profiles in `cucumber.mjs` are the same as at `HEAD`: only comments changed; show the diff of the code lines, which must be empty.
