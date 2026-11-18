# Step G.1, sixth pass: what the mutation and the invented inputs found

The earlier passes are in the worktree (`steps/git-env-a/` to `steps/git-env-e/`, and `steps/git-env-fresh/`, a session that only wrote three files of invented scenarios: `packages/sandbox/features/tree-fingerprint-fresh.feature`, `tools/test-gate/features/closed-environment-fresh.feature`, `tools/deliver/features/environment-fresh.feature`). The design is `docs/design/orchestration-fable-5-2.md` §14, « Un environnement fermé pour git : conception »; read its last table, « Décidé après les entrées inventées »: it decides, this brief places the work.

The host played the mutation tool on the production lines of this step: 58 mutants, 11 survived, all in `closedEnvironment` of `tools/test-gate/src/infrastructure/git.ts` (each name of the list, the body of the loop, its condition). The scenarios prove what the gate's git does not receive, never what it receives. And three of the 73 invented scenarios fail on the host, as their author announced: the schema of `environment` accepts `LD_PRELOAD` and `DYLD_INSERT_LIBRARIES`, and `closedEnvironment` of the delivery gives a name that every object answers (`constructor`).

## 1. The schema of `environment` admits a closed set of names (`tools/deliver/`)

The key `environment` of `deliver.json` is a list of 1 or more names, no name twice, each taken from a closed set built inside a function: `PATH`, `HOME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR`, `SSH_AUTH_SOCK`, `XDG_CONFIG_HOME`, `GH_TOKEN`, `GITHUB_TOKEN`. Any other name is refused, whatever its form. The expression on the names, the `GIT_` test and the bound of 32 go: the set says it all. Update `config.feature`. In `environment-fresh.feature`, the scenarios that expected a name outside the set to be accepted (`GIT`, `Z_`, 32 names, and the like) no longer hold the contract: change their expectation to a refusal and say which in the report; the two on the loader variables now pass as written.

## 2. Only the own properties of the host environment count (`tools/deliver/src/infrastructure/host-process.ts`)

`closedEnvironment` takes a name only when the environment of the host has it as an own property. The invented scenario on `constructor` then passes as written.

## 3. The three launches give git the same options against a program it would start by itself

The fingerprint already passes `-c core.fsmonitor=false -c core.hooksPath=/dev/null`. The git of the gate (`tools/test-gate/src/infrastructure/git.ts`) and the git of the delivery (`tools/deliver/src/infrastructure/git-repository.ts`) pass them too, before the subcommand. Scenarios with real git: in the delivery, a `pre-push` hook of the throwaway repository that writes a witness file is not run by a delivery that pushes; in the gate, a repository whose configuration names a witness program as `core.fsmonitor` is read without that program running. Each with its twin that shows the witness does run when git is started without the options, so that the scenario can fail.

## 4. What the git of the gate receives

A scenario of `tools/test-gate/features/closed-environment.feature` puts a fake `git` first on the `PATH` of the process: an executable script the step writes in a temporary directory, with no process launch of its own (the rule `child-process-only-in-sandbox` holds for the steps of a tool), which records the names of its environment in a file and then answers what the gate's call needs. The names it received are exactly those of the list that the process had set; with one of them unset in the process, it is not received; with a name outside the list set (`GITHUB_TOKEN`, `NODE_OPTIONS`, `GIT_EXEC_PATH`), it is not received. This must kill the eleven survivors: say in the report, for each of the three kinds (a name, the loop, the condition), which scenario fails when it is broken, having broken it.

## 5. What the git of the delivery receives

A scenario of `tools/deliver/features/` with a recording fake git as the program of the adapter (the program is already injected): every call received exactly the names of the list of the descriptive file that the process had set, and `GIT_TERMINAL_PROMPT`; a name of the list that the process does not set is not received.

## 6. The two lists written twice stay the same

`features/arch/closed-git-environment-text.feature`: one more scenario, that the list of names of `packages/sandbox/src/tree-fingerprint.ts` and the one of `tools/test-gate/src/infrastructure/git.ts` are the same, read from the text of the two files; with a broken copy.

## 7. Two points of tidiness

- `tools/test-gate/features/closed-environment-fresh.feature` uses the step `the process has the variable {string} set to {string}`, defined in a step file of `packages/sandbox`. A feature of a component uses the steps of its own step files or of `features/steps/`: move that step, and the ones that go with it, to a file of `features/steps/` that both use.
- `tools/test-gate/features/steps/repository.ts`: the recorded state of the closed-environment scenario is checked for its shape, as `secondRepository` is checked with `instanceof`.

## Not in this step

`docs/design/`, the root `README.md`, `docs/diagrams/`, `CLAUDE.md`, `.dependency-cruiser.cjs`, `cucumber.mjs`, `stryker.config.mjs`, `.github/`, `features/sandbox/`: the maintainer. Nothing is written under `steps/` by a scenario or by hand. No scenario reads the text of a production file outside `features/arch/`.

## Documentation

`docs/testing.md`: what proves each of points 1 to 6.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features tools/deliver/features tools/test-gate/features features/descriptive features/arch`: green on what your sandbox can run; give the count, and name what cannot run there.
- [ ] No literal that Stryker can mutate at module level; functions are `function` declarations; no `// Stryker disable`; no branch no scenario plays; no argument whose absence changes nothing.
- [ ] A scenario that sets a variable of the process restores it at its end; a scenario that writes does so only under a temporary directory it removes; every new scenario can fail, and the report says what makes it fail.
