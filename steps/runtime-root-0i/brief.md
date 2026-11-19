# Step W.0, closing pass, third try: the five points of the review

The two closing passes are in the worktree (`steps/runtime-root-0g/`, `-0h/`: read both briefs). Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).

A diagram of the isolation is read as a statement of security: it says exactly what a profile opens and exactly where a secret is held, or it says nothing. Each point at its cause:

1. `docs/diagrams/isolation.svg`, the row of the builder and the description of the image: `packages/sandbox/profiles/builder.json` opens for writing the worktree, the administrative directory of that worktree, and the shared object store, the refs and the logs of the repository, with the ref of `main` closed. The row and the description say exactly that. Then, for every profile row of the diagram, write in the report a table: each path the profile file opens for reading-denied, for writing and writing-denied, and the words of the diagram that cover it; any path not covered is added to the diagram or said in its description.
2. The description of `isolation.svg` puts four things « under that root ». Only what the design places under the root goes there: what a run writes (`run`), what is reused (`cache`, where the dependency store lives), what is kept until published (`state`). The gate under the sandbox is a change of who runs the candidate code, not a place under the root. The second proxy and the consent of the other provider are held by the host, **outside** the root: the design says so in so many words (« tenu par l'hôte seul, hors de la racine d'écriture »). Rewrite the description and check the drawing says the same: no arrow, box or grouping places a credential or a proxy under the root. Do the same reading of the README text that describes this diagram.
3. `README.md`, the point on a builder of another provider: the design says that if the real trial fails for a reason of rights or eligibility, the build stops and no key paid by use is substituted without the owner. Say that, not an unconditional ban.
4. `docs/diagrams/isolation.svg`, the `next` box of the place to write names what replaces the write under the home cache: the npm cache of a session under the root.
5. `cucumber.mjs`, the comment on the profiles: name the two areas (`features/repository` and `features/arch`) that stay in the default profile, so that « Both » cannot be read two ways.

Render each changed diagram and look at it; if your sandbox cannot render, say so plainly and list what you checked in the source.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive`: green; give the count.
- [ ] The table of point 1 in the report, for every profile row of the diagram.
