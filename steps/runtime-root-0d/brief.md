# Step W.0, fourth pass: the guard changes its question

The three earlier passes are in the worktree (`steps/runtime-root-0/`, `-0b/`, `-0c/`: read the three briefs). Not to be reported nor touched: the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`); the maintainer's changes to `docs/design/orchestration-fable-5-2.md`.

## The decision of the maintainer

Three reviews in a row found a way to start a process that the guard does not see (a relative import of the sandbox, the agent SDK, the MCP stdio transport, a shell script, two listed files that justify each other). The guard asks « which files can start a process? », and that question has no closed answer in text: every pass adds a way and the next review finds another. The question changes. Remove the whole analysis of imports and of what starts a process, with its steps and its list.

The rule that is total over the text of the tree: **the words `docker` and `colima` (any case) appear in no file of the repository outside a closed list**. So:

- the files read are every file git tracks or would track (not ignored), of any type, shell scripts included;
- outside the rule, because they run nothing and tell what was measured or decided: Markdown files, the files under a `results/` directory, and `steps/`;
- every other file that holds one of the two words is in a closed list written in the feature, each entry with the reason the word is there (today, to check: `baseline/overhead-analyze.ts`, which labels the kept results; the three `.html` pages under `docs/`; `features/descriptive/doc-paths.feature` and `features/steps/doc-paths.ts`; the feature and the step file of this guard). Read each one and say in the report why the word is there; if one of them runs a container command, it is a finding, not an entry;
- the list is closed in both directions: a file outside the list that holds a word is refused, a listed file that does not exist or no longer holds a word is refused;
- no script value of the root `package.json` nor of `bench/package.json` holds a word: `package.json` is not in the list, so the first rule already says it; keep one scenario that names it, because it is the surface a reader runs.

The feature says in one sentence what a rule over text cannot see: a word assembled at run time. It claims nothing else. It stays under `features/arch/`.

Examples of poisoned copies: a new TypeScript file with the word in an argv array, a new shell script, a script of `package.json` with an assignment before the command, the word in upper case, a listed file emptied of the word, a listed file removed.

## Left by the third review

- `baseline/overhead-analyze.ts`, its header comment points to a protocol that is no longer in `baseline/README.md`: it points to where the protocol is.
- `docs/testing.md` names this guard next to the other feature of `features/arch` that reads the text of files.
- `README.md` and `baseline/README.md`: `be831caa7fbe` is the last commit that changes the program, not the last that holds it; say « the last commit that changes it » in both.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch/no-container-command.feature features/descriptive`: green; give the counts, and show for each poisoned copy that it is refused for its own reason.
- [ ] The step file holds no code left from the analysis of imports.
