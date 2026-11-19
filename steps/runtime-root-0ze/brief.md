# Step W.0, closing: one claim in two comments, brought back to what was observed

The pass before (`steps/runtime-root-0zd/`) brought a sentence of the unpublished section 104 of the journal back to what was observed; its review accepted it and found the general claim the maintainer had dropped still written in two code comments. The same claim is corrected in every place it is made.

The claim: the global temporary directory is one « which a sandbox may not write ». What was observed is narrower: on 18 November 2026, the check of a step, played under the profile of the checks, was refused the creation of a directory there (the brief of `steps/deps-measure-e/` quotes the error). Which paths the engine opens of itself is still to be established by a trial: the design of the place to write says so (`docs/design/orchestration-fable-5-2.md`, « Un seul lieu d'écriture », the sentence « À contrôler par un essai »).

## What to do

1. `features/steps/closed-git-environment.ts`, the comment near line 12, and `tools/deliver/features/steps/command.ts`, the comment near line 272: each says why the child receives `TMPDIR`. Write what is true and no more: without it the tool the child loads falls back on the global temporary directory of the machine, where a check played under the profile of the checks was refused a write; with it the child writes where the process is allowed to. Keep each comment as short as it is.
2. Search the tree, outside `steps/`, the two journals and `docs/design/`, for any other statement that a sandbox cannot write the global temporary directory, or of what the engine opens of itself (« may not write », « cannot write », « /tmp »), and paste the hits in the report with, for each: says the observation, says more than the observation (then correct it), or about something else. Do not touch the profile files, the journal nor `docs/design/`.

Touch nothing else.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx tsc -p tools/deliver --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive`: green; give the count. (Run it yourself.)
- [ ] `git status --short` before and after, in the report.
