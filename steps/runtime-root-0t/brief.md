# Step W.0, last pass before delivery: a sweep of the whole change, each edit verified before it is applied

The passes before are in the worktree (`steps/runtime-root-0*/`); the reviews of the last three accepted the change. Before delivery, a second reader of another provider swept the whole change, read-only, for the four classes of defect that twenty reviews found one instance at a time: the same statement made in several places with different words or truth; a document that lists what a feature shows and does not match its scenarios; a sentence that claims more than the code does; a count, a command, a path or a name that the tree contradicts. Its list of proposed edits is below, as it wrote it. It ran nothing: **each proposal is a claim to verify, not an instruction.**

## What to do

For each numbered edit of the list:

1. Read the current text at the place given, and read the code, the scenario or the file the proposal rests on.
2. If the proposal is right, apply it: its replacement, or a better wording that says the same true thing in the style of the file. If it is right about the defect and wrong about the replacement, write the true sentence. If it is wrong, leave the text and say why, with the file and line that show it.
3. A statement corrected in one place is corrected in every place it is made (search the tree for it).

Scope of this pass, beyond the list:

- `docs/design/platform-v3-srt.md` is a design document, not a journal: its section 4.3 still gives the runtime of the sandbox at `0.0.81` while the lock file and its own entry 1b.8 give `0.0.83`, and its section 5 speaks of one template `sandboxes/base.srt.json` while the tree holds five profile files under `packages/sandbox/profiles/`. In these two places only, write what is true today and keep the history as history (a dated clause). Touch nothing else in that file, and do not touch `docs/design/orchestration-fable-5-2.md` (the maintainer corrected in it, after the sweep, the references to a workstation and the two sentences on the removed benchmark).
- The two journals of the repository are append-only and are not edited. `steps/` is never edited.
- Not to be touched: the change that gives `TMPDIR` to a child in `features/steps/closed-git-environment.ts` and `tools/deliver/features/steps/command.ts` (step `steps/deps-measure-e/`).
- The count of the suite: recount it the way the README says it is counted, after your changes, and write the number you obtain wherever it is stated.
- If an edit changes a scenario title or a step text, the step text stays unique across the repository and every document that cites the title follows.
- Regenerate the image of the profiles if the function changed (`npm run diagram:isolation`), render the changed images and look at them; if your sandbox cannot render, say so plainly.

## Report

A table of every numbered edit: applied as proposed / applied with another wording (give it) / refused (file and line that show why). Then what you changed beyond the list, and why.

## Checklist

- [ ] `npx tsc -p features --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/arch features/descriptive`: green; give the counts. (Run it yourself; it is not a check of the step.)
- [ ] `CLAUDE.md`: every line changed against `HEAD` listed in the report.
- [ ] Three pillars: research (each statement of the README and of the testing page rests on a file or a scenario named in the report), SSDLC (no statement of security claims more than a scenario shows), operational (no workstation, account, plan or private path is named in what this pass writes).

---

## The sweep, as its author wrote it

The static count matches the README’s **3,114 scenarios**. The container-word scan found **exactly the six allowlisted files**. The main corrections are to the scope of the two guards, the claims made for the diagrams, and the commands needed to reproduce the evidence.

Each **Current → Replacement** below applies to the exact quoted span. Line numbers refer to the current worktree. No edits were applied.

## Edits

### `CLAUDE.md`

1. **Line 7 · Class 2**  
   **Current:** `every scenario (unit, port contracts, end to end, typecheck, format, architecture guard)`  
   **Replacement:** `every scenario in the default profile (unit, port contracts, end to end, typecheck, format, architecture guard)`  
   `modules/broker/live/` has its own profile.

2. **Line 16 · Class 3**  
   **Current:** `one step of the orchestration loop: build session then review session under srt, files left in <folder>`  
   **Replacement:** `one step of the orchestration loop: configured scouts, build, checks and reviews under srt, with run files in <folder>`  
   The launcher supports scouts and checks, and a refused build or check can prevent reviews from starting.

3. **Line 17 · Classes 1, 4**  
   **Current:** `npm run diagram:isolation   # write docs/diagrams/isolation-profiles.svg whole, from packages/sandbox/profiles (features/arch/isolation-diagram.feature requires the file equal to it)`  
   **Replacement:** `npm run diagram:isolation   # after npm run typecheck, regenerate docs/diagrams/isolation-profiles.svg from the five profile files if it differs`  
   The script imports `@architect-os/sandbox` through its built export, and the writer returns without writing when the current text matches.

### `README.md`

