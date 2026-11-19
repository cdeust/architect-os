# Step W.0, closing pass, second try: the six points of the review

The pass before is in the worktree (`steps/runtime-root-0g/`: read its brief, it still holds). Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md` (the first changed again after the review: read the section « Un constructeur d'un autre fournisseur » once more, its two trials are now played by a bench before step B.1); the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).

1. `README.md`: the count of the suite. The feature added by this change has 26 scenarios. Count the suite the way the README says it is counted (a dry run of the default profile over its paths) and write the number you obtain; then search the README for every other place that states this count or a count derived from it, and correct each. A dated entry of a journal is not corrected.
2. `README.md`, the point on one copy of the dependencies: it follows the place to write (the store lives under the runtime root and its form is chosen with the hard capacity), not the gate under the sandbox; and it names the cases the seventh measure covers (a replaced folder, an absent store, a damaged store, an install interrupted before its publication).
3. `README.md`, the point on a builder of another provider: say what the design says: two trials played by a bench outside production before any production code, the first on a fake local upstream, the second one real request that needs the owner's consent; then the order B.1 to B.4.
4. `docs/diagrams/isolation.svg`: its description introduces the root before it speaks of what is under it.
5. `docs/diagrams/orchestration-loop.svg`: the description says where the box of the other builder sits and how it joins the build phase, as drawn; or move the box above the phase it joins if that reads better: render and look.
6. `docs/diagrams/isolation.svg`, the row of the builder says the profile writes only its worktree and the git data. `packages/sandbox/profiles/builder.json` also opens the cache directory of the home, the configuration and the temporary directory of the session for writing. The diagram says what the profile opens today, exactly; the box of the place to write, marked `next`, says what will replace it. Check the other rows of that diagram against their profile files the same way and correct any that understates what a profile opens; say what you compared.

Render each changed diagram and look at it; if your sandbox cannot render, say so plainly and list what you checked in the source.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive`: green; give the count.
- [ ] The whole README read once more: no count, state or command that the tree contradicts.
