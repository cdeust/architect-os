# Step G.1, twelfth pass, played again: the git of the fixtures is closed too

The eleventh pass closed the environment of the child of `features/descriptive/closed-git-environment.feature`, which had turned the Linux job of CI red, and looked for the same kind elsewhere. It found the git that the fixtures of the scenarios start with the whole environment of the suite less its `GIT_` variables, and left it, « a further step ». Its review asked for it. This is that step.

Two things in the worktree are the maintainer's and are not to be reported nor touched: the section « Une seule copie des dépendances : conception » of `docs/design/orchestration-fable-5-2.md`, the design of the next step, written while this one was being delivered; and the root `README.md`, `docs/diagrams/`, `CLAUDE.md`.

A first attempt at this pass, under the name `git-env-l`, was stopped by the maintainer while its build session was working (a power risk at the owner's): it left no folder under `steps/`. It may have left partial edits in the worktree, at least in `packages/sandbox/features/tree-fingerprint.feature` and `packages/sandbox/features/tree-fingerprint-fresh.feature`. Read `git diff` first: keep what is right, finish what is half done, undo what is wrong, and say in the report what you found.

Do this, and nothing else:

1. `packages/sandbox/features/steps/tree-fingerprint.ts`, the helper `git` of the scenarios, and `tools/deliver/features/steps/git-fixture.ts`, `fixtureEnvironment()`: the git a fixture starts receives a closed environment, not the one of the suite less some names. What it needs and nothing else: `PATH`; a `HOME` that is a temporary directory of the fixture, or none; `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null`, so that no configuration of the machine is read; a fixed identity and a fixed date for its commits where a scenario depends on them (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, and the two dates if a hash is compared); `LC_ALL=C` if an output of git is read. If another helper of the step files this step added or changed starts git the same way (`tools/test-gate/features/steps/`, `features/steps/`), close it the same way. Each helper says in its comment why each variable is there.
2. `tools/deliver/features/steps/host-process.ts`, the scenario « the environment of this process, passed whole, is the one the program sees »: it checks the value of `PATH`, which the scenario did not set. Make it check a variable the scenario sets itself, through the step of `features/steps/` that sets a variable of the process until the scenario ends.
3. `packages/sandbox/features/tree-fingerprint.feature` and `tree-fingerprint-fresh.feature`, the scenarios on the names each call received: they rest on `PATH`, `HOME` and `TMPDIR` as the host happens to have them. Set `HOME` in them, as `tools/test-gate/features/closed-environment.feature` does, and say in the scenario where `PATH` and `TMPDIR` are set.
4. Prove the whole in the terms of the defect: run the feature files of `packages/sandbox/features/tree-fingerprint*.feature`, `tools/deliver/features`, `tools/test-gate/features` and `features/descriptive/closed-git-environment.feature` with forty variables `GITHUB_SOMETHING_<n>`, `LANG=fr_FR.UTF-8`, `TZ=Pacific/Kiritimati` and `XDG_CONFIG_HOME=/nowhere` set in the shell that starts cucumber, and say in the report that they pass, with the counts.

## Not in this step

Production files. Everything else. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] The run of point 4, and the same run without those variables: green; give both counts.
- [ ] No scenario depends on a variable it did not set, on the time zone or on the language of the machine.