4. **Lines 3, 13, 137, 151 and 217 · Classes 1–3**  
   Use the same scope throughout. The gate checks scenario identities, count and outcomes for its job. Mutation and replay apply to the Linux job when its plan calls for mutation. Registered debt and justified equivalents are handled explicitly.

   | Line | Current | Replacement |
   |---|---|---|
   | 3 | `Every Claude Code session runs in its own sandbox, every change passes a gate that counts scenarios and kills mutants` | `Every Claude Code session launched by the loop runs in its own sandbox, and the delivery gate checks the identities, count and outcomes of the job’s scenarios` |
   | 13 | `Executed scenarios must equal base + added − removed, and no mutant may survive on a changed line; the gate replays the mutation tool's verdicts instead of trusting them.` | `The executed scenarios must match the expected identities and count, base + added − removed, and their steps must pass. When the Linux plan calls for mutation, the gate refuses unaccepted survivors in the changed production perimeter and checks replayable verdicts.` |
   | 137 | `the mutation of the changed lines, with the replay of its verdicts, which the gate applies to every commit` | `mutation and verdict replay in the Linux gate when its plan calls for mutation` |
   | 151 | `The gate refuses a filtered run, a skipped step, a surviving mutant, and a wrong verdict of the mutation tool` | `The gate refuses a filtered run, a skipped step, an unaccepted survivor in the mutation perimeter, and a replay divergence` |
   | 151 | `tools/test-gate/features/` | `tools/test-gate/features/{sets,outcome,mutation,debt,control,replay}.feature` |
   | 217 | `# the CI gate: the count, the scenarios, the mutation of the changed lines` | `# the Linux gate: scenario identities, count and outcomes, plus mutation and replay when planned` |

   The four claims in the proof row map to `sets.feature:23`, `outcome.feature:105`, `mutation.feature:13` with the exception in `debt.feature:14`, and `replay.feature:19` with the verdict check in `control.feature:116`.

5. **Lines 11 and 143 · Classes 1–3**  
   **Current, line 11:** `A session cannot read the host's keys.`  
   **Replacement:** `The real-sandbox scenarios exercise denial of a planted home secret for all five profiles.`  
   **Current, line 143:** `No profile reads a host secret or another sandbox's folder, writes a git hook, or reaches the network outside its allow-list; the builder cannot write what the host recorded of a step`  
   **Replacement:** `All five profiles refuse the fixture’s home-secret read, direct home write, pre-commit hook write, external network probes, Postgres socket access, sibling-task read and nested user namespace. The builder also refuses the three tested writes under steps/.`  
   `escape.feature:23,84` exercises those finite cases, including four attack types omitted by the current claim, and its witness and positive-control counts can stay.

6. **Lines 14, 37 and 39 · Classes 1, 3**  
   **Current, line 14:** `The reviewer session cannot write` → **Replacement:** `The reviewer session cannot write the worktree`  
   **Current, line 37:** `scouts that quote lines of the repository in read-only sandboxes` → **Replacement:** `optional scouts that quote lines of the repository in sandboxes with a read-only worktree`  
   **Current, line 37:** `the reviews of the step in read-only sandboxes at the same time` → **Replacement:** `the configured reviews in sandboxes with a read-only worktree, up to the step’s concurrency limit`  
   **Current, line 39:** `other sessions review without being able to write` → **Replacement:** `other sessions review with a read-only worktree`  
   **Current, line 39:** `Then the step can have several reviews, played at the same time, each on its own model` → **Replacement:** `Then the step can run its configured reviews up to its concurrency limit, each on its configured model`  
   `reviewer.json` opens `${config}` and `${tmp}`, and `step-tool.ts:396,435` runs the configured lists through `playBounded`.

7. **Lines 23, 25 and 27 · Classes 1, 3**  
   **Current, line 23:** `a Claude Code session in an srt sandbox reaches the host through the authentication proxy` → **Replacement:** `a Claude Code session in an srt sandbox reaches the model through the host’s authentication proxy`  
   **Current, line 23:** `what each profile opens, closes, reaches and receives is stated in the second image` → **Replacement:** `the second image lists each profile’s write allow-list, write deny-list, network allow-list and token variable names, with counts of denied-read entries`  
   **Current, line 25:**
   ```markdown
   !What each of the five profiles opens: for builder, reviewer, checker, worker and module, the paths it opens for writing, the paths it closes inside them, the hosts it allows and the variables that hold a token, in the words of its file, then the paths denied for reading
   ```
   **Replacement:**
   ```markdown
   !Write allow-lists, write deny-lists, network allow-lists and token variable names for builder, reviewer, checker, worker and module, followed by counts of denied-read entries
   ```
   **Current, line 27:** `and no profile reaches the forge` → **Replacement:** `and none of the five network allow-lists names the forge`  
   The image copies selected fields, includes explicit write denials outside the write allow-list, and prints denied-read counts rather than the paths.

8. **Line 27 · Classes 1–4**  
   **Current:** `What it writes is in the lists of the second image,` through `which the gate holds equal to the files; today the builder's lists open`  
   **Replacement:**
   > The second image, `docs/diagrams/isolation-profiles.svg`, lists each profile’s write allow-list, write deny-list, network allow-list and token variable names, with counts of denied-read entries. After `npm run typecheck`, `npm run diagram:isolation` regenerates it if it differs. `features/arch/isolation-diagram.feature` checks that the worktree SVG matches the generated UTF-8 text, that two renders of the same loaded profiles give the same output, and that a changed profile or a hand edit produces a regeneration diagnostic. It checks XML escaping, token names in place of token values, wrapping within the line budget, and both item boundaries. An item as long as the longest item is drawn on a line of its own in the fixture. An item one character longer than the longest item is refused because, with the separator that may follow it, the line would pass its room. It checks a denied-read summary that exceeds its budget, the exact fit and one-character overflow for each text kind, and those boundaries in the rendered title, subtitle, header and builder role. It checks the SVG font attributes and rejects `tspan` font overrides. On a temporary fixture, the writer adds the generated SVG on the first run and leaves the second snapshot unchanged. The worktree hand-drawn SVG passes its tripwire, and the two modified copies show that it flags a literal `${` and a profile host in upper case. The reviewer checks what the hand-drawn image says about startup and credential ownership. Today the builder’s lists open
   >
   This supplies the 19 scenario titles’ coverage, including the three omissions and the implied positive tripwire case, and identifies the compilation prerequisite.

