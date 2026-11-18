# Step G.1, fourteenth pass: two scenarios that do not yet carry all they say

The thirteenth pass was accepted by its review, which left two proposals on what the scenarios prove. Do these two, and nothing else. The maintainer's own changes in the worktree are not to be reported nor touched: `docs/design/`, the root `README.md`, `docs/diagrams/`, `CLAUDE.md`.

1. `packages/sandbox/features/tree-fingerprint.feature` and its steps, the scenario with real git on the configuration of the host. Git reads a default global exclusion file, `$XDG_CONFIG_HOME/git/ignore` or `$HOME/.config/git/ignore`, even when `GIT_CONFIG_GLOBAL` is an empty file, because it is not a configuration file: only the absence of `HOME` and of `XDG_CONFIG_HOME` from the list protects the fingerprint from it, and today only the scenarios with the fake git see that. Make the real-git scenario cover it: the pattern is also written in `home/.config/git/ignore` and in `xdg/git/ignore`, and the file it names is still in the tree. Then put `HOME` back in the list for a moment, with `GIT_CONFIG_GLOBAL` kept, see the scenario fail, restore, and say so in the report.
2. `tools/test-gate/features/closed-environment-fresh.feature`, the scenario with a `HOME` and an `XDG_CONFIG_HOME`: the `XDG_CONFIG_HOME` line and the `core.autocrlf` of the `.gitconfig` can be removed without changing what is observed (the directory does not exist, and the file of the diff has LF line ends). Make both carry weight: `XDG_CONFIG_HOME` names a directory with a real `git/config`, and the diff holds a file with CRLF line ends, so that removing either changes the outcome when the closed environment leaks; or remove what cannot be made to carry weight, and say which.

## Not in this step

Production files. Everything else. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features/tree-fingerprint.feature packages/sandbox/features/tree-fingerprint-fresh.feature tools/test-gate/features`: green; give the count.
