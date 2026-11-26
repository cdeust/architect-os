# The trusted Gate

**Provenance.** Written on 24 November 2026 as the answer of an external security review to the findings of that day
(the six findings it closes are named in « Closure of the six findings » below). It lived outside the repository until
step 1 was built; it is committed here, as it was written, with its links made relative to this repository, followed by
« Step 1 as built », which records the owner's decisions, what step 1 builds, what it corrects in the text above it, and
its threat model. The links of the original pointed at the working files of 24 November; some lines have moved since.

**Decisions of the owner, 24 November 2026.** (1) The independent verifier for publication-grade evidence is the
hosted CI; the local Gate stays a fast feedback and the narrower confined-builder claim. (2) The frozen Step inputs stay
in git; the authoritative final outcome goes to durable evidence keyed to the delivered tree (one final review pass).
(3) A change to the judge (a policy relaxation or a new gate) needs the owner's explicit approval of the exact digest
and of the intended change; the automated publisher gets an identity without ruleset bypass. (4) Steps 1 to 4 are built
now, steps 5 to 9 later.

---

**I would adopt the trusted launcher and the immutable Git tree. I would change who is allowed to testify.** A host process can establish which commit it ran, which policy it applied, which processes finished, and which bytes they returned. If a Cucumber step and the code under test share a JavaScript process, that process can also manufacture the evidence of a pass. Moving its report under a sandbox, hashing it, signing it, or reproducing it on a fresh CI machine preserves that limitation.

I would give delivery three independently checkable facts: **Step accepted tree `T`; the local Gate judged commit `C` containing exactly `T` under released policy `P`; the hosted verifier independently judged the same subject under `P`.** Each Gate verdict would distinguish assertions observed by a protected driver from results reported by candidate-controlled tests. The latter remain valuable and can make a delivery red. They cannot discharge a requirement for an independent witness.

I reviewed the working files, offline, without changing files or running a suite. This distinction matters here: eight of the 21 named files I compared differ from their blobs at `HEAD` `4c6495b9602b2499927ad3816185a0a80187f660`, including `tree-fingerprint.ts`, `deliver.ts`, `with-tree-lock.py`, and the roadmap. The findings below concern the supplied worktree. The costs identified as historical come from the repository. The proposed controls have not been exercised. The Cortex methodology and recall endpoints were unavailable.

## The execution design

### 1. Establish the authority before touching the candidate

The operator starts an **installed, versioned launcher** from outside every builder-writable directory. Its protected release manifest identifies the exact Gate and delivery programs, interpreter and tool versions, dependency graph, profiles, policy, canary, trusted test drivers, and workflow definition. An active release is selected by owner-controlled state. A moving `main` checkout is a useful distribution source, but its live contents and its installed `node_modules` are insufficient as a release identity.

The controller starts in the release directory with absolute executable paths and fixed arguments. It obtains the repository identity, admitted run, expected publication base `B`, and destination refs through trusted adapters. Git and the forge client run from a host-controlled repository with their own narrow environments. Only the publication adapter gets publication credentials. Candidate paths, npm, `INIT_CWD`, Git configuration, Node loaders, and shell startup files have no role in finding a host program. This applies to **delivery itself**, including `git` and `gh`, before it applies to the Gate. Today the production composition root supplies both programs by bare name. [Delivery composition root](../../tools/deliver/src/main.ts) · [Host execution boundaries](../../CLAUDE.md)

For the first release, I would admit **one host-created, single-parent commit directly on `B`**. Today delivery accepts an ancestor, while the Gate computes changed lines against the candidate’s first parent. Those can be different commits. An ordinary multi-commit delivery could therefore publish changes outside the final commit’s mutation perimeter. Supporting stacks later means judging each edge or explicitly judging the complete publication delta. On resume after the first destination has advanced, delivery retrieves the original `B` and proof and rechecks both destinations and their ruleset evaluations. [Delivery prerequisites](../../tools/deliver/src/application/deliver.ts) · [Gate perimeter](../../tools/test-gate/src/infrastructure/gate.ts)

### 2. Capture once and review the object that will be committed

Keep the existing pre-build fingerprint as an **intake** field. After a successful build, the host imports the proposed changes into a private object database. It starts from pinned `B`, accounts for every tracked path, deletion and executable-bit change, and enumerates additions without consulting the candidate index, `.gitignore`, `.git/info/exclude`, or global excludes. The released policy identifies disposable paths such as dependency and build directories and keeps local-only material such as `.env` files out of intake. Additions at reserved paths are ineligible for delivery. A proposed change to the exclusion policy goes through policy promotion.

The importer walks anchored directory handles. It accepts ordinary files from opened, type-checked handles, reads the bytes once, and creates each blob from those bytes. It refuses filesystem crossings, external hard-link aliases, special files, gitlinks, embedded repository metadata, reserved names, and names that collide on the destination filesystem. It never follows a candidate symlink or invokes Git inside a discovered directory. For the first version I would refuse tracked symlinks throughout the submitted tree. The committed `HEAD` inventory here has **1,172 regular files, 8,083,057 bytes of blob content, and zero symlinks or gitlinks**. Validate the actual submission on every run. The linked worktree’s own administrative `.git` entry is identified at intake and excluded.

