# Step R.1b, second pass: what stopped the first, and two gaps the first named itself

The first pass (`steps/briefs-b/`: its brief and its record are in the worktree; read the brief, it still holds) did its three corrections, and its check `scenarios` then stopped the step before any review. This pass repairs what that check found and closes two gaps the build report of the first pass named. Change nothing else.

## 1. What the check found

`features/descriptive/doc-paths.feature`: `docs/testing.md` cites `steps/x` between backticks. Now that the folder `steps/` exists in the repository, that is read as a path of the repository, and it does not exist. Reword that cell of `docs/testing.md` so that it says the same thing without citing a path that does not exist. Look for any other path under `steps/` cited by the documents that scenario lists (`CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `SECURITY.md`, the files of `docs/` it names): a placeholder such as `steps/<name>/` is not a path and stays.

## 2. The gate rule: a tracked file

`features/steps/steps-folder.ts` lists what git could commit with `--cached` and `--others`. No scenario tracks a file, so nothing proves `--cached`. Add scenarios on a copy that is a repository: a valid step folder that is added and committed is judged (it follows the rule); the same folder, committed, then its brief edited on disk, is refused with the reason that exists (`demo: brief.md is not the file the record hashed`).

## 3. The gate rule: a path git lists that the disk no longer holds

A tracked step folder, or a tracked file of one, removed from the disk and not yet from the index, is still listed by git: the rule must answer with a reason and never throw. A whole folder: `<name>: is not a directory`. A file of a folder: the reason that exists for a missing file (`<name>: <file> is missing`), or `<name>: <file> is not a regular file` when it is not one of the expected files. One scenario for each.

## Not in this step

Everything the first brief excluded, except `docs/testing.md` for point 1. Nothing is written under `steps/` of this worktree by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features features/descriptive`: green; give the count.
- [ ] The seventeen broken copies still pass, their reasons word for word.
- [ ] A scenario that writes does so only under a temporary directory it removes.
- [ ] No file changed outside `docs/testing.md`, `features/steps/steps-folder.ts` and `features/descriptive/steps.feature`.
