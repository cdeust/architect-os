# Step G.1: the host starts git with a closed environment

Design, with its threat table: `docs/design/orchestration-fable-5-2.md` §14, « Un environnement fermé pour git : conception ». Read it first; it decides, this brief only places the work.

Today three production files start git with the whole environment the host process inherited, and the scenarios do the same from many helpers. A `GIT_DIR`, a `GIT_INDEX_FILE` or a `GIT_CONFIG_COUNT` set around them points git at another repository or gives it a configuration. The rule: git, and the client of the forge, receive a closed list of variables taken from the host by name, then what the caller sets itself; nothing else.

## 1. The fingerprint of the tree (`packages/sandbox/src/tree-fingerprint.ts`)

Every git call receives only `PATH`, `HOME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR` of the host (each only when it is set), plus `GIT_INDEX_FILE` for the calls on the temporary index. The list is built inside a function. Scenarios in `packages/sandbox/features/tree-fingerprint.feature`, with real git and two real throwaway repositories: with `GIT_DIR` and `GIT_WORK_TREE` of the process pointing at the second repository, the fingerprint is the one of the first; with `GIT_INDEX_FILE` of the process pointing at a file, that file is not created and the index of the worktree is not touched; with `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=core.excludesFile`, `GIT_CONFIG_VALUE_0=<a file that names a.txt>`, an untracked `a.txt` is still in the tree. With the fake git that records its calls, the environment each call received holds exactly the names of the list that the process had, and `GIT_INDEX_FILE` where it is due (the fake git must write its environment's names to its log for that).

## 2. The gate (`tools/test-gate/src/infrastructure/git.ts`)

The function `git` passes the same closed list (same six names), built inside a function. It is the only process launch of that tool. Scenarios in `tools/test-gate/features/` with the disposable repositories those features already make: with `GIT_DIR` of the process pointing at another repository, what the gate reads (the head, the first parent, the diff) is that of its own repository.

## 3. The delivery (`tools/deliver/`)

- `tools/deliver/deliver.json` gets a key `environment`: the names of the host variables given to git and to the client of the forge: `PATH`, `HOME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR`, `SSH_AUTH_SOCK`, `XDG_CONFIG_HOME`, `GH_TOKEN`, `GITHUB_TOKEN`. Its schema: 1 to 32 names, each `^[A-Z][A-Z0-9_]{0,63}$`, none starting with `GIT_`, no name twice. The description of the file says what the key is.
- `runToEnd` (`src/infrastructure/host-process.ts`) no longer spreads `process.env`: it takes the environment to give, complete. The adapters of git and of the forge build it from the list of the descriptive file, the environment of the process (injected, as the other dependencies of `main.ts` are) and the variables they add (`GIT_TERMINAL_PROMPT=0` for git). `runToFile`, which starts the gate command, keeps inheriting the environment of the host: it runs a whole suite, and its comment says so.
- Scenarios, on the real adapters with the throwaway repository and its bare remote: with `GIT_DIR` of the process pointing at another repository, a delivery pushes the commit of its own worktree to its own remote; with `GIT_CONFIG_COUNT=1` and a `url.<other remote>.insteadOf=<its remote>` injected, the push still reaches its own remote and the other receives nothing; with `GIT_SSH_COMMAND` and `GIT_ASKPASS` naming a witness program that writes a file, the file is not written; the forge client receives the variables of the list that are set, among them `GH_TOKEN`, and none other (the scripted fake of the forge records the names of its environment); the schema refusals of `environment` in `config.feature`.

## 4. The suite

One file of `features/support/` loaded with the others removes from `process.env`, once, when the suite loads, every variable whose name starts with `GIT_`, and says why in its comment. A scenario of `features/descriptive/` proves it without depending on the host: it starts a child `node` with `GIT_DIR=/nowhere` and `GIT_EDITOR=x` in its environment, which imports that support file and prints the names starting with `GIT_` that remain: none. The helpers that set a `GIT_` variable for a scenario keep doing so.

## 5. A check that keeps the rule

`features/arch/` or `features/descriptive/`: a scenario that reads the three production files named above and fails when one of them gives `process.env` (whole, or spread) to a process launch. Keep it simple and literal; say in its text what it reads. Broken copies: one per file, with `process.env` spread back in.

## Not in this step

`docs/`, the root `README.md`, `CLAUDE.md`, `.dependency-cruiser.cjs`, `.github/`, `features/sandbox/`, the profiles of `packages/sandbox/profiles/`, `packages/sandbox/src/srt-runner.ts`, `native-launcher.ts`, `auth-proxy.ts` (they already build a closed environment or start no git). Nothing is written under `steps/` by a scenario or by hand.

## Documentation

`docs/testing.md`: what proves the closed environment at each of the three places and for the suite.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features tools/deliver/features tools/test-gate/features features/descriptive features/arch`: green; give the count.
- [ ] No literal that Stryker can mutate at module level (lists and expressions are built inside declared functions); functions are `function` declarations; no `// Stryker disable`; no branch no scenario plays; no argument whose absence changes nothing.
- [ ] A scenario that sets a variable of the process restores it at its end, whatever its outcome; a scenario that writes does so only under a temporary directory it removes.
- [ ] The report says, for each production line added or changed, which scenario would fail if it were broken.
