# Step G.1, seventh pass: a twin that proves nothing, a stale sentence, an unchecked state

The earlier passes are in the worktree (`steps/git-env-a/` to `steps/git-env-f/`: read the brief of the sixth, it still holds). All checks of the sixth pass were green; its review asked for these three changes. Do them, and nothing else.

1. `tools/test-gate/features/closed-environment.feature`, the twin of the scenario « the witness program named as core.fsmonitor is not run by the gate ». It calls the gate's own `git()`, options included, and adds `-c core.fsmonitor=<witness>` on the command line: it shows that git runs a witness given by `-c`, not that git runs the `core.fsmonitor` written in the configuration of the repository, which is the input of the scenario it is the twin of. If git ignored that configured value, the scenario would pass with or without the options, and the twin would still pass. Build it as the twin of the delivery is built: git started **without** `-c core.fsmonitor=false -c core.hooksPath=/dev/null`, on the same repository, reading the repository's own configuration, runs the witness. The steps of a tool start no process themselves (rule `child-process-only-in-sandbox`): reach git without the options through the production code in a way the scenario states plainly, for instance a function of `tools/test-gate/src/infrastructure/git.ts` that takes the options as a parameter, with the gate always giving the two; if you change production code for this, the gate's behaviour does not change, and you say in the report which scenario fails when the two options are dropped from the gate's own call. If the witness does not run even without the options on the git of this machine, do not bend the scenario: say so in the report, with what you observed.
2. `docs/testing.md`, the sentence on the schema of `environment` that still speaks of the bound of 32 names, of the expression on the names and of the `GIT_` test: the schema admits names of a closed set of ten, and the bullet further down says so. Make the document say one thing.
3. `tools/test-gate/features/steps/repository.ts`: `gateWitness` is cast without a check; a missing state would make « has not run » pass for the wrong reason. Check it as the other recorded states are.

## Not in this step

Everything the earlier briefs excluded. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay tools/test-gate/features features/descriptive`: green on what your sandbox can run; give the count.
- [ ] No file changed by this pass outside `tools/test-gate/features/closed-environment.feature`, `tools/test-gate/features/steps/repository.ts`, `tools/test-gate/src/infrastructure/git.ts` if point 1 needs it, and `docs/testing.md`.
