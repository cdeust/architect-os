# Step G.1, fourth pass: the expectation of the gate scenario, without a second way to start git

The earlier passes are in the worktree (`steps/git-env-a/` to `steps/git-env-c/`: read their briefs, they still hold). The third pass did what it was asked and was stopped by the check `architecture`, before its review:

```
error child-process-only-in-sandbox: tools/test-gate/features/steps/repository.ts → child_process
```

The third brief offered two ways to compute what the scenario of `tools/test-gate/features/closed-environment.feature` expects: before the poison is set, or with a helper that drops the `GIT_` variables. The second was the maintainer's mistake: in `tools/`, a process is started from the named files of the rule and from nowhere else (`.dependency-cruiser.cjs`, rule `child-process-only-in-sandbox`), and the steps of a tool are under that rule too. The rule is not to be changed.

Do this, and nothing else:

1. In `tools/test-gate/features/steps/repository.ts`, remove the helper `cleanGit` and the import of `node:child_process`. The scenario records what it expects (the head, the first parent and the diff of the gate's own repository) through the production `git` of `tools/test-gate/src/infrastructure/git.ts`, in a step that runs **before** the step that sets `GIT_DIR`; the steps that compare use what was recorded. Order the steps of the scenario in the feature accordingly, and say in the text of the scenario that the expectation is taken before the poison.
2. Keep the second repository with its two commits.
3. Check again, by breaking the closed list of `tools/test-gate/src/infrastructure/git.ts` for a moment (add `GIT_DIR` to it), that the scenario fails; restore the list; say so in the report, with the step that failed.

## Not in this step

Everything the first brief excluded. Production files are not changed by this pass. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay tools/test-gate/features features/descriptive`: green; give the count.
- [ ] No file changed by this pass outside `tools/test-gate/features/closed-environment.feature` and `tools/test-gate/features/steps/repository.ts`.
