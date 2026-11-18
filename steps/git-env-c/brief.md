# Step G.1, third pass: what the review of the second left

The two earlier passes are in the worktree (`steps/git-env-a/`, `steps/git-env-b/`: read their briefs, they still hold). The review of the second asked for changes. Do these, and nothing else.

A decision of the maintainer first, which is not to be undone: the second brief asked for a poison `core.bare=true`. The build session tried it, found that a leak did not break it (git works in a discovered worktree whatever `core.bare` says in the environment), and replaced it by `core.autocrlf=input` on a file with CRLF line ends, which it checked by breaking the closed list for a moment: the scenario failed. The premise of the brief was wrong; the replacement stays.

1. `docs/testing.md`, where the closed environment of the fingerprint is described: it still lists the `GIT_INDEX_FILE` scenario and the `GIT_CONFIG_COUNT` scenario on `core.excludesFile`, which no longer exist, and says nothing of the scenario on `core.autocrlf` that replaced the second. Make it say what the feature files hold.
2. `packages/sandbox/features/steps/tree-fingerprint.ts`: a step that only the removed `core.excludesFile` scenario used is still defined, and `existsSync` is still imported and no longer used. Remove both, and anything else in that file that no scenario uses any more.
3. `tools/test-gate/features/closed-environment.feature` and its steps in `tools/test-gate/features/steps/repository.ts`: the expected head, first parent and diff are read through the production `git` while the poison `GIT_DIR` is set, so with a leak both sides would read the second repository and agree; the scenario fails on a leak today only because the second repository has a single commit. Compute what is expected before the poison is set, or with a helper that drops the `GIT_` variables as the fixtures of `packages/sandbox` and of `tools/deliver` do, and give the second repository two commits so that nothing rests on that accident. Check, by breaking the closed list of `tools/test-gate/src/infrastructure/git.ts` for a moment, that the scenario fails, restore it, and say so in the report.

## Not in this step

Everything the first brief excluded: the root `README.md`, `docs/diagrams/`, `docs/design/`, `CLAUDE.md` are the maintainer's, who updates them after this pass. Production files are not changed by this pass. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features/tree-fingerprint.feature tools/deliver/features tools/test-gate/features features/descriptive`: green; give the count.
- [ ] A scenario that sets a variable of the process restores it at its end.
- [ ] No file changed outside `docs/testing.md`, `packages/sandbox/features/steps/tree-fingerprint.ts`, `tools/test-gate/features/closed-environment.feature` and `tools/test-gate/features/steps/repository.ts`.
