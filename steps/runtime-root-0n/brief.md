# Step W.0, closing: the generated rows become a generated file

The passes before are in the worktree (`steps/runtime-root-0l/`, `-0m/`: read both briefs). Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).

## The decision of the maintainer

The generated region is exact: the gate requires equality. What two reviews keep finding is the other half, the search of the bytes **outside** the markers (a processing instruction that splits a host, a host in another case, a path written without its template, an id in single quotes). That half reads markup with patterns, and it cannot be closed: the last pass closed comments and CDATA, this review found processing instructions. The guarantee must not rest on it. So the two halves are separated by files, and each says exactly what it guarantees.

1. **`docs/diagrams/isolation-profiles.svg` is produced whole** by the function, from the five profile files: a complete image (its own title and description, the five rows, the row of the paths denied for reading). The scenario requires the **whole file** to equal what the function produces; there are no markers and no hand-written part in it. `npm run diagram:isolation` writes that file. Every text the function writes is measured against the room of its line, the sentence of the denied reads included: the function refuses to produce a file in which a text does not fit, and a scenario shows it for an item and for that sentence.
2. **`docs/diagrams/isolation.svg` no longer holds the rows of the profiles**: it stays the hand-drawn picture of who starts what and what holds the credential, and it points to the other image for what each profile opens. Remove from it the markers, the generated region, and the rules that existed only to protect the search (the bans on comments, CDATA, declarations, the duplicate-id check): they guarded a search that is no longer the guarantee. Keep its maintainers' comments if they were removed for that reason only and are true; a comment that states what a profile opens stays out.
3. **One tripwire stays on the hand-drawn picture, named as what it is**: it refuses, in `isolation.svg`, a template string (`${`) and a host of a network list of a profile, compared without regard to case. The feature says in plain words that this is a tripwire for the plain forms and not a guarantee, that the guarantee is the equality of the generated file, and that the hand-drawn picture is prose, read by the reviewer of each change like the README (`CLAUDE.md`, « What the review must refuse », already refuses a change that leaves a diagram as it was). No sentence of the feature claims more than a scenario shows.
4. **`README.md`** shows the two images where it describes the isolation, each with an alternative text that says what it shows; the sentence on how the rows are kept true names the generated file. In the roadmap row of the place to write, the clause on the git writes uses « which lets a build session create a commit and move a local ref other than `main` »: one reading only. Read the whole README once more; recount the suite the way the README says it is counted.
5. `docs/testing.md` and `CLAUDE.md` (the line of the command) say what the command writes now. Check that the rest of `CLAUDE.md` is unchanged against `HEAD`.
6. Poisoned copies, each refused for its own reason asserted exactly: a profile that gains a write path with the generated file unchanged; the generated file edited by hand; an item too long for its line; the hand-drawn picture with a template string; the hand-drawn picture with a host of a profile in upper case.

Render both images and look at them; if your sandbox cannot render, say so plainly and list what you checked in the source.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `npm run diagram:isolation` run twice: no change the second time.
- [ ] The step file and the support file hold no code left from the search inside or around markers.