9. **Line 27 · Classes 1, 3**  
   **Current:** `Before every start a canary proves, with the real profile, that a secret in another sandbox's folder cannot be read and that a port outside the allow-list cannot be reached.`  
   **Replacement:** `Before each sandboxed command starts, a canary with the resolved profile must report that it could neither read a planted secret in a sibling folder nor connect to a test port on the loopback.`  
   `srt-runner.ts:255–293` creates one sibling file and tests one runtime-selected port.

10. **Lines 17 and 171 · Classes 1, 3**  
    **Current, line 17:** `the quoted passage is found word for word in the article's full text` → **Replacement:** `the quoted passage is found word for word in the text supplied to the verifier`  
    **Current, line 171:** `The verifier proves the passage exists in a real, unretracted article.` → **Replacement:** `The verifier checks the DOI and title, checks retraction metadata, and finds the passage in the supplied text.`  
    Line 170 already gives the correct boundary, with host fetching deferred to S.3.

11. **Lines 37, 39, 117 and 128 · Classes 1, 3, 5**  
    **Current, line 37:** `whose reviewer is never of its provider` → **Replacement:** `whose correctness review must use a different provider`  
    **Current, line 39:** `A refusal becomes a new brief that names the findings.` → **Replacement:** `The orchestrator writes a new brief naming the findings after a refusal.`  
    **Current, line 39:** `At its end, whatever its outcome, the host writes into` → **Replacement:** `When a step passes or reaches a recorded refusal, the host writes into`  
    **Current, line 39:** `the gate reads every folder: a brief edited after its run turns the gate red.` → **Replacement:** `the default profile checks the step folders: a brief whose text differs from its recorded hash fails the scenario.`  
    **Current, line 39:** `a ruleset on both refuses a deletion, a rewrite, and a commit on which the two jobs of the gate are not green.` → **Replacement:** `the documented rulesets protect both branches and require the two gate jobs for publication without bypass.`  
    **Current, line 117:** `with the owner's bypass of the ruleset` → **Replacement:** `with an existing ruleset bypass`  
    **Current, line 128:** `a step whose review of correctness is of the builder's provider is refused` → **Replacement:** `whose correctness review must use a different provider`  
    The design scopes provider separation to correctness review, the refusal-to-brief handoff is manual, and `step-record.feature:180–308` includes cases where no record is published.

12. **Lines 79, 114, 144 and 163 · Classes 1, 3, 4**  
    **Current, lines 79 and 163:** `the overhead measures were taken there` → **Replacement:** `the overhead measurements were also repeated there`  
    **Current, line 114:** `and the mutation tool plays them once more before any mutant` → **Replacement:** `and Stryker runs the mutation profile before trying any mutant`  
    **Current, line 144:** `the srt bench gives the same result as Linux CI, test by test` → **Replacement:** `the srt bench matched Linux CI test by test: 92 pass, 5 fail, 3 residual and 6 findings`  
    **Current, line 163:** `Under WSL2 the suite and the srt bench pass` → **Replacement:** `Under WSL2 the suite passed and the srt bench matched the Linux CI results`  
    Journal §38 records the mixed benchmark outcomes and results on three hosts, and `cucumber.mjs:45–52` excludes two root areas from the mutation profile.

13. **Lines 102 and 130 · Classes 3–5**  
    **Current, line 102:** `Each worktree holds its own 542 MB of dependencies, 337 MB of them one native binary; a build session can write them, and the host then runs them.`  
    **Replacement:** `The design records 542 MB of dependencies per measured worktree, including 337 MB for one native binary. The builder profile does not deny writes to the worktree’s dependency directory, and the host runs dependencies during verification.`  
    **Current, line 102:** `the four workflows that install` → **Replacement:** `the five workflows that install dependencies`  
    **Current, line 130:** `a folder of his machine` → **Replacement:** `a local folder on the host`  
    The size is a workstation measurement, five workflow files contain an active install, and the host role suffices to describe where state lives.

14. **Lines 154, 156, 157 and 267 · Classes 2–4**  
    **Current, line 154:** `npm run evidence -- verify` → **Replacement:** `npm run evidence -- verify <ledger> <desk>`  
    **Current, line 156:** `and a run started again does not replay the gate` → **Replacement:** `and a run resumed after its recorded green gate reuses that verdict`  
    **Current, line 157:** `The git the host starts obeys no variable of the host's environment` → **Replacement:** `Host-side git receives a closed allow-list of inherited variables`  
    **Current, line 267:** `a process launched outside` → **Replacement:** `an import of child_process outside`  
    The verifier requires two operands, the delivery skips the gate at a qualifying checkpoint, git inherits allowed variables, and dependency-cruiser checks imports.