The resulting tree is stable even if a detached builder continues writing its old worktree. Capture can observe a mixture of versions while the builder is active. The guarantee is that **every subsequent consumer sees the same captured bytes**. A claim that all bytes existed simultaneously would require excluding writers or taking a filesystem snapshot. The existing check-then-`add -A` sequence provides neither guarantee. [Current fingerprint](../../packages/sandbox/src/tree-fingerprint.ts) · [Measured detached-child limit](../../docs/design/platform-v3-srt.md)

Materialize the captured tree by walking **raw tree and blob objects** into a new host-owned directory under the admitted run. Verify names, modes and bytes against the manifest. Ordinary checkout can apply working-tree conversions; archive can apply export attributes. Neither operation by itself establishes byte identity. No source view inherits the builder’s ignored files, dependency directory, object alternates, hooks, or writable inodes. Tests requiring Git get a separately constructed disposable fixture repository inside their worker. Its refs cannot affect the subject or publication.

There is a real self-reference in Step. It currently writes `steps/<name>/record.json`, including review outcomes, **after** the reviews. Appending that file and committing would change the tree just approved. To preserve the repository convention, I would capture the build tree, run its checks and reviews, then compose the frozen inputs and their host-generated record into a final tree `T`. The host verifies that the entire difference consists of the expected Step files. Final checks and reviewers receive read-only views of **`T`**. Their final acceptance lives outside the tree and names `T`. The host creates `C` directly from `T` and `B`, verifies `C^{tree} == T`, and advances its private ref conditionally. It never stages the live builder tree again. Rework produces a new tree and invalidates the affected acceptances. Old records keep their historical intake meaning. [Step execution and publication](../../packages/sandbox/src/step-tool.ts) · [Committed record convention](../../docs/design/orchestration-fable-5-2.md)

### 3. Assign each process its inputs and outputs

| Process | Working directory and readable inputs | Writable outputs and authority |
|---|---|---|
| Released Gate planner | Release directory. Reads verified objects for `B` and `C`, policy `P`, and authenticated parent evidence where available. Parses candidate sources and Gherkin as data. | Host-only `<run>/control/plan` and inventory. Owns scenario identities, changed lines, debt comparison, canary outcomes, required platforms, mutation identities, and replay requirements. |
| Step checker and reviewer | Separate read-only exports of `T`. Checker gets fixed tools and private scratch. Reviewer gets the frozen prompt and only its existing model-proxy capability. | Private scratch and bounded output streams. The launcher records the tree ID, process completion, and structured result. Neither can change `T`. |
| Typecheck and functional worker | Fresh phase directory. Read-only source and approved tools/dependencies. `tsc -b` gets private build output; tools requiring writes beside sources get a private derived copy. | Only that phase’s scratch, generated `dist`/build information and raw output. Generated code remains candidate code. It is sealed before transfer to another phase. |
| Mutation and replay workers | Fresh, separate phase directories derived from the same source. The released planner provides literal source identities, ranges and expected mutants. Stryker gets its own writable copies. Replay gets a pristine control and an independently constructed mutant copy. | Per-worker mutation report, replay observations, stderr and scratch. No worker can rewrite another worker’s control, the plan, the canonical source, or a previous report. No restoration of live source is necessary. |
| Protected assertion driver and collector | Release directory or a separately protected verifier worker. Imports only released verification code. Addresses the candidate process through a narrow protocol and evaluates expected behavior outside its address space. | Host-owned observations and a sealed evidence manifest. Only the host adjudicator can produce `gate-report.md`, the parent baseline and the delivery receipt. |

Use a dedicated **`gate-phase` srt profile**, not `builder` or the current `checker` unchanged. Construct the environment from empty: fixed trusted `PATH`, locale, private `HOME`, `TMPDIR`, controlled cache paths, and the phase’s explicit inputs. Invoke absolute `node`, TypeScript, Cucumber and Stryker entry points. Give workers no host runtime root or admission binding, Git or forge credentials, SSH agent, model proxy, npm registry, dynamic-loader variables, lease descriptor, arbitrary inherited descriptors, or CI command files. If a test exercises runtime admission, give it a **fixture runtime with its own marker and state** inside the isolated environment. The real runtime stays outside.

The worker must be able to read its source, dependencies, required OS runtime files and scratch. It must be unable to read private host data or reach state, sibling runs, caches with credentials, signing services, or the publication channel. Existing srt profiles use named read denials. Adding a few `allowRead` paths does not establish a general read allowlist. Qualify actual reads, writes, process interaction, IPC and network on each OS. Where the installed backend cannot enforce the required boundary, run that worker in a disposable VM or isolated runner. [Current profile binding](../../packages/sandbox/src/srt-runner.ts) · [Existing limits on host reads](../../docs/design/platform-v3-srt.md)

