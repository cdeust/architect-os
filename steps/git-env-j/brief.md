# Step G.1, tenth pass: the two mutants the host's mutation run left alive

The earlier passes are in the worktree (`steps/git-env-a/` to `steps/git-env-i/`); the review of the ninth accepted the change. The host then played the mutation tool on the production lines of the step: 59 mutants, 2 survived, both in `closedEnvironment` of `packages/sandbox/src/tree-fingerprint.ts`.

```
Survived tree-fingerprint.ts 30 StringLiteral        'LC_ALL' -> ""
Survived tree-fingerprint.ts 34 ConditionalExpression  if (value !== undefined) -> if (true)
```

1. The name `LC_ALL` can be emptied without any scenario noticing: the scenario on the names the fake git received runs with the names the process happens to have, and `LC_ALL` is not among them. The gate has the proof the fingerprint lacks (`tools/test-gate/features/closed-environment.feature`: « the six names of the list that the process set are received », after a Background that sets the six). Give the fingerprint the same: a scenario of `packages/sandbox/features/tree-fingerprint.feature` where the process has the six names set, and each call of the fake git received exactly those six, and `GIT_INDEX_FILE` where it is due. Use the step that sets a variable of the process from `features/steps/`, which restores it.
2. The condition is equivalent: node leaves out of the environment of a child a name whose value is `undefined`, which is what the gate's `closedEnvironment` relies on and says in its comment (`tools/test-gate/src/infrastructure/git.ts`). Give the fingerprint's function the same form as the gate's, with the same sentence in its comment, so that the two functions that hold the same list read the same. The scenarios with a name unset in the process must still pass.

Then break each of the six names in turn, and the loop, and check that a scenario fails each time; restore; say so in the report.

## Not in this step

Everything else. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features/tree-fingerprint.feature packages/sandbox/features/tree-fingerprint-fresh.feature features/arch/closed-git-environment-text.feature`: green; give the count.
- [ ] No file changed by this pass outside `packages/sandbox/src/tree-fingerprint.ts`, `packages/sandbox/features/tree-fingerprint.feature` and its step file.
