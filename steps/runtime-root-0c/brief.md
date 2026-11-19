# Step W.0, third pass: the four points of the review of the second

The two earlier passes are in the worktree (`steps/runtime-root-0/`, `steps/runtime-root-0b/`: read both briefs, they still hold). Not to be reported nor touched: the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`, whose brief explains it); the maintainer's changes to `docs/design/orchestration-fable-5-2.md`. The directory `bench/deps-store/` that the second pass saw has left the tree: it is no longer part of anything.

1. `README.md`, the table of proofs: a cell still tells the reader to reproduce the overhead figures with the removed script. It points to what exists: the analysis of the kept results (`npm run baseline:overhead-analyze`), and the hash of the last commit that holds the program which produced them. Then read the whole README once more: nothing says the container benchmark can be run.
2. The guard claims more than it checks: « a file that can start a process » is implemented as « a file whose text quotes `child_process` ». A file of `baseline/` or `bench/` also starts a process when it imports a launcher: the runner of `@architect-os/sandbox`, or an exported function of a listed file that starts one. Make the definition the rule, not the claim softer: the closed list holds every file of `baseline/` and `bench/` that starts a process by any of these ways (the Node module, a `process` function that replaces the process, the sandbox package, an import from a listed file); a file outside the list that does one of them is refused; no listed file names `docker` or `colima`. Say in the feature, in one sentence, what the rule still cannot see (a command built at run time from data), and that nothing in the gate nor the CI runs these two directories.
3. The list is closed in both directions: a listed file that does not exist, or that no longer starts a process by any of the ways above, is refused. Remove from the list any entry for a file that is not in the tree.
4. `cucumber.mjs`: the comment that explains why `features/arch` is outside the mutation profile names every feature there that reads the text of files, or states the rule without naming one.

Examples of poisoned copies: one for each way of point 2, one for each direction of point 3. Step text unique across the repository.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch/no-container-command.feature features/descriptive`: green; give the counts, and show for each poisoned copy that it is refused for its own reason.