**Keep the judge’s dependencies distinct from the subject’s dependencies.** The controller loads only its release graph. The subject needs dependencies for its admitted lockfile, OS, architecture and Node ABI, with internal workspace packages resolving to **candidate** sources. A symlink to the launcher’s entire `node_modules` can silently test launcher code. Initially use a pinned installer, controlled configuration, integrity-checked inputs, disabled lifecycle scripts, and a new subject installation outside the builder’s control. Route lock changes for explicit dependency admission. A controlled installer handles acquisition; the candidate worker stays offline. Introduce a shared store only after both platforms prove workspace resolution and resistance to replacement through every alias. [Dependency design and outstanding measurements](../../docs/design/orchestration-fable-5-2.md)

### 4. Decide what the evidence proves

The host calculates the scenario universe from the objects, and the mutation inventory from verified source bytes using released tooling. Preserve the existing identity, count, debt, canary and replay rules. Carry deletions and both sides of renames through classification. Initially refuse source names that the mutation backend interprets as patterns, and line separators whose coordinates Git and the instrumenter interpret differently. Add support only when a literal mapping is proven end to end. The roadmap already identifies these cases. Also remove candidate configuration discovery from planning: today even `mutationCatalog(root)` calls Cucumber’s configuration loader at that root. [Roadmap](../../README.md) · [Mutation catalogue](../../tools/test-gate/src/infrastructure/mutation-catalog.ts)

Treat `cucumber.ndjson`, Stryker JSON and candidate replay output as **untrusted observations**. Prefer bounded streams into files opened by the collector. If a tool requires a filename, collect from an isolated outbox through pinned handles, with size/type/link limits and no concurrent writer at sealing. Parse the sealed bytes once. Verify subject, phase, complete expected IDs, uniqueness, selection, controls, terminal events and actual process disposition. A timeout, crash, malformed stream or absent lane cannot become a pass or substitute for a mutation witness. A report-provided filename, replacement or scenario selection cannot instruct the host to execute or edit anything.

For an independently required behavior, the released driver owns the assertion. It supplies the input, observes the response or external side effect, and distinguishes the expected failure from a harness failure. For a detected mutant, require a passing original and a failing designated assertion on the independently derived mutant. Preserve distinct expectations for survival, authorized debt, and the canary’s deliberately uncovered case. Candidate-authored scenarios still run, including new ones. If a required independent assertion has no protected driver, its status is **unverified**, and automatic delivery requiring that assertion stops. A VM protects the machine; it cannot make an in-process assertion independent. [Existing verdict rules](../../tools/test-gate/src/domain/verdict.ts) · [Existing replay controls](../../tools/test-gate/src/domain/replay.ts)

The issuer writes a versioned record under host-only `<root>/state/gate/`, keyed by repository, subject, policy and attempt. Bind `B`, `C`, `T`, Step acceptance, release and dependency digests, profiles, platform, plan/inventory digest, required and completed lanes, assurance of each result, and sealed evidence digests. Publish atomically only after final adjudication. Delivery accepts a result directly from its controller, or verifies a reusable attestation from an authorized issuer with current policy and revocation state. A failed or interrupted attempt cannot resurrect a superseded green result. Retain the existing durable-write precautions. Retire v1 for authorization; `latest.json` can remain a lookup convenience.

**Same-UID limit:** against a builder and descendants that remain effectively confined, the host can own the receipt. Against hostile, *unconfined* code running as the owner, `0600`, a private directory, a random filename, and a signing key readable or callable by that UID provide no independent issuer. For that threat, use an isolated service principal with protected files, IPC and credentials, or a separate VM/remote verifier. Until then, disable durable local authorization against that adversary. [Current receipt and proof predicate](../../packages/sandbox/src/gate-receipt.ts) · [Current reuse decision](../../tools/deliver/src/application/deliver.ts)

## Native sandbox and PostgreSQL lanes

**Sandbox scenarios.** Partition by required capabilities in the released plan. Partition the **support-code imports** as well as the feature paths. The current macOS profile selects `features/sandbox/**/*.feature` while inheriting broad root and component step imports. A host-side Cucumber invocation with that profile would still load candidate JavaScript. Account for native cases in the Linux default suite, mutation dry run and replay too. Every planned scenario must map to an executed lane exactly once within its required run. [Cucumber profiles](../../cucumber.mjs) · [Mutation profile](../../stryker.config.mjs)

For a test of the **released isolation mechanism**, a trusted native driver can start a top-level srt subject directly. It selects a fixed profile and harmless fixture by ID and observes allowed writes, denied reads and connection outcomes from outside. No candidate callback supplies executable paths, arbitrary profiles, or host setup. For a test of the **candidate gateway, sandbox launcher, profile compiler, child cleanup, or candidate scenario that itself starts srt**, run the candidate harness inside a disposable native OS environment. There it starts srt once. Use a Linux guest/ephemeral Linux runner with the required namespace support, and a macOS guest or ephemeral macOS runner for Seatbelt. A Linux guest on a Mac cannot certify Seatbelt. The guest has no host mount, owner identity, signing channel or publication token. Its destruction also disposes of detached descendants. Ordinary checkouts, separate jobs on a persistent owner runner, and a weaker nested-sandbox switch do not supply this boundary.

