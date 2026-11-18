# Step G.1, thirteenth pass: the fingerprint and the gate read no configuration of the machine

The twelfth pass closed the git of the fixtures. Its review then played the scenarios with a `HOME` whose `.gitconfig` sets `core.autocrlf = true` and a `core.excludesFile` listing `*.txt`: seventeen scenarios of the fingerprint and of the gate failed. It proposed to set a `HOME` in those scenarios. The maintainer decided otherwise, because the cause is in production: the fingerprint is said to depend on the repository alone, and a verdict of the gate must be reproducible, yet both read the global configuration of the host. Read `docs/design/orchestration-fable-5-2.md` §14, « Un environnement fermé pour git », the table « Décidé après la revue de la douzième passe »: it decides, this brief places the work.

The maintainer's own changes in the worktree, not to be reported nor touched: that design note, the root `README.md`, `docs/diagrams/`, `CLAUDE.md`.

## 1. Production: no global nor system configuration for the fingerprint and for the gate

`packages/sandbox/src/tree-fingerprint.ts` and `tools/test-gate/src/infrastructure/git.ts`:

- The caller sets `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to an empty file (`/dev/null`) for every git call.
- `HOME` leaves the list: five names remain, `PATH`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR`. The two functions keep the same form and the same list; the literal check of `features/arch` that holds them equal still passes.
- An option or a variable that no scenario can tell from its absence once this is done is removed, not kept: check `-c core.excludesFile=/dev/null` of the fingerprint by removing it for a moment; if every scenario stays green, it goes, and its scenario is re-aimed at what now protects (no configuration and no home); if a scenario fails, it stays, and you say which.
- The delivery (`tools/deliver/`) is not changed: it keeps the configuration of the host, where the helper that identifies it to the forge lives.

## 2. Scenarios

- Fingerprint, with real git: with a `HOME` whose `.gitconfig` sets `core.autocrlf = true` and a `core.excludesFile` listing a pattern, and with `XDG_CONFIG_HOME` naming a directory whose `git/config` does the same, the fingerprint of a tree with a CRLF file and a file the pattern names is the tree that committing everything would give. With the fake git: each call received exactly the five names of the list that the process had, the two configuration variables set to `/dev/null`, and `GIT_INDEX_FILE` where it is due; `HOME` set in the process is not received.
- Gate: with a `HOME` whose `.gitconfig` sets `diff.noprefix = true` and `core.autocrlf = true`, the head, the first parent and the diff it reads are the ones recorded before; with the fake git, the names received are the five and the two configuration variables.
- The scenarios of the fresh files that expected `HOME` among the names received, or that rest on the home of the host, are brought to the new contract; say which in the report.
- Each new scenario can fail: break the production line it protects for a moment, see it fail, restore, and say so in the report.

## 3. Two points left by the review

- `features/steps/process-environment.ts`: its comment names the features that use it; `tools/deliver/features/host-process.feature` now does too.
- `features/steps/steps-folder.ts`: its helper `git` still starts git with the whole environment of the suite. Close it as the fixtures of the twelfth pass were closed.

## 4. Proof in the terms of the defect

Run `packages/sandbox/features/tree-fingerprint*.feature`, `tools/test-gate/features`, `tools/deliver/features`, `features/descriptive` three ways and give the three counts: as they are; with forty `GITHUB_SOMETHING_<n>`, `LANG=fr_FR.UTF-8`, `TZ=Pacific/Kiritimati`, `XDG_CONFIG_HOME=/nowhere` in the shell; and with `HOME` naming a temporary directory whose `.gitconfig` holds `core.autocrlf = true`, `core.excludesFile` listing `*.txt`, `diff.noprefix = true`, `commit.gpgsign = true` and `core.hooksPath` naming a directory with hooks that fail.

## Not in this step

`tools/deliver/src/`. `docs/design/`, the root `README.md`, `docs/diagrams/`, `CLAUDE.md`, `.dependency-cruiser.cjs`, `cucumber.mjs`, `stryker.config.mjs`, `.github/`, `features/sandbox/`. Nothing is written under `steps/` by a scenario or by hand. No scenario reads the text of a production file outside `features/arch/`.

## Documentation

`docs/testing.md`: what proves point 1, and the lists as they are now.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] The three runs of point 4: green; give the counts.
- [ ] No literal that Stryker can mutate at module level; functions are `function` declarations; no `// Stryker disable`; no branch no scenario plays; no argument, option or variable whose absence changes nothing.
