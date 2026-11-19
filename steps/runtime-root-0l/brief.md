# Step W.0, closing: the rows of the profiles are generated, and the check is equality

The passes before are in the worktree (`steps/runtime-root-0j/`, `-0k/`: read both briefs). Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and `docs/design/platform-v3-srt.md`; the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).

## The decision of the maintainer

Two reviews in a row found text of a profile row that the check does not read: text of a list element outside its `tspan` children, a host no profile holds, a character written as a numeric reference. The check reads the text of an SVG with patterns, and a pattern over markup has no closed answer: each pass closes one form and the next review finds another. The repository locks no XML parser, and one more pattern is not the answer. The question changes: **the rows are not compared, they are produced.**

1. **One function produces, from the five profile files, the markup of the profile rows** of `docs/diagrams/isolation.svg`: for each profile, the paths opened for writing, the paths closed for writing inside an opened one, the hosts allowed, what it receives that is a token; and once, the count of the paths denied for reading with the file where they are read. It escapes what it writes. The same function produces the part of the description of the image (`<desc>`) that states these lists, if the description states them.
2. **The diagram holds that markup between two marker comments**, and nothing else there. The scenario requires the bytes between the markers to equal what the function produces from the files of the tree; a difference is refused, and the message says which command regenerates. There is no other reading of the rows: remove the patterns over `tspan`, list names, templates and hosts inside rows, with their steps.
3. **One command regenerates the region** (a script of `package.json`, in the same style as the others; it starts no process and writes one file). Run twice in a row it changes nothing. `docs/testing.md` names it.
4. **Outside the markers, the diagram states nothing of what a profile opens, closes, reaches or receives.** That is a rule on what the file says, and the scenario can hold one closed part of it: outside the markers, no template string (`${`), written plainly or as a character reference (refuse any `&#` in the file outside the markers), and no host of a network list of a profile. Say in the feature, in one sentence, what remains to a reader: prose that contradicts the lists without naming a path or a host.
5. Poisoned copies: a profile that gains a write path with the diagram unchanged; the region edited by hand (text added inside a list); a template string outside the markers; a numeric reference outside the markers; a host of a profile outside the markers. Each refused for its own reason, asserted exactly.
6. `README.md`, the roadmap row of the place to write: a full stop is missing between « the next point » and « The container benchmark »; read the whole row again. Recount the suite if scenarios were added or removed, the way the README says it is counted.

Render the diagram after regeneration and look at it: the generated rows must read well (wrap long lists on several lines by a rule of the function, not by hand). If your sandbox cannot render, say so plainly and list what you checked in the source.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] In the report: a profile changed by hand, the scenario that failed, the command run, the scenario green again, the profile restored and the region regenerated.
- [ ] Three pillars: research (the rows come from the files, by one function), SSDLC (a diagram of the isolation that says less than a profile opens is a false statement of security: the gate now refuses it by equality), operational (nothing of the owner's machine is named).
