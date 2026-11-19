# Step W.0, second pass: a guard that is total, and what the first pass left

The first pass is in the worktree (`steps/runtime-root-0/`: read its brief, it still holds). Its review refused it. Not to be reported nor touched: `bench/deps-store/` and `steps/deps-measure-*` (another step); the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (it is the step `steps/deps-measure-e/`, whose brief explains it); the maintainer's changes to `docs/design/orchestration-fable-5-2.md`.

1. **The guard reads text for « a command to run », and misses most ways of writing one** (an environment assignment before the command, an argv array, `time docker`, `npx colima`, `docker-compose`). A pattern over prose cannot be complete: replace the rule, do not extend the pattern. The rule that is total: a command is started either by a script of a `package.json` or by a file that can start a process. So:
   - no script value of the root `package.json` nor of `bench/package.json` contains `docker` or `colima`, in any case, anywhere in the value;
   - under `baseline/` and `bench/` (outside `node_modules`, `results/`, `reports/`), the files that import `node:child_process` (or `child_process`), by a static import, a dynamic import or `require`, are a closed list written in the feature; a file outside the list that imports it is refused; and no file of the list contains `docker` or `colima`, in any case.
   Markdown and result files may name them: they run nothing. The Examples of the poisoned copies hold the five forms the review found and one for each branch of the rule (a new file that imports `child_process`, a listed file that names `docker`, a script with an assignment before the command). The feature stays under `features/arch/`. Remove the pattern and its step; step text unique across the repository.
2. `features/support/srt-platform.ts`: `runnerOptions` was imported only by the removed program; it is no longer exported if nothing else imports it (check, and say).
3. `docs/design/platform-v3-srt.md`, the paragraph « Hors de 1b.6 » says in the present that measure A keeps its Docker configurations and that `baseline/overhead.ts` builds its own image. It is a design document, not a journal: write what is true today in that sentence (the program left the tree on 19 November 2026 with the decision of `orchestration-fable-5-2.md`, « Un seul lieu d'écriture » ; its results stay in `baseline/results/` ; the hash that holds it). Look in `docs/` (outside `docs/design/journal.md`) for any other sentence in the present that says the program exists, and correct it.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch/no-container-command.feature features/descriptive`: green; give the counts, and show for each Example of a poisoned copy that it is refused for its own reason.
