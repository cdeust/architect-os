# Step G.1, second pass: two scenarios that prove nothing, named by the first pass itself

The first pass (`steps/git-env-a/`: read its brief, it still holds) built everything. It was stopped before its review by a check of the step file, not by its code: the maintainer had put `features/arch` among the scenarios of the check, and the architecture guard writes fixture files in the worktree, which the sandbox of a check cannot do. That is corrected in the step file of this pass; the host replays `features/arch` itself.

One thing to do, from the report of the first pass: « two of the three fingerprint scenarios would not catch a leak ». The first brief asked for them; it was wrong to.

1. In `packages/sandbox/features/tree-fingerprint.feature`, the scenario with `GIT_INDEX_FILE` of the process pointing at a file: the calls on the temporary index set their own, and the others read no index, so a leak changes nothing. Remove it, and whatever step only it uses.
2. The scenario with `GIT_CONFIG_COUNT=1` and `core.excludesFile`: the option `-c core.excludesFile=/dev/null` wins over an injected configuration, so a leak changes nothing. Replace it by one a leak would break: with `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=core.bare`, `GIT_CONFIG_VALUE_0=true` in the environment of the process, the fingerprint is still the one of the worktree (with the leak, git refuses to work in a tree it is told is bare, and the fingerprint throws). Check, by breaking the closed list for a moment, that this scenario fails, and say so in the report.
3. If the same holds for a scenario of `tools/test-gate/features/closed-environment.feature` or of `tools/deliver/features/` (a poison that could not change the outcome even when it leaks), say which in the report and re-aim it the same way; if none, say none.

## Not in this step

Everything the first brief excluded. Production files are not touched by this pass. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features/tree-fingerprint.feature tools/deliver/features tools/test-gate/features features/descriptive`: green; give the count.
- [ ] A scenario that sets a variable of the process restores it at its end.