**PostgreSQL.** The current helper discovers binaries from `PG_BIN` or `PATH`, inherits the process environment, initializes a PostgreSQL 17 cluster with local `trust`, and starts a detached watchdog. The hosted Linux producers install pgvector. The current macOS lane intentionally installs no PostgreSQL; its socket-denial scenario uses a witness listener. Preserve that distinction. [PostgreSQL helper](../../features/support/pg-server.ts) · [macOS job](../../.github/workflows/gate.yml)

For either OS when PostgreSQL scenarios are requested, the simplest supportable first implementation is **one disposable native guest per DB lane**. Provision trusted PostgreSQL 17 and pgvector there. A guest fixture supervisor selects the absolute binaries, sets `LC_ALL=C`, creates private `PGDATA` and a short private Unix-socket path, disables TCP, and provisions fresh databases and a test role. Candidate clients see only that disposable endpoint. Tests that exercise server administration, migrations, the watchdog or a privileged SQL role stay entirely in the guest. The outside collector requires a successful real pgvector operation, isolation from a sibling database, and teardown on normal exit and cancellation. A missing extension, blocked socket, or unavailable platform is a failed prerequisite. I would **not** add a workstation Postgres exception to srt: this repository records that Linux srt ignores `allowUnixSockets`, and documents platform-specific listener failures. [Native topology and socket evidence](../../docs/design/platform-v3-srt.md)

## Hosted proof and legitimate changes to the judge

Run a **protected controller workflow** from an owner-approved revision, or use a separate verifier repository/App. Stage candidate objects through an inert channel. In particular, classify changes **before `pushTrial`**: pushing a candidate-defined workflow to a workflow-enabled branch already crosses the boundary. An Actions-disabled staging repository is one workable GitHub transport. Candidate workers get no write token, secrets, OIDC signing authority, trusted cache publication, or access to the verifier’s workflow command files. The privileged collector runs in a separate clean job or service that has never executed candidate code.

Bind hosted proof to repository identity, controller workflow ID/path and definition digest, release `P`, event, run and attempt, candidate `B/C/T`, expected jobs, producer attempts and artifact digests. With a protected-branch dispatch, GitHub’s `head_sha` can identify the **controller revision**. Record and independently verify the candidate OID in the attested payload. Preserve the existing two functional shards, mutation/replay producer completeness, macOS result, and failed-job rerun semantics. Reuse an earlier producer only with explicit provenance for that exact subject, run, policy and artifact. Enforce the protected issuer on **both destination refs and every publication path**, including automated PR merges. Re-read the expected remote tips and use a conditional, fast-forward-only publication. A ruleset audit after a push is worth retaining; a refusal after `main` moved is too late to protect `main`. [Current run selection](../../tools/deliver/src/infrastructure/gh-forge.ts) · [Hosted producers](../../.github/workflows/gate-lane.yml) · [Other merge path](../../.github/workflows/pipeline-after-merge.yml)

**Policy succession:** `P` judges the commit proposing `P+1`. The ordinary path detects changes to the trusted execution and policy closure, including additions, deletions, mode changes and both sides of renames. This covers workflows and local actions, Gate and delivery, `aos` and runtime, profiles, package manifests/scripts/import maps and locks, Cucumber/Stryker configuration, canary, debt/exemptions, protected drivers, and their transitive inputs. A list of six filenames would miss indirect changes. Keep ordinary product code outside the controller’s import graph so the distinction is enforceable.

A policy change gets an explicit maintenance delivery. The predecessor applies its existing scope and debt rules. The proposed judge runs **without authority** on an owner-held corpus containing required greens, required reds and previously accepted compatibility cases. Compare both policies’ selected paths, mutants, exceptions and outcomes. An independent reviewer explains every intended weakening or incompatible change; the owner approves the exact release digest and effective point. If an old invariant deliberately changes, record the precise exception under predecessor governance. Publish the successor separately and use it for **subsequent admissions**. This lets a new gate, lockfile, perimeter or workflow ship without choosing its own examiner.

## Closure of the six findings

| Finding | What closes it | Residual and what holds meanwhile |
|---|---|---|
| 1. Candidate defines its judge | Released controller, policy, toolchain and protected assertion drivers. `P` judges `P+1`. | Trust moves to release installation and promotion. Today frozen Step prompts are a precedent, but the Gate program and configuration remain candidate-selected. |
| 2. Candidate executes on the host | Trusted absolute executables, object export, separate dependency graphs, isolated phase workers, native guest for incompatible cases, and no real runtime capability in children. | Kernel, srt and runner compromise remain. Existing Git hardening and the lease protect particular Git and replay operations. Fresh hosted installs remove the workstation’s ignored dependencies from those jobs. Neither protects the present local host execution. |
| 3. Candidate supplies green evidence | Protected plan, independent observations, sealed collection, host adjudication and isolated issuer. Delivery rejects v1 as authority. | Candidate white-box tests can lie. Current schemas, digest, checkout identity and atomic writes catch corruption and some stale evidence. They do not authenticate an owner-UID writer. |
| 4. Reviewed bytes can change | Final checks, reviews, commit and delivery bind the same `T`. Commit by object ID and pinned parent. | Capture can span concurrent edits. An unconfined owner process can compromise an owner-held store. Existing checker/reviewer restrictions constrain those sessions; `killGroup` and the intake fingerprint do not freeze the builder’s tree. |
| 5. Ignore rule conceals executable input | Intake enumeration uses released exclusions. All later discovery operates on verified objects and enumerated phase inputs. | The exclusion policy and generated-input mapping need review. The current nested-repository and attribute guards address adjacent Git hazards. A clean CI checkout eliminates workstation-only files in CI, after local exposure has already occurred. |
| 6. Candidate supplies the hosted judge | Protected workflow revision and issuer, inert staging, subject-bound attestations, complete producer provenance, and controlled policy succession. | Forge admins, bypass identities and verifier compromise remain. Current exact-SHA checks, effective-job checks, fresh installs and ruleset reads are useful against accidents. A candidate-authored workflow can satisfy the same names. |

