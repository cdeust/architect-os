# Contributing

Thank you for contributing. Read `CLAUDE.md` first: it is the contract the review applies.

## Workflow

1. Fork or branch from `main`. Work in a branch; never push to `main` directly.
2. Configure a marked runtime root as described in the [quick start](README.md#quick-start), then run `nvm use` and `./aos -- npm ci --ignore-scripts`.
3. Make the change with its tests (see "Adding a brick" in `CLAUDE.md`).
4. Run `./aos -- npm run check` and make it pass (`./aos -- npm test`: typecheck, prettier, tests and architecture guard are all scenarios). Run `./aos -- npm run format` to fix formatting.
5. Open a pull request. A pull request is mandatory for every change. The CI gate (`.github/workflows/gate.yml`, `./aos -- npm run gate`) reports two required checks, `gate-linux` and `gate-macos`. The ruleset of `main` requires both and a pull request, and no account bypasses it (`docs/infrastructure.md`, "How a pull request reaches `main`"); the Claude review runs on a pull request whose head is a branch of this repository and applies `CLAUDE.md`, and the merge resolver merges a pull request whose gate is green and whose review approves the same commit. A pull request from a fork gets the gate and no Claude review (the job condition of `claude-review.yml`: no runner and no secret for a fork); the resolver holds it, and the owner reads and merges it.
6. Address review comments with new commits on the same branch.

## The maintainer's line

The steps above are for every change since 26 November 2026, the maintainer's included: the ruleset of `main` takes pull requests only, with no bypass. Before that date the maintainer's work landed on `feat/gate-1a`, a branch that is kept because the journal (`docs/design/journal.md`) is cited from outside by its sections, one commit at a time, and `main` followed by fast-forward to the same commit (design, decision 23). `./aos -- npm run deliver` is still written for that, and can no longer bring a commit to `main`: what it does depends on the commit it is given. With the remote branches where they were on 26 November 2026 (`feat/gate-1a` at `721b1861`, behind `main` at `2b5bd3cd`), a commit made after the tip of `main` stops in the preconditions with `les branches distantes diffèrent`, before any push (`tools/deliver/src/domain/plan.ts`: the branches behind the commit must be at one same parent). The tip of `main` itself passes them: the command then pushes its trial branch and, without `--until ci` and on green checks, `feat/gate-1a`, and never `main`. Any other commit is refused in the preconditions. Once both branches are at one commit, a commit made after it reaches the last phase, which pushes `feat/gate-1a`, then `main`: that push, outside a pull request, is what the ruleset refuses. Read in the code (`plan.ts`, `tools/deliver/src/application/deliver.ts`); the command was not played. The command and the ruleset of `feat/gate-1a` are retired or changed by a pull request of `tools/deliver` (`docs/infrastructure.md`, "What stays open").

## Rules that are checked

- Layers and boundaries are enforced by `./aos -- npm run arch`; do not weaken `.dependency-cruiser.cjs` without a documented reason.
- A brick without tests is refused. Each port has a contract test run against every adapter.
- Dependencies are pinned to exact versions (verify with `npm view <pkg> version`) and `package-lock.json` is committed.
- No secret in code, tests, logs or images.
- No branch-to-`main` comparison in CI or scripts.
- Update `docs/` and `CLAUDE.md` when a change alters architecture, boundaries or commands.

## Commits

Imperative subject (`feat: add quota adapter`), body explaining why when it is not obvious.
