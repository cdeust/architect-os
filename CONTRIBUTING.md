# Contributing

Thank you for contributing. Read `CLAUDE.md` first: it is the contract the review applies.

## Workflow

1. Fork or branch from `main`. Work in a branch; never push to `main` directly.
2. Configure a marked runtime root as described in the [quick start](README.md#quick-start), then run `nvm use` and `./aos -- npm ci --ignore-scripts`.
3. Make the change with its tests (see "Adding a brick" in `CLAUDE.md`).
4. Run `./aos -- npm run check` and make it pass (`./aos -- npm test`: typecheck, prettier, tests and architecture guard are all scenarios). Run `./aos -- npm run format` to fix formatting.
5. Open a pull request. A pull request is mandatory for every change. The CI gate (`.github/workflows/gate.yml`, `./aos -- npm run gate`) reports two required checks, `gate-linux` and `gate-macos`. The ruleset of `main` requires both and a pull request, and no account bypasses it (`docs/infrastructure.md`, "How a pull request reaches `main`"); the Claude review runs on the pull request and applies `CLAUDE.md`, and the merge resolver merges a pull request whose gate is green and whose review approves the same commit.
6. Address review comments with new commits on the same branch.

## The maintainer's line

The steps above are for every change since 26 November 2026, the maintainer's included: the ruleset of `main` takes pull requests only, with no bypass. Before that date the maintainer's work landed on `feat/gate-1a`, a branch that is kept because the journal (`docs/design/journal.md`) is cited from outside by its sections, one commit at a time, and `main` followed by fast-forward to the same commit (design, decision 23). `./aos -- npm run deliver` still does that, and its push to `main` is what the ruleset now refuses: the command and the ruleset of `feat/gate-1a` are retired or changed by a pull request of `tools/deliver` (`docs/infrastructure.md`, "What stays open").

## Rules that are checked

- Layers and boundaries are enforced by `./aos -- npm run arch`; do not weaken `.dependency-cruiser.cjs` without a documented reason.
- A brick without tests is refused. Each port has a contract test run against every adapter.
- Dependencies are pinned to exact versions (verify with `npm view <pkg> version`) and `package-lock.json` is committed.
- No secret in code, tests, logs or images.
- No branch-to-`main` comparison in CI or scripts.
- Update `docs/` and `CLAUDE.md` when a change alters architecture, boundaries or commands.

## Commits

Imperative subject (`feat: add quota adapter`), body explaining why when it is not obvious.