The repository itself still classifies host execution of worktree code as R-2 and the escaped process group on macOS as R-7. These are material limits on the present claim. [Sandbox residual risks](../../packages/sandbox/README.md) · [Process-group implementation](../../packages/sandbox/src/process-group.ts)

## STRIDE

| Threat | Enforcement and residual |
|---|---|
| **Spoofing** | Verify issuer, release, subject, platform, run and producer attempt. Bind each required witness to its designated driver. A valid worker identity can still return a false application-level assertion. |
| **Tampering** | Immutable objects, private exports, separate phase outputs, raw-object diff, sealed collection and conditional ref updates. Verify release dependencies and reject filesystem aliases. A compromised protected controller remains authoritative. |
| **Repudiation** | Retain the exact plan, subject, release, approval, lane statuses, witness digests, rerun lineage and publication evaluations. For evidence against the workstation owner, retain it under a different principal. |
| **Information disclosure** | Isolate home, keychain, agent sockets, runtime state, sibling runs, database, credentials and CI channels. Bound and sanitize diagnostics before rendering or retention. Reviewer/model access remains an explicit separate capability. |
| **Denial of service** | Bound input expansion, parser resources, report bytes, processes, elapsed time and scratch. Reserve capacity before parallel work, cancel on exhaustion, and dispose only the owning run. Workstation free-space admission is a starting check; macOS still lacks a hard per-srt memory/PID guarantee. Use a disposable resource-limited guest for hostile workloads requiring that guarantee. |
| **Elevation of privilege** | No candidate import in the controller, publication process, privileged CI job, DB supervisor or native host driver. No host-authorized arbitrary command/profile API. Stronger same-UID or sandbox-escape threat models require an independent OS or service boundary. |

## Ordered pull requests

These are **incremental costs per Gate**, except where identified as a Step or release cost. For sizing, one full source view at the inspected `HEAD` is about **8.1 MB logical** plus filesystem overhead. The repository records **542 MB** per dependency installation, **337 MB** attributable to one native binary, and one historical `npm ci --ignore-scripts` at **70 seconds**. Budget roughly **one extra minute and half a gigabyte per fresh local installation** until measured on this lock and machine. A hosted lane already paying for one clean install should reuse that subject installation inside the lane. Historical cold srt starts were **0.2–0.7 seconds median**, and one historical Gate took **49 minutes, including 35 minutes of replay**. Those are sizing inputs, not forecasts. [Dependency measurement](../../docs/design/orchestration-fable-5-2.md) · [Install observation](../../docs/design/journal.md) · [Replay observation](../../docs/design/journal.md)