15. **Line 271 · Classes 1–3**  
    **Current:** `Nothing in this repository uses Docker.`  
    **Replacement:** `The platform uses srt, and the container benchmark and its launcher script have been removed. The Linux gate’s text guard, features/arch/no-container-command.feature, checks case-insensitive docker and colima substrings in eligible worktree files. It checks the root and bench package scripts, and identifies the script in each modified copy. It reads a symlink target as text. It checks that the six allowed files are present and still contain a match, that an outside match identifies its path, and that the exclusions for .md, results and step records apply. An eligible step.json remains in scope. Fixtures cover an unlisted file, a stale list entry, a removed listed file and a listed file whose match was removed.`  
    This describes all the scenario groups and avoids claiming that a literal scan proves what a program can execute.

### `cucumber.mjs` and `stryker.config.mjs`

16. **`cucumber.mjs:34–42` · Classes 1, 3**  
    **Current spans:** `features/arch runs dependency-cruiser`; `so two workers collide on those files`; `(every file of the tree)`; `(a diagram and the five profile files)`; `(the counted run, \`npm test\`, the gate)`  
    **Replacements, respectively:** `features/arch/guard.feature runs dependency-cruiser`; `so concurrent workers can collide on those files`; `(eligible regular files and symlink targets from git ls-files)`; `(both diagrams and the five profile files)`; `(npm test and the counted Linux gate run)`  
    Only the architecture guard invokes dependency-cruiser, current Stryker concurrency is one, the text scan has exclusions, and the macOS gate only selects `features/sandbox`.

17. **`stryker.config.mjs:15–16` · Classes 1, 4**  
    **Current:** `the default profile minus features/repository (typecheck and format run` / `tsc and prettier in child processes, kill no mutant, and fail on the instrumented sandbox copy).`  
    **Replacement:** `the default paths minus features/repository and features/arch. Those areas check formatting, types, source text or architecture rules on the working tree.`  
    The actual path selection in `cucumber.mjs` excludes both areas.

### `docs/testing.md`

18. **Lines 3, 11 and 26 · Classes 1–3**  
    **Current, line 3:** `No test calls the network or Anthropic.` → **Replacement:** `The default profile uses local fixtures, including loopback network services, in place of the real Anthropic API.`  
    **Current, line 11:** `The scenarios kill every mutant of a changed line. A surviving mutant fails the gate` → **Replacement:** `The Linux gate refuses unaccepted survivors in the changed production perimeter when its plan calls for mutation`  
    **Current, line 26:** `# every scenario (cucumber-js); also \`npm run check\`` → **Replacement:** `# the default Cucumber profile; also npm run check`  
    The integration suite uses loopback, the live profile is separate, and mutation debt has its own acceptance rule.

19. **Line 117 · Class 3**  
    **Current:** `keeps all three when it does not import the file (the child is the proof that the variables were there), and keeps only \`GITHUB_TOKEN\` when it does: the scenario does not depend on the environment of the host.`  
    **Replacement:** `prints all three GIT-prefixed names before importing the support file and prints only GITHUB_TOKEN after importing it. The child receives the three fixture values, PATH and optional TMPDIR.`  
    The step prints names, and the modified launcher intentionally forwards two allowlisted host variables.

20. **Line 127 · Class 3**  
    **Current:** `every path that \`CLAUDE.md\`, \`CONTRIBUTING.md\`, \`README.md\` and the documents of \`docs/\` that describe the tree cite between backticks exists; a pattern, a placeholder or a path into a generated directory is not checked.`  
    **Replacement:** `the listed documents are checked for backticked, whitespace-free path tokens containing a slash and beginning with a known repository-root entry. The check skips patterns, placeholders and generated directories.`  
    The parser also skips ordinary Markdown link targets, bare names and paths whose first segment is unknown.

21. **Line 131, container paragraph · Classes 1–3**  
    **Current:** `the words \`docker\` and \`colima\` appear in no file of the tree outside a closed list, each entry with its reason`  
    **Replacement:**  
    > a case-insensitive substring check over eligible regular files and symlink targets in the worktree. The scenarios check both package manifests and identify the offending script in modified copies. A temporary Git tree shows that the symlink target is read without following it. The six listed paths must exist and still match, and an outside match identifies its path. The examples cover an argv array, a shell script, upper case and a data file, plus the exclusions for `.md`, `results` and step records. An eligible `step.json` remains in scope. A stale allowlist entry, a removed listed file and a listed file whose match was removed are each refused  
    The existing summary covers only the outside-list case, and calls a substring check a word check.

