# Step W.0: the container benchmark leaves the runnable surface

Design: `docs/design/orchestration-fable-5-2.md`, section « Un seul lieu d'écriture, imposé par l'hôte : conception », its table « Après la contestation d'un autre fournisseur » and the revised order: this is step (0). The maintainer's changes to that file are not to be touched; untracked `bench/deps-store/` and `steps/deps-measure-*` belong to another step and are not to be touched nor reported.

## The fact

The platform left containers (decisions 21 and 22 of `docs/design/platform-v3-srt.md`; srt alone isolates). `baseline/overhead.ts` is still callable through `npm run baseline:overhead`: on macOS it starts a virtual machine named `aos-bench`, builds images from temporary directories nothing removes, and calls `docker system prune -af` against the selected daemon. Nothing in the gate, the CI or the delivery calls it. Its results (`baseline/results/overhead-*`) are the measures the two decisions cite: they are evidence and stay, and `baseline/overhead-analyze.ts`, which only reads them, stays with its script.

## What to do

1. Remove `baseline/overhead.ts` and the script `baseline:overhead` of `package.json`. Look for everything that only it used (a helper, a fixture, a type, a dependency of `package.json` that nothing else imports: check with the lock file and say what you found; do not remove a dependency another file uses).
2. `baseline/README.md`: say in the present tense what the directory holds now: the results, how to analyse them, and that the program which produced the overhead measures is in the history of the repository at the last commit that holds it (give the hash you read with `git log -1 --format=%H -- baseline/overhead.ts`). No story of what was removed beyond that sentence.
3. Every other mention in the tree that tells a reader to run it or describes it as present (`README.md`, `docs/operating.md`, `docs/testing.md`, `CLAUDE.md`, `bench/JOURNAL.md` is a journal: journals are append-only and are not edited; `docs/design/journal.md` likewise): correct the ones that are not journals, list the ones you left and why.
4. A scenario under `features/arch/` (it reads the text of files, so it is outside the mutation profile): no script of `package.json` and no file of `baseline/` or `bench/` outside journals and results names `docker` or `colima` as a command to run. Show that it fails on a poisoned copy. Use only step definitions that exist, or add one in the file where its neighbours live; step text unique across the repository.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts.
- [ ] `README.md` read whole after the change: nothing says the container benchmark can be run.
- [ ] Three pillars in the report: research (the results kept, the hash that reproduces the program), SSDLC (the threat removed: a daemon-wide prune reachable from a script), operational (no virtual machine is started by this repository).
