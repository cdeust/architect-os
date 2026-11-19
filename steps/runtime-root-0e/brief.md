# Step W.0, fifth pass: the four points of the review of the fourth

The earlier passes are in the worktree (`steps/runtime-root-0/`, `-0b/`, `-0c/`, `-0d/`: the brief of `-0d` holds the rule; read it). Not to be reported nor touched: the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`); the maintainer's changes to `docs/design/orchestration-fable-5-2.md`.

1. **A tracked symbolic link is a tracked file**: its content, for git, is its target. The step keeps only regular files, so a link whose target holds a word is never read. The step reads the target of a link as the text of that entry (it does not follow it), and the same rule applies: outside the closed list, refused. A poisoned copy shows it.
2. **The exclusions are by what the files are, said exactly.** Markdown, the files under a `results/` directory and `steps/` are left out because nothing in the repository runs them; a script that would give one of them to a shell is a way the rule over text cannot see. The one sentence of the feature that says what the rule cannot see names both: a word assembled at run time, and a file of an excluded kind given to an interpreter. Check that no script of the two `package.json` files and no workflow gives a file of an excluded kind to a shell or an interpreter, and say what you found.
3. **Each poisoned copy is refused for its own reason, inside its own scenario**: the Then steps assert the exact offending path (and for the closed direction, the exact entry), not that the set of offenders is non-empty.
4. **Three pages listed for prose still present containers as a fallback of the isolation**, against the two decisions (21 and 22: one means of isolation, srt) and against `docs/operating.md`: `docs/communication/deck/slides/isolation.html`, the legend of `docs/design/platform-v3-srt.html`, `docs/design/platform-v3.html`. They are pages of the design and of a deck, not journals. For each: read it whole, and write what is true today where it speaks in the present of what the platform does or can fall back on; where it tells the history of a decision, leave the history. If a page is entirely a dated record of the first realisation (say which, and on what you base it), leave it and say so in the entry of the list. A page that no longer holds a word leaves the list. Do not touch the diagrams of `docs/diagrams/`.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch/no-container-command.feature features/descriptive`: green; give the counts.
- [ ] For each of the three pages, the sentences changed, before and after, in the report.