22. **Line 131, isolation paragraph · Classes 1–4**  
    **Current range:** `two files, and each says what it guarantees.` through `or prose that contradicts the profiles, passes it`  
    **Replacement:**  
    > The generated SVG lists each profile’s write allow-list, write deny-list, network allow-list and token variable names, with counts of denied-read entries. The scenarios compare the worktree SVG with the generated UTF-8 text, compare two renders of the same loaded profiles, and check the regeneration diagnostic after a profile change or a hand edit. They check XML escaping, token names in place of token values, wrapping within the line budget, an item exactly at the item limit alone on a line in the fixture, and the refusal of a denied-read summary that exceeds its budget. An item one character longer than the longest item is refused because, with the separator that may follow it, the line would pass its room. The exact fit and one-character overflow are checked for all eight text kinds, with the title, subtitle, header and builder role also checked through the generator. The SVG must declare the expected root font stack and explicit text sizes. The scenarios check the sizes of the fixture texts by kind and reject added font-family and font-size attributes on a tspan. The writer adds only the generated SVG in the first temporary-fixture snapshot and leaves the second snapshot unchanged. The hand-drawn worktree SVG passes its tripwire. One modified copy adds a literal `${` and the other adds an upper-case profile host. The tripwire checks raw SVG text, and the diagram’s statements about startup and credential ownership are reviewed separately. The render behind the font factor and the writer’s lack of subprocess launches are reviewed from source.
    >
    > After `npm run typecheck`, regenerate with `npm run diagram:isolation`.  
    This accounts for all 19 scenario titles and describes the assertions without claiming a renderer test or general filesystem audit.

23. **Line 131, paragraph ending · Class 3**  
    **Current:** `Like the guard, they are left out of the \`mutation\` profile: they read sources and execute no production line.`  
    **Replacement:** `The mutation profile excludes all of features/arch. Its scenarios check worktree text or run dependency-cruiser. The isolation diagram scenarios also call the profile loader and the image writer.`  
    The `loadTemplate` call executes production profile-loading code.

### `docs/operating.md`

24. **Line 11 · Class 1**  
    **Current:** `the suite and the bench; the overhead measures were taken there (journal, §38, §39)`  
    **Replacement:** `the suite passed, the srt bench matched Linux CI test by test, and the overhead measurements were also repeated there (journal, §38)`  
    §38 contains the WSL2 receipts and cross-host measurements.

### `docs/communication/deck/slides/isolation.html` and `docs/design/platform-v3-srt.html`

25. **Slide lines 12, 17, 23–24 and 26 · Classes 1, 3, 4**  
    **Current → Replacement:**

    - `srt 0.0.81, version exacte` → `srt 0.0.83, version exacte`
    - `Là où srt n’est pas supporté, la plateforme ne démarre pas.` → `Sans srt utilisable, aucun lancement en sandbox ne réussit.`
    - `Sans isolation, aucun démarrage` → `Un canari avant chaque lancement sous srt`
    - `Une sandbox témoin doit être refusée en lecture et en réseau.` → `Avec le profil résolu, le canari doit échouer à lire un fichier témoin dans un dossier voisin et à joindre un port de test en boucle locale.`
    - `À prouver · 1b` → `Implémenté dans SrtSandboxRunner`

    In **line 38**, replace `et la version est épinglée exactement, 0.0.81.` with `et la version est épinglée exactement, 0.0.83.` Replace the span from `Il n’y a aucun repli` through `Ce test au démarrage est encore à écrire, à la brique 1b.` with `srt est le seul moyen d’isolation. La gateway et les outils de la boucle utilisent SandboxRunner. Avant chaque commande sous srt, le canari utilise le profil résolu et doit échouer à lire un fichier témoin dans un dossier voisin et à joindre un port de test en boucle locale. Un autre résultat empêche le lancement de la commande.`  
    The lock pins 0.0.83, the loop also uses `SandboxRunner`, and the gateway can listen before it tries to launch its first sandboxed child.

26. **`docs/design/platform-v3-srt.html:69,178,239` · Classes 1, 3, 4**  
    **Current, line 69:** `Sous srt : base.srt.json ; variables : réseau, lectures et écritures en plus ; cwd jetable` → **Replacement:** `Sous srt : profils dans packages/sandbox/profiles ; paramètres résolus au lancement`  
    **Current, line 178:** `ne relaie que les messages vers api.anthropic.com` → **Replacement:** `relaie les POST vers /v1/messages et /v1/messages/count_tokens sur api.anthropic.com`  
    **Current, line 239:** `là où srt n'est pas supporté, la plateforme ne tourne pas` → **Replacement:** `sans srt utilisable, aucun lancement en sandbox ne réussit`  
    There is no tracked `base.srt.json`, the proxy admits two routes, and sandbox admission happens at child launch.

### `docs/diagrams/isolation.svg` and `docs/diagrams/orchestration-loop.svg`