| PR | Production change and files | Acceptance witness | Incremental cost and decision measurement |
|---|---|---|---|
| **1. Protect delivery entry and preflight** | `aos`, `tools/deliver/src/{cli,main}.ts`, `infrastructure/{host-process,git-repository}.ts`, `application/deliver.ts`, `deliver.json`. Pin host executables, enforce `B` as direct parent, classify control changes before trial push. Bootstrap the first release through explicit owner maintenance approval. | Benign ordinary change reaches trial. A changed workflow, renamed judge input, or extra unchecked ancestor is stopped **before any push**. A harmless executable-name sentinel records zero host invocations. | One object diff and release-manifest check, no extra install or suite. Measure startup, closure coverage and ordinary-path false refusals. |
| **2. Establish protected hosted proof** | `.github/workflows/{gate,gate-lane}.yml`, protected controller definition, `tools/deliver/src/{domain/ci,infrastructure/gh-forge}.ts`, `fetch-ci-artifacts.sh`, and the merge consumer. Add the protected requirement alongside existing checks before switching branch enforcement. | Same-name green run, wrong controller digest, missing macOS job, missing producer, stale attempt artifact, and wrong candidate payload each fail. A genuine failed-job rerun with complete lineage succeeds. Exercise ordinary and policy-maintenance delivery. | Replacing the driver need not duplicate the 16 lanes. Parallel qualification temporarily costs one extra hosted run for each qualification commit. Measure billed minutes by OS, queue latency, artifact bytes and rerun cost before cutover. |
| **3. Introduce the object importer and exporter** | `packages/sandbox/src/{tree-fingerprint,worktree}.ts`, `tools/test-gate/src/infrastructure/{git,workspace}.ts`, `tools/deliver/.../git-repository.ts`. Use object-based inputs for actual admission and perimeter checks immediately. | An added ignore rule cannot hide a harmless added step. Tracked-now-ignored edits still appear. A disposable marker stays out. An attribute fixture preserves exact blob bytes. Gitlink, alias, special file, ambiguous name and unsupported mutation coordinate each have a specific refusal. | One intake scan plus about 8.1 MB per full view at this HEAD. Measure warm/cold traversal, peak allocation, concurrent edits and metadata-heavy paths on both filesystems. |
| **4. Bind Step and commit** | `packages/sandbox/src/{step-tool,step-admission,step-record,steps-folder,step-checks,srt-runner}.ts`, checker/reviewer profiles, `features/descriptive/steps.feature`, delivery prerequisites. Preserve historical record parsing. | After a barrier confirms capture, change a harmless marker in the old worktree. Both final reviewers, the checker and `C^{tree}` must see the captured version. Change it before capture as the positive control. A refused final review, altered record or moved parent produces zero publication. | No added Gate suite. One final source view plus final checks/reviews **per Step** if keeping the in-tree outcome record. Measure model tokens, elapsed review time and disk separately. |
| **5. Remove workstation execution of the candidate Gate** | `tools/deliver/.../process-gate.ts`, `tools/test-gate/{gate.sh,with-tree-lock.py}`, `packages/sandbox/src/{port,srt-runner}.ts`, runtime admission. First run the complete compatibility suite in a disposable native worker where necessary. Keep the host launcher in control. Disable legacy receipt reuse. | Run through the real delivery entry. Only the disposable worker sees its writable marker. Host state, sibling scratch, issuer and forge channels remain inaccessible. A pre-existing v1 green cannot skip execution. Worker failure leaves the ordinary path red. | One clean install per fresh local worker, approximately 542 MB and the historical 70-second order of magnitude, plus guest provisioning, build, PG and mutation scratch. Measure guest startup, p95 peak and cancellation cleanup; local and hosted proof must be distinct executions. |
| **6. Seal the plan and phase boundaries** | `tools/test-gate/src/infrastructure/{gate,mutation-inventory,mutation-catalog,replay,replay-cucumber,workspace}.ts`, released `cucumber*.mjs`, `stryker.config.mjs`, `packages/sandbox/profiles/gate-phase.json`, report adapters. Move phases one at a time behind the mandatory isolated path. | Worker receives the exact nonempty inventory. A missing case, wrong source digest, substituted report, incomplete terminal or sibling-phase write fails. Clean control passes and a designated mutant fails its expected assertion. Capture remains unchanged after replay and cancellation. | About 8.1 MB logical per concurrent full source copy, plus generated files and reports. Estimate launch overhead as number of additional starts × historical 0.2–0.7 s. Measure real replay fan-out, copy-on-write allocation, peak report volume and worst changed-file lane before choosing batching. |
| **7. Require independent native and DB witnesses** | `features/sandbox/`, narrowly loaded released drivers, `features/support/{postgres,pg-server}.ts`, native runner adapter and hosted lane definitions. Add protected assertions by capability while keeping the existing suite mandatory. | Native write-allowed and read-denied controls work on both OSes. An intentionally adverse fixture yields the expected observed failure. The candidate launcher actually starts srt. PostgreSQL executes a real pgvector operation in its assigned DB; sibling access fails. Forced termination leaves no reusable guest or endpoint. | One native guest allocation per required OS lane, one temporary cluster per DB lane, plus original/mutant executions for newly independent assertions. Measure billed minutes, cluster peak bytes and teardown, especially during replay. No macOS PG cost unless that lane is required. |
| **8. Authorize receipt v2 and policy promotion** | `packages/sandbox/src/gate-receipt.ts`, `tools/test-gate/src/infrastructure/locked-command.ts`, delivery `ports.ts` and `deliver.ts`, protected verifier and release manifest. Enable reuse only for protected issuers and a matching current policy. | Valid evidence resumes an interrupted delivery. Wrong tree, parent, policy, evidence class, superseded attempt or issuer each fail. A successor that accepts a known-red case cannot promote. A legitimate successor is judged by its predecessor and takes effect on the next admission. | Hash the retained evidence once and persist a small manifest plus selected evidence. Reuse can save a complete Gate. Measure retained bytes, verifier time, restart/revocation behavior and the real cache-hit rate. |
| **9. Share dependencies after qualification** | Installer/runtime adapters, builder profile, root and `bench` locks, workflow install steps, advisory inventory, architecture and installer scenarios. Remove builder registry access when host provisioning takes over. | Both lock graphs survive conversion, including peers, platform optionals and workspace links. A lifecycle witness remains untouched. Two real sandboxes per OS exercise replacement, missing/damaged store and interrupted install. Require nonempty mutation and replay on both platforms. | Target saving is up to roughly 542 MB of logical duplication per additional tree at the historical size. Measure physical bytes, inode identity or clone allocation, cross-device refusal and install latency before selecting the import mode. |

The pre-cutover path retains its existing checks until its replacement has passed the same positive cases and the new refusal witnesses. No transition should have an automatic fallback from an unavailable protected worker to candidate execution on the owner workstation. If the owner cannot provision a native boundary, that lane remains pending and cannot authorize publication.

