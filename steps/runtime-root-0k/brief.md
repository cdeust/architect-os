# Step W.0, closing: the four points of the review of the diagram check

The pass before is in the worktree (`steps/runtime-root-0j/`: read its brief, it holds the rule). Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).

1. `README.md`, « What comes next », the row of the place to write: step (1b) closes two things, and the row names only one. It says both, as the design does (« Ce que le constructeur peut écrire dans git »): the profiles write nothing in the home folder, and the builder no longer writes the shared object store, the refs nor the logs of the repository, proven on the real engine. Then check every other decision of the three designs of §14 against the rows of the roadmap, one by one, and list in the report the decision and the row that carries it; a decision without a row gets one.
2. The check can be passed around inside a row: only the last element of each list name is compared, and a template string of a row outside a list element is not read. Close both: a list name that appears twice in a row is refused; a template string (`${…}`) or a host anywhere in a profile row outside its list elements is refused; and the same for the description of the image where it carries lists. Poisoned copies for each.
3. `docs/diagrams/isolation.svg`: a comment of the source still says the arrow to the authentication proxy is the only route out, which the lists contradict for three profiles. No comment of the file states what a list states otherwise: correct or remove it, and read every other comment of the file the same way.
4. The rendered sentence about what a session holds (a token) is not one of the compared lists and is false for a worker (its token is accepted by the broker) and for a checker (it holds none). Either it becomes a list the scenario compares with the profile files (what each profile receives in its environment that is a token, by the name of the variable), or it is scoped to what is true and says so; choose the first if the profile files carry the fact, and say what you found.

Render the diagram and look at it; if your sandbox cannot render, say so plainly and list what you checked in the source.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] The count of the suite in the README recounted if a scenario was added.