27. **`isolation.svg:3,21–24,68,117–119` and `orchestration-loop.svg:3,27–28` · Classes 1, 3**  
    **Current → Replacement:**

    - Isolation line 3, `What each profile opens, closes, reaches and receives is stated in the other image, isolation-profiles.svg, produced from the five files and held equal to them by the gate.` → `The generated image, isolation-profiles.svg, lists each profile’s write allow-list, write deny-list, network allow-list and token variable names, with counts of denied-read entries.`
    - Isolation lines 21–24, `Paths denied for reading` / `stated in the image of the five` / `profiles, isolation-profiles.svg:` / `their count and where they are read` → `Denied-read entries` / `counted in the generated image,` / `isolation-profiles.svg; the paths` / `are in srt.filesystem.denyRead`
    - Isolation line 68, `What each profile opens, closes, reaches and receives` → `Write lists, network allow-lists and token variable names`
    - Isolation line 3, `a second proxy of the host and the consent of that provider, both held by the host alone, outside the root; the reviewer is never of the author&apos;s provider.` → `a second proxy on the host, with application consent held by the host outside the root. Correctness reviews must use a different provider from the builder.`
    - Isolation lines 117–119, `credential and consent: the host` / `alone, outside the root; reviewer` / `never of the author&apos;s provider` → `host holds consent outside root;` / `correctness reviews use a` / `different provider`
    - Orchestration line 3, `with a reviewer never of the author&apos;s provider` → `with correctness reviews required to use a different provider`
    - Orchestration lines 27–28, `reviewer never` / `of its provider` → `correctness review` / `by another provider`

    The generated image presents selected settings, and the planned provider rule only covers correctness reviews.

28. **`isolation.svg:30,53–56` · Classes 1, 3**  
    **Current:** `relays POST /v1/messages only; one usage line per answer,`  
    **Replacement:** `POST /v1/messages and /v1/messages/count_tokens;`  
    **Current, next line:** `never the content` → **Replacement:** `one usage line per answer without content`  
    **Current, lines 53–56:** `Canary, before every start` / `a secret placed in a sibling sandbox folder must be unreadable,` / `a port outside the allow-list must be unreachable:` / `with the real profile; otherwise the session does not start`  
    **Replacement:** `Canary before each sandboxed command` / `with the resolved profile, a planted secret in a sibling folder` / `and a test port on the loopback must both be inaccessible;` / `otherwise the sandboxed command does not start`  
    `auth-proxy.feature:168` checks the second route, and the canary checks two probes per sandboxed launch.

29. **`orchestration-loop.svg:3,111,124–125` · Classes 1, 3**  
    **Current, line 3:** `Scouts, read-only sessions on a small model` → **Replacement:** `Configured scouts, in sandboxes with read-only worktrees`  
    **Current, line 3:** `each a read-only session in its own sandbox and on its own model, run at the same time` → **Replacement:** `each with a read-only worktree and its configured model, run up to the step’s concurrency limit`  
    **Current, line 3:** `A refusal becomes a new brief that names what failed. At the end of a step the host writes` → **Replacement:** `The orchestrator writes a new brief naming the refusal. For a passed step or a recorded refusal, the host writes`  
    **Current, line 111:** `cannot write; get` → **Replacement:** `read-only tree; get`  
    **Current, lines 124–125:** `commit by the` / `host only; same` → **Replacement:** `host delivers the` / `same`  
    The builder can write Git objects and refs other than `main`, while the host owns delivery.

### `features/arch/isolation-diagram.feature`, `features/steps/isolation-diagram.ts`, `features/support/isolation-rows.ts` and the generated SVG

30. **Separator cluster · Class 1**  
    Locations are the feature at **15–17, 97 and 115–116**, support at **49, 64, 66 and 106–107**, the step diagnostic at **165–171**, and the proposed README and testing descriptions above. Keep the title at **97** as the common rationale, including **“the separator that may follow it.”** The support comment at **107** already has the condition.

    | Location | Current | Replacement |
    |---|---|---|
    | Feature 16–17 | `characters) and the longest item (110, the room of a line less the two characters of the separator " ·" that follows` / `an item when another comes after it).` | `characters) and the longest item (110, the room of a line less the two characters of the separator " ·" that may follow an item).` |
    | Feature 115 | `# The kind "line" is a line of a list: its room, 112, holds an item of at most 110 and the " ·" that follows it.` | `# A line has room for 112 characters, including the two characters of the separator " ·" that may follow an item.` |
    | Support 49 | `/** A line of a list: an item, and the " ·" that follows it when another comes after. */` | `/** A list line can contain several items and a trailing " ·" when the list continues on the next line. */` |
    | Support 64 | `/** The room of a line of a list, trailing " ·" included. */` | `/** The room of a list line, including a trailing " ·" when present. */` |
    | Support 66 | `/** The longest item: the room of a line less the two characters of the " ·" that follows it; alone, it is a line. */` | `/** The longest item: the room of a line less the two characters of the separator " ·" that may follow it. */` |

    The algorithm reserves two characters regardless of an item’s fixture position, appends the separator on continued lines, and leaves the final line without it.

