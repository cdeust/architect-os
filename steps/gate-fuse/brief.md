# Step: the first run of the mutation tool gets an explicit bound

On 18 November 2026 `npm run gate` turned red on a commit whose scenarios were all green: Stryker's initial test run, which plays the whole `mutation` profile once before any mutant, « timed out ». Its bound was never set: the tool's default is 5 minutes (`dryRunTimeoutMinutes`, `node_modules/@stryker-mutator/api/dist/src-generated/stryker-core.d.ts`). The suite has grown to 2,896 scenarios; measured on the host that day, that first run took between 4 minutes 9 seconds and 4 minutes 49 seconds, and the same scenarios played by cucumber alone took 5 minutes 35 seconds. A default nobody chose was reached silently.

Do this, and nothing else:

1. `stryker.config.mjs`: set `dryRunTimeoutMinutes` to 20, with a comment that says what it is: a fuse against a first run that never ends, not a way to manage the duration of the suite; it is set explicitly so that the suite cannot outgrow a default without anyone deciding; the measures above and the date; journal §101.
2. The scenario of `features/descriptive/` that reads the committed Stryker configuration (find it with `git grep -n "the committed Stryker configuration"`): add a scenario, with a step in the file that holds the others, that the configuration gives the first run an explicit bound of 20 minutes. A broken copy is not needed: the step compares the value.
3. `docs/testing.md`: one sentence where the gate and Stryker are described: the first run has an explicit bound of 20 minutes, and why.

## Not in this step

Everything else: `docs/design/`, the root `README.md`, `CLAUDE.md`, `tools/`, `packages/`, `.github/`, `cucumber.mjs`. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive`: green; give the count.
- [ ] No file changed outside `stryker.config.mjs`, the feature and the step file of point 2, and `docs/testing.md`.