## Decisions for the owner

1. **Should delivery withstand a hostile process already running unconfined as your workstation UID?** I recommend a separate verifier principal or disposable runner for publication-grade evidence. Local srt remains useful for rapid feedback and for the narrower confined-builder claim.
2. **Must both a local execution and a hosted execution independently cover every native scenario?** I recommend retaining two independent Gate decisions and spelling out each one’s platform coverage. Use hosted macOS for native candidate-launcher coverage if a local macOS guest is too expensive. Count that hosted result once.
3. **Which behaviors require an independently observed assertion before automatic delivery?** I recommend starting with isolation, admission, evidence integrity, publication, and changes to the judge. Keep the full cooperative suite and mutation/replay mandatory. Record the remaining independent coverage explicitly.
4. **Is keeping final review outcomes in the same commit worth a second review pass?** My design preserves the current convention and pays that cost. My product recommendation is to keep the frozen Step inputs in Git and the authoritative final outcome in durable evidence keyed to the delivered tree. That permits one final review and avoids self-reference.
5. **Who may approve a policy relaxation or a new judge?** I recommend independent technical review of the predecessor/successor difference and owner approval of the exact digest and intended change. Give the automated publisher an identity without ruleset bypass.
6. **What temporary disk and runner budget is acceptable before the shared store is qualified?** I recommend paying for one clean subject install per fresh local worker, measuring actual peaks, and limiting concurrency first. If that exceeds budget, use isolated hosted capacity or reduce simultaneous runs. Reusing the builder’s dependency tree would reopen the original defect.

The largest mistake in the proposed direction is the phrase **“the host read the reports through its own code.”** It answers who parsed the evidence. The security decision turns on **who was able to produce the observation that made the verdict green**. The second mistake is treating a fresh checkout, a frozen launcher path, or a read-only reviewer as a complete boundary. Each needs an immutable subject, a protected execution graph, and an issuer the candidate cannot impersonate.


---

## Step 1 as built: delivery entry, preflight and the owner's approvals

### What the step builds

- **The entry.** `"$LAUNCHER/aos" -- deliver <name> [--until ci]`, run from the candidate's worktree root, starts the
  compiled command of the installed launcher with the admission's pinned Node (`aos`, `tools/deliver/src/main.ts`). Git
  is `/usr/bin/git`, the forge client `/usr/bin/gh` on Linux, `/opt/homebrew/bin/gh` or `/usr/local/bin/gh` on macOS;
  both get a fixed search path for their helpers. The policy is the launcher's own `tools/deliver/deliver.json`; a
  policy inside the candidate is refused (`DELIVERY_LAUNCHER_IN_SUBJECT`), so is a launcher that is itself the subject,
  and a directory that is not a worktree root (`DELIVERY_WORKTREE_REQUIRED`). The candidate's script `npm run deliver`
  is gone: the candidate's copy of the command decides nothing.