31. **Generated-image contents cluster · Classes 1, 3**  
    **Current, feature lines 3–5 and 42–43:** `the generated image states what each profile opens,` / `closes, reaches and receives` and `what each profile opens, closes, reaches and receives is stated by the other image`  
    **Replacement in both places:** `the generated image lists each profile’s write allow-list, write deny-list, network allow-list and token variable names, with counts of denied-read entries`  
    **Current, feature lines 9–11:** `paths it opens for writing, the paths it closes for writing inside an opened one, the hosts its network list allows,` / `the variables of its environment whose value is the token of a session or of a task, and once the count of the paths` / `denied for reading.`  
    **Replacement:** `write allow-list, write deny-list, network allow-list and names of env.set entries containing a session or task token placeholder, followed by one denied-read count for identical lists or a count per profile when the lists differ.`  
    **Current, support line 185 and generated SVG line 9:** `Runs; then writes · closes (inside a writable path) · reaches · token in (the variables that hold a token)`  
    **Replacement:** `Role · write allow-list · write deny-list · network allow-list · token variable names`  
    **Current, support line 189 and generated SVG line 3:** `what it runs, the paths it opens for writing, the paths it closes for writing inside an opened one, the hosts its network list allows, and the variables of its environment that hold a token. A last row states the paths denied for reading.`  
    **Replacement:** `a role label followed by the profile’s write allow-list, write deny-list, network allow-list and token variable names. A last row gives one denied-read count for identical lists or a count per profile when the lists differ.`  
    **Current, support lines 86, 89, 192:** `The value of a variable of \`env.set\` that is the token of a session or of a task, given by the launcher.` / `its token variables are named, not their values.` / `then the row of the paths denied for reading.`  
    **Replacement, respectively:** `A session or task token placeholder anywhere in an env.set value.` / `it lists the names of env.set entries containing a session or task token placeholder.` / `then the row with denied-read counts.`  
    The implementation copies the lists without parent-path filtering, detects placeholders as substrings, derives the counts, and supplies role labels separately.

32. **Rendering scope · Classes 2, 3**  
    **Current, feature lines 19–20:** `All its texts are drawn in a monospace family, where the width of a text is its count of characters times a factor` / `of the size it is drawn at, and each text carries its own size.`  
    **Replacement:** `The SVG declares a font stack ending in monospace and an explicit size on each text element. The fit check estimates width from the string’s UTF-16 length, the configured size and the advance factor.`  
    **Current, feature line 133:** `Scenario Outline: the image passes each of its constants through the measure of its own kind` → **Replacement:** `Scenario Outline: the image applies the configured size budget to its title, subtitle, header and builder role`  
    **Current, feature line 147:** `Scenario: every text element of the image carries a size, in the family the measure assumes` → **Replacement:** `Scenario: the SVG declares the expected root font stack and explicit text sizes`  
    **Current, support lines 25–26:** `Every text of the image is drawn in a monospace family (\`FONT\`), so that the width of a text is its count of` / `characters times a factor of its size, with no renderer to ask.`  
    **Replacement:** `The image declares FONT at the SVG root. The budget estimates width from the string’s UTF-16 length and the configured font size.`  
    **Current, support lines 33–34:** `A family wider than 0.62 draws past the room,` / `and no scenario can say it.`  
    **Replacement:** `A font with greater advances can overflow near the limit. The scenarios inspect markup and the budget calculation.`  
    **Current, support lines 20 and 61:** `the right border of the image is at \`BORDER\`` / `the right border is not passed` → **Replacement:** `the right edge of the table is at BORDER` / `the estimated text width fits between this kind’s x and end coordinates`  
    These assertions check markup and character budgets, while font selection, glyph widths and rendered overflow depend on the renderer.

33. **Tripwire, generator failure and write snapshot · Classes 1, 3**  
    **Current, feature lines 35–38:** `with what identifies a write (size, inode, times of modification and of change, content), and shows that the first run writes` / `one file, no new directory and no other entry changed, and that the second run changes nothing: a new empty directory` / `or a file rewritten with the same bytes would be seen.`  
    **Replacement:** `with file content, size, inode, mtime and ctime, and compares the entries after each run. The first snapshot adds only the generated SVG and the second equals the first. Directory timestamps are omitted.`  
    **Current, feature lines 45–47:** `The tripwire of the last rule refuses exactly two forms: a template string (a dollar and a` / `brace) and a host of a network list of a profile, compared without regard to case. It is not a guarantee: a path or` / `a host written in another form, or prose that contradicts the profiles without naming one, passes it.`  
    **Replacement:** `The tripwire scans the raw SVG for a literal dollar immediately followed by an opening brace, and for case-insensitive substrings from the profile network allow-lists after stripping each entry from its first colon onward. It checks those literal forms.`  
    **Current, step line 71:** `const expected = produced(profiles);` → **Replacement:** `const expected = profilesImage(profiles);`  
    **Current, step line 82:** `/** The tripwire of the hand-drawn picture: a template string, a host of a network list in any case. */` → **Replacement:** `/** Checks raw SVG for a literal opening template marker and case-insensitive allow-list host substrings with ports stripped. */`  
    **Current, step lines 256–257:** `content, so that a file rewritten with the same bytes is not the same entry. The time of a directory is left out: the` → **Replacement:** `content. A same-content rewrite is visible if it changes recorded metadata. The time of a directory is left out: the`  
    **Current, step line 341:** `the root family, and a text or a tspan that sets its own.` → **Replacement:** `a wrong root font-family, a text element without an explicit size or with its own font-family, or a tspan with a font-family or font-size attribute.`  
    The code uses literal substring matching and before/after snapshots, and a render error must fail the comparison instead of becoming the expected file text.

