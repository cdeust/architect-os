# Step W.0, last pass: the README and the diagrams say what was decided

The earlier passes are in the worktree (`steps/runtime-root-0/` to `-0f/`); the review of the sixth accepted the change. This pass closes it for delivery. Not to be touched: the maintainer's changes to `docs/design/orchestration-fable-5-2.md` and to `docs/design/platform-v3-srt.md` (read them: they are the source of this pass); the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).

## What was decided, and is not built

`docs/design/orchestration-fable-5-2.md`, §14, holds three designs written on 18 and 19 November 2026. Read the three sections whole, with their tables of what the maintainer retained from the contestation by a model of another provider:

- « Une seule copie des dépendances : conception », with « Après la revue adverse d'un autre fournisseur » and « Seconde contestation, après ces réponses »;
- « Un seul lieu d'écriture, imposé par l'hôte : conception », with « Après la contestation d'un autre fournisseur », « Ce que ces décisions ne doivent pas affaiblir » and « Ordre de construction, revu »;
- « Un constructeur d'un autre fournisseur, derrière un proxy de l'hôte : conception ».

The rule of the repository (`CLAUDE.md`, « What the review must refuse »): a decision of design that is recorded and not built enters the roadmap of the README (« What comes next ») and the diagram it belongs to, in the same commit.

## What to do

1. `README.md`, « What comes next »: bring it in line with the three designs. Each point says in one or two sentences what is missing today, by a fact of the tree or of the journal, as the points around it do; no story of how the decision was reached. At least:
   - the point on one copy of the dependencies says what the design now requires before any migration (the store under the runtime root and written by the host alone, the proofs listed in « Seconde contestation »), and no longer that measures are being taken;
   - a point for the single place to write: its steps in their order (the single entry and the admission; the profiles; the gate; the end of a run and the ceiling of the streams; the measure of the peaks and the hard capacity);
   - a point for the gate under the sandbox (the candidate code that the gate runs as the host);
   - a point for a builder of another provider behind a host proxy, with the rule that the reviewer is never of the provider of the author; look at the existing point « A judge from another provider » and say how the two stand (one point or two), without losing what the first says.
   Put each where the order of the section puts it (the order is by what each point takes off the hands of the orchestrator); if the order of the groups must change, change it and say why in the report.
2. The diagrams of `docs/diagrams/`: each new `next` point appears in the diagram it belongs to (`isolation.svg` for the place to write, the gate under the sandbox and the second proxy; `orchestration-loop.svg` for the builder of another provider), marked `next` as the existing ones are. Read how the existing `next` marks are drawn and do the same; render each changed diagram and look at it (a headless browser is the way the earlier steps did it; if your sandbox cannot render, say so plainly in the report and list what you checked in the source instead). The alternative text of each image in the README says what the diagram now shows.
3. Read the whole README once more after the change: no count, state or command that the tree contradicts; nothing says the container benchmark can be run; nothing is said to be applied that is only decided.
4. Two wordings left by the last review: in `features/arch/no-container-command.feature`, the reason `step.json` is read says exactly what happens (the file is the input the step tool runs; its copy under `steps/` is never run in place, since a published name is refused, but can be run again from a copy); in `cucumber.mjs`, rewrap the comment on the profiles so that each sentence sits next to the one it explains.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch/no-container-command.feature features/descriptive`: green; give the counts.
- [ ] In the report: each new or changed point of the roadmap with the section of the design it comes from; each diagram changed and how it was checked.
- [ ] Three pillars: research (what the designs rest on, and what is stated as not yet proven), SSDLC (each design has its threats before its code), operational (nothing of the owner's machine, account or plan is named in the README or a diagram).
