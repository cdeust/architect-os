# Contributing

Thank you for contributing. Read `CLAUDE.md` first: it is the contract the review applies.

## Workflow

1. Fork or branch from `main`. Work in a branch; never push to `main` directly.
2. `nvm use && npm ci`.
3. Make the change with its tests (see "Adding a brick" in `CLAUDE.md`).
4. Run `npm run check` and make it pass (`npm test`: typecheck, prettier, tests and architecture guard are all scenarios). Run `npm run format` to fix formatting.
5. Open a pull request. A pull request is mandatory for every change. The CI gate (`.github/workflows/gate.yml`, `npm run gate`) reports two required checks, `gate-linux` and `gate-macos` (a ruleset requires both on `main` and on `feat/gate-1a`, see `docs/infrastructure.md`); the Claude review runs on the pull request and applies `CLAUDE.md`.
6. Address review comments with new commits on the same branch.

## The maintainer's line

The steps above are for a contribution. The maintainer's work lands on `feat/gate-1a`, a branch that is kept because the journal (`docs/design/journal.md`) is cited from outside by its sections: one commit at a time, pushed once `npm run gate` is green on the host and the gate is green in CI for that commit. CI sees the commit on a trial branch, `sentinel/gate-1a-<name>`, pushed first and deleted afterwards: that run is what gives the commit the two checks the rulesets require, and it is the only one a push to `feat/gate-1a` needs. `main` then follows by fast-forward to the same commit (design, decision 23), so both branches carry the same history. Nothing else is pushed to `main`: no commit of its own, no rewrite.

## Rules that are checked

- Layers and boundaries are enforced by `npm run arch`; do not weaken `.dependency-cruiser.cjs` without a documented reason.
- A brick without tests is refused. Each port has a contract test run against every adapter.
- Dependencies are pinned to exact versions (verify with `npm view <pkg> version`) and `package-lock.json` is committed.
- No secret in code, tests, logs or images.
- No branch-to-`main` comparison in CI or scripts.
- Update `docs/` and `CLAUDE.md` when a change alters architecture, boundaries or commands.

## Commits

Imperative subject (`feat: add quota adapter`), body explaining why when it is not obvious.