34. **Worktree inputs and regeneration · Classes 1, 3, 4**  
    **Current:** `the five committed profiles of packages/sandbox` in all matching Given lines in the isolation feature and the corresponding escaped binding at step line 98.  
    **Replacement:** `the five worktree profiles of packages/sandbox`, retaining the existing escaped slash in the binding.  
    **Current:** `the text of the committed file` in both new features and the shared binding at `features/steps/closed-git-environment-text.ts:15`.  
    **Replacement:** `the text of the worktree file`, including the shared binding’s uses in `features/arch/closed-git-environment-text.feature` and the comment at `features/steps/isolation-diagram.ts:38`. Also replace `committed` with `worktree` in the new scenario titles that identify the input file or profile.  
    **Current, script lines 5–6:** `// \`npm run diagram:isolation\`: writes docs/diagrams/isolation-profiles.svg whole, from the five files of` / `// packages/sandbox/profiles (features/arch/isolation-diagram.feature runs writeProfilesImage on a copy of them).`  
    **Replacement:** `// After npm run typecheck, npm run diagram:isolation regenerates docs/diagrams/isolation-profiles.svg` / `// from the five profile files if it differs. The feature calls writeProfilesImage on a temporary fixture.`  
    The Givens read the filesystem, and the CLI imports the sandbox package through its `dist` export.

### `features/arch/no-container-command.feature` and `features/steps/no-container-command.ts`

35. **Scan scope and matcher · Classes 1, 3**  
    **Current, feature line 1:** `Feature: no file of the repository holds docker or colima outside a closed list`  
    **Replacement:** `Feature: eligible worktree files contain no docker or colima substring outside a closed list`  
    **Current, feature lines 2–19:** the span from `The platform left containers` through `a file of an excluded kind given to an interpreter.`  
    **Replacement:**  
    > The platform uses srt. The removed benchmark could start a virtual machine and prune the selected container daemon.  
    >  
    > The guard searches for docker or colima as case-insensitive substrings. It reads regular files and symlink targets from the paths returned by git ls-files for tracked and non-ignored untracked entries. It skips .md paths, paths with a results component, and record.json under steps/. Other eligible paths, including step.json, stay in scope.  
    >  
    > Matches are confined to the listed paths. Each listed path must be present among the scanned files and must still contain a match. Separate scenarios parse the scripts of the root and bench package.json files and identify the offending script in modified copies.  
    >  
    > A substring split across expressions can evade this text check. Excluded paths are outside its scope.
    **Current, step lines 26–28:** `Whether the rule reads the file. Left out: Markdown, the files under a \`results\` directory, and under \`steps/\` the` / `texts given to a session (\`brief.md\`, \`scout.<name>.md\`) and the records (\`record.json\`). Every \`step.json\` is read:` / `the step tool runs its \`checks[].command\`.`  
    **Replacement:** `Whether a path is eligible. Skip case-insensitive .md suffixes, any results path component, and record.json under steps/. Other paths, including step.json, stay eligible unless another exclusion applies.`  
    **Current, step line 37:** `The entries git tracks or would track (not ignored) that the rule reads: relative path -> text.`  
    **Replacement:** `The eligible regular files and symlinks from tracked and non-ignored untracked Git paths: relative path -> text.`  
    The matcher has no word boundaries or language parsing, and `lstatSync` limits the actual reads to regular files and symlinks.

36. **Feature lines 93–95 · Class 2**  
    **Current:** `Scenario Outline: a new <kind> that holds a word is not read`  
    **Replacement:** `Scenario Outline: the scan ignores a new <kind> containing a match`  
    The fixture inserts content directly into the in-memory map, then exercises `isRead` during filtering. The separate symlink scenario exercises real filesystem enumeration.

## Checked and found correct

- **Scenario count.** The README says it comes from a dry run of the default profile over its configured paths. A static tally of standalone scenarios and non-header `Examples` rows across the 118 matching feature files independently gives **3,114**, including **36** for the isolation feature and **26** for the container feature. The evidence and delivery subtotals are **280** and **526**, respectively.
- **Container removal.** The benchmark source and `baseline:overhead` script are gone. The retained analyzer, result files and last modifying commit `be831caa7fbe` resolve. The two package manifests’ script values and the six entries in the closed list agree with the static scan.
- **Diagrams and commands.** The five named profiles exist, their lists agree with the displayed rows, and the current SVG shows **11** denied-read entries with identical lists. The named regeneration script exists. The README’s relative links resolve, and the named `CLAUDE.md` scripts exist. The gate and macOS job names match their configuration.
- Local `main`, `feat/gate-1a` and their local remote-tracking refs agree at `ca2e9999`.

## Could not verify

- Cucumber’s actual dry-run output, scenario execution, gate and mutation results, or clean-checkout regeneration. The review used read-only source inspection and static counts.
- Fresh rendering across font stacks, the historical font measurements, or effective isolation on the named hosts.
- Current forge heads, rulesets, bypasses or CI results. Local refs and the repository’s historical receipts establish only what is recorded locally.
- Cortex methodology and recall were unavailable in the session’s tool inventory. The first Git invocation also hit a denied macOS launcher cache attempt. Subsequent Git reads used the Command Line Tools binary directly. No tests, npm commands or file writes were performed.

