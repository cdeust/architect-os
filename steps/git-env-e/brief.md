# Step G.1, fifth pass: the literal check is read on mutated copies, and two small points

The earlier passes are in the worktree (`steps/git-env-a/` to `steps/git-env-d/`: read their briefs, they still hold). All checks of the fourth pass were green and its review found no defect in the code. The host then ran the mutation tool, which the loop cannot run, and its first run failed:

```
Rule: no production file that starts git gives process.env to a launch -- Scenario Outline: a copy of <file> …
AssertionError: the text does not hold { ...host, GIT_INDEX_FILE
```

The mutation tool plays the `mutation` profile of `cucumber.mjs` on a copy of the tree where the production files it mutates are instrumented: their text is no longer the committed one. A scenario that reads the text of a production file cannot be in that profile. That is why `features/arch` and `features/repository` are left out of it (`cucumber.mjs`, `stryker.config.mjs`). The first brief said « `features/arch/` or `features/descriptive/` »: only the first was right.

Do this, and nothing else:

1. Move the rule « no production file that starts git gives process.env to a launch » (its two scenario outlines) out of `features/descriptive/closed-git-environment.feature` into a feature file under `features/arch/`, with its steps where the steps of `features/arch` live or in the same step file, as fits what is there. The rule on the suite (the child `node` that imports the support file) stays in `features/descriptive/`. Each feature file says in its description what it holds and, for the one under `features/arch`, why it is there.
2. `tools/test-gate/features/steps/repository.ts`: the states of the closed-environment scenario are cast without a check, while `repository()` asserts with `instanceof GateRepository`. Read them through a named assertion, so that a missing step shows as an assertion and not as a `TypeError`.
3. `docs/testing.md`, the line on the closed environment of the gate: say what the scenario does now (the second repository has two commits; what is expected is recorded through the production git before `GIT_DIR` is set; the diff is checked too), and where the literal check lives.

## Not in this step

Everything the first brief excluded. Production files are not changed. `cucumber.mjs` and `stryker.config.mjs` are not changed. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive features/arch tools/test-gate/features`: green on what your sandbox can run; give the count, and name what cannot run there.
- [ ] No file changed by this pass outside `features/descriptive/closed-git-environment.feature`, `features/arch/`, the step files of point 1, `tools/test-gate/features/steps/repository.ts` and `docs/testing.md`.
