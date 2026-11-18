# Step R.1b: three corrections found by a review of the maintainer's own change

The worktree holds an uncommitted change written by the maintainer after commit `93c1c66` (journal §99): the root of the worktree taken from `resolveWorktree`, inputs read as valid UTF-8, `modelUsage` read as pairs, a gate rule that does not judge what git ignores. A review session that did not write it found three defects in it. Correct them; change nothing else of that change. Design: `docs/design/orchestration-fable-5-2.md` §14, « Étape 1, les consignes d'étape dans le dépôt », with « Précisé à la construction ».

## 1. A step is launched from the root of its worktree, or refused

Today the fingerprint and `steps/` are taken at `resolveWorktree(cwd).worktree`, while the reading of the files a scout quotes (`readSource`), the checks and the sessions still use the launch directory `cwd`. A step launched from a directory below the root would give other checks and other verified facts from the same commit and brief, and the record does not say where it was launched from: it could not be replayed from the repository alone.

Decision of the maintainer: one rule, in one place. A step whose launch directory is not the root of a linked worktree is refused before any session, and before the name of the step is looked at in `steps/`. Launching from below the root is not supported.

- `StepDependencies` gets one dependency that gives the root of the worktree the step runs in, and throws when the launch directory is not that root (the real one: `resolveWorktree(cwd)`, whose `SandboxError` goes through as it is when `cwd` is in no linked worktree; when `cwd` is inside a linked worktree but is not its root, a refusal in French that names both paths). `runStep` calls it first, after the reading of the step folder.
- The real `fingerprint` and the real `stepsFolder` take that same root. Nothing else resolves the worktree a second time.
- Scenarios, with the real dependencies on the real linked worktree of `repoOf` (`packages/sandbox/features/steps/runner.ts`): from the root, as today; from a directory below the root, the refusal, and nothing created under that directory nor under the root; from a repository that is not a linked worktree, the `SandboxError`. With the in-memory dependencies in `step-tool.feature` or `step-record.feature`: a root that throws is exit 2, no session started, nothing published, the fingerprint not taken, `steps/` not prepared. Remove the scenario « launched from a directory below the root, the step still fingerprints and publishes at the root of the worktree » and the step that only it uses.

## 2. Only a text that is not valid UTF-8 is called so

`readText` (`packages/sandbox/src/step-tool.ts`) wraps the reading of the file and its decoding in one `try`: an input that cannot be read (a permission, an entry that changed between the check and the reading) is reported as `… n'est pas de l'UTF-8 valide`. The reading must fail with its own cause, as it did before; only the decoding may become that refusal. Keep the byte order mark. If no scenario can show a read error without depending on the user the suite runs as (the suite also runs as root), write none and say so in the report: do not write a scenario that passes or fails depending on the user.

## 3. The gate judges what git could commit under `steps/`, and nothing else

`features/steps/steps-folder.ts` lists the ignored files with `git ls-files --others --ignored --exclude-standard` and skips an entry only when its whole name is in that list. A directory that the repository ignores (`node_modules/`, `dist/`) is never listed as such: it is still judged, and an empty ignored directory too. And `--exclude-standard` reads the exclusion file of the host, which the fingerprint deliberately does not read.

Turn the rule round: inside a repository, the entries of `steps/` are the paths git could commit, `git -c core.excludesFile=/dev/null ls-files --cached --others --exclude-standard -z -- steps` (tracked, and untracked that the rules of the repository do not ignore). A step folder is a first component of those paths; its files are the second components; a path with a third component is a file in a subdirectory, refused as today (« is not a regular file » for the entry that should be a file, « is in excess » for another). What git ignores, and an empty directory, do not appear, so they are not judged. Outside a repository (the copies of the scenarios that are not one), the entries are those of the disk, as today. Keep the reasons the scenarios expect, word for word.

Scenarios in `features/descriptive/steps.feature`, on a copy that is a repository ignoring `.DS_Store` and `node_modules/`: an ignored file beside the folders and inside one; an ignored directory with a file in it, beside the folders and inside one; an empty directory beside the folders; a file that is not ignored, still refused; an exclusion file of the host that names `notes.md` does not hide `demo/notes.md` from the rule (set `GIT_CONFIG_GLOBAL` for the scenario, as `packages/sandbox/features/steps/tree-fingerprint.ts` does). The seventeen broken copies still pass, unchanged.

## Not in this step

`docs/`, the root `README.md`, `CLAUDE.md`, `.dependency-cruiser.cjs`, `features/arch/`, `features/sandbox/`, `.github/`, `tools/`, `packages/sandbox/src/measure.ts`, `tree-fingerprint.ts`, `step-record.ts`, `steps-folder.ts` beyond what point 1 needs. Nothing is written under `steps/` of this worktree by a scenario or by hand: the host writes this step's own folder there when it ends.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features features/descriptive`: green; give the count.
- [ ] No literal that Stryker can mutate at module level; functions are `function` declarations; no `// Stryker disable`; no branch no scenario plays; no `catch` that returns what falling through returns; no argument whose absence changes nothing.
- [ ] A scenario that proves a refusal to write writes only under a temporary directory it removes.
- [ ] The report says, for each production line added or changed, which scenario would fail if it were broken.
- [ ] No file changed outside `packages/sandbox/src/step-tool.ts`, `packages/sandbox/src/steps-folder.ts` if point 1 needs it, `packages/sandbox/features/`, `features/steps/steps-folder.ts` and `features/descriptive/steps.feature`.
