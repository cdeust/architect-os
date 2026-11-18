# Step G.1, eighth pass: two points of accuracy left by the review of the seventh

The earlier passes are in the worktree (`steps/git-env-a/` to `steps/git-env-g/`: read the brief of the sixth, it still holds). All checks of the seventh pass were green and its review found no defect in the code. Since then the maintainer has updated what was his: the root `README.md` (the point has left the roadmap), `docs/diagrams/isolation.svg`, `CLAUDE.md`, the design note, `docs/testing.md` (the literal check is named where it lives) and the comment of `cucumber.mjs`. Two points of the review remain. Do them, and nothing else.

1. `tools/test-gate/src/infrastructure/git.ts`: the comment that names this file as the only process launch of the tool, a named exception of the rule `child-process-only-in-sandbox`, sits on `git()`, which no longer starts the process itself: `execFileSync` is in `gitWithOptions`. Put the comment where the launch is, and say on `git()` that it goes through it with the two options the gate always gives.
2. `tools/test-gate/features/closed-environment.feature` and `tools/test-gate/features/steps/repository.ts`, the twin of the scenario on `core.fsmonitor`: it runs `diff <first parent>`, while the gate runs `diff --unified=0 --no-renames --no-color --no-ext-diff <first parent>`. Give the twin the gate's exact arguments, less only the two options, so that the only difference between the scenario and its twin is the one the twin is about; and read the first parent through a named assertion instead of a cast.

## Not in this step

Everything else. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay tools/test-gate/features features/descriptive`: green on what your sandbox can run; give the count.
- [ ] No file changed by this pass outside `tools/test-gate/src/infrastructure/git.ts` (comments only), `tools/test-gate/features/closed-environment.feature` and `tools/test-gate/features/steps/repository.ts`.