- **One edge.** Before any trial branch, the commit has exactly one parent, the head of every destination still behind
  (« la tête distante n'est pas le parent unique du commit »): the Gate judges `C` against `HEAD^1`, so the publication
  is exactly the judged diff.
- **The judge.** The paths changed between the two objects (`diff-tree -r --name-only -z --no-renames`: additions,
  deletions, mode changes, both names of a rename) are classified against `judgePaths` of the installed policy, before
  the trial push. A rule `dir/` is a root-relative subtree, `**/name/` a directory of that name at any depth
  (`**/node_modules/`), any other a basename pattern. A change of the judge needs the owner's maintenance approval of
  that commit, read in the preflight and again before the first destination.
- **Publication (P1 and P10 of the retired publication prompts).** Phase 5, the push of the commit to the destinations
  of the policy, needs the owner's publication approval of that commit. It is asked in the preflight, before the trial
  branch, and read again just before the first destination is pushed, so that a record withdrawn or expired during
  the gate and the CI stops the run at `publication`. `--until ci` is the one mode without it: explicit on the command
  line, it ends at `ready`, pushes no destination, and its receipt (the line on the standard output and in
  `deliveries.jsonl`) says `"approval":"until-ci"`; a run to its end records the bounds of the record it read.
- **The port.** `Approvals.read(kind)` gives `absent`, `untrusted` or the record; the domain (`domain/approval.ts`)
  decides it against the repository of the policy, the commit, `Clock.now()` and `approvalHours`. Each failure has its
  reason: absent, not receivable (not the owner's alone, not of its form, a life longer than the policy allows, a start
  in the future), another commit or repository, expired.

### The owner's gesture

One command, run by the owner from the installed launcher:

```sh
sudo "$LAUNCHER/tools/deliver/approve" publication cdeust/architect-os <full commit hash>        # 24 hours
sudo "$LAUNCHER/tools/deliver/approve" publication cdeust/architect-os <full commit hash> 2      # 2 hours
sudo "$LAUNCHER/tools/deliver/approve" maintenance cdeust/architect-os <full commit hash> "Require the macOS job"
```

It needs root (sudo, so the owner's password); it refuses an existing directory that is a link, not owned by root, or
writable by group or others, and refuses `ARCHITECT_OS_APPROVAL_DIRECTORY` when it runs as root. It writes one file, `/etc/architect-os/delivery-<kind>.json`, mode
0644, owned by root, by an atomic rename into `/etc/architect-os` (created 0755 by root when absent). The record names
the kind, the repository, the full hash, the time it was given and the time it ends: 24 hours by default, at most what
`approvalHours` of the policy allows (24). A new record of a kind replaces the previous one; `sudo rm
/etc/architect-os/delivery-publication.json` withdraws it. The usual sequence: `deliver <name> --until ci` (trial
branch, gate, CI; prints the hash), the owner reads the diff and the CI, approves that hash, then `deliver <name>`
(the gate's verdict and the CI are reused, the approval is checked, the destinations move).

The reader (`infrastructure/file-approvals.ts`) accepts only a directory and a regular file owned by root (the uid is
injected, 0 in production), with no write bit for group or others, one link, at most 4096 bytes, opened once without
following a link, and a record of the exact form of its kind. Anything else is `untrusted`, never `absent`.

### Two approvals, two publication paths

The owner decided on 24 November that the automaton merges a pull request when the owner has put the label
`owner-approved` on it. That approval is GitHub's, and it governs the **pull request path**: a branch is pushed, a pull
request is opened (step 3 of the roadmap of retired prompts, `openPullRequest`), the hosted checks and review run, the
label lets the automaton merge. The record of this step governs the **direct path** of this repository, where the
launcher itself pushes an exact commit to `feat/gate-1a` and `main`. A change takes one path, so the owner answers
once. Opening a pull request pushes no destination branch and needs no publication record; the merge of that pull
request needs the label and nothing from this host.

### Threat model of step 1

| Actor | What it holds | What it can do to publication |
| --- | --- | --- |
| Owner | sudo password, GitHub identity | Approves a commit (root record) or a pull request (label) |
| Confined builder (srt) | its worktree and scratch, write; no network to GitHub | Writes candidate files only: a record, a variable or a policy it writes carries no authority (scenarios « a record supplied from the worktree, or named by the environment ») |
| Orchestrator session, unconfined, owner's uid | the owner's git credential helper and `gh` login, the owner's files | See the open defects |
| Hosted CI | its own token, read for checks | Reports checks; publishes nothing |

The command publishes under the owner's identity: git's credential helper and `gh`'s login, found in the owner's
configuration (`XDG_CONFIG_HOME`, keychain), passed by the closed environment of `deliver.json`. The root-owned record
is something no process of the owner's uid can write without sudo. What step 1 does **not** prevent is recorded as open
defects, each with what closes it:

1. **A free process under the publisher's uid pushes without the launcher** (`git push`, `gh api`, or the label set
   with the same token). Closes when the destinations require the protected hosted check (step 2), the publisher is a
   separate identity without ruleset bypass (owner decision 3) whose credential no session of the owner's uid can read
   (a root-owned helper or a separate service principal), and the orchestrator session holds no push credential.
2. **sudo without a password** (`NOPASSWD`, or a cached timestamp a session can reuse) lets a session write the
   record. The launcher cannot see it. Closes by the owner's sudoers (no `NOPASSWD` for this command, `timestamp_timeout=0`
   or per-tty tickets), or by an approval signed with a key that never leaves the owner's hardware, verified by the
   launcher (step 8, with the release manifest).
3. **A launcher installation writable by the session's uid**: whoever can edit the installed command can remove its
   checks. Closes when the launcher is installed root-owned from a reviewed release and verified against its manifest
   (step 8).
4. **The macOS forge client and helpers under Homebrew** (`/opt/homebrew/bin`, `/usr/local/bin`) are writable by the
   owner's uid. They are out of reach of the confined builder, not of an unconfined session. Closes with a root-owned
   install of `gh` or its digest in the release manifest (step 8).
5. **The local Gate still executes candidate code on the host** (R-2): its verdict is feedback, not publication-grade
   proof. Closes with step 5; meanwhile the hosted CI of the exact commit is required before phase 5.
6. **Fetch and push share credentials**: every git call of the delivery receives the host's identity variables, not
   only the publication adapter. Closes with separate adapters for reading and publishing (step 2).

### What step 1 changes in the design above

- « The owner approves the exact release digest » becomes, until the release manifest exists (step 8), the exact
  commit hash and repository, for a bounded time, in a root-owned record.
- The first build of step 1 checked the mode of the maintenance record but not its owner nor its directory: a file
  written by the session's uid was accepted. The reader now requires root's ownership of both.
- Publication approval was not in the design: it carries requirements P1 and P10 of the publication prompts retired
  from the neighbouring repository ai-architect-mcp-spec (review « p04 », 25 November 2026): only an action a human
  approved explicitly is executed, and the approval cannot be skipped.
- The `Forge` port of step 1 holds `run`, `rerunFailed` and `ruleSuite`, bound to `repository` of the installed
  policy, `gh` by absolute path in a closed environment. An `openPullRequest(branch, base, title, body)` is a fourth
  method of the same port with its own contract rows; nothing in step 1 binds the port to direct publication.
