# Orchestration delivery queue

## Native outcome of an orchestration round

- [x] Reproduce a false passing Step on a failed native build and review.
- [x] Require the process exit, timeout status and terminal event to agree before accepting a session result. Keep old records readable.
- [x] Verify failed build, scout and review handling on the Step path and run the local suite (4,582 scenarios, 21,697 steps).
- [x] Render the gateway call flow and both runtime boundaries at README width. Keep the isolation drawing in section 3.
- [ ] Obtain a documented release decision for the subscription stream before admitting a production Astra build.

On macOS, an admitted Step with native subprocesses passed with exit 0. When the builder process exited 1 after emitting a success event, Step refused the run before checks or review. When the reviewer emitted `accept` and exited 1, Step recorded an invalid review and refused the run. These checks exercised the host launcher and did not call a model.

## Reuse of the subscription grant across SBX runs

- [x] Compare the production SRT credential lifetime, the SBX operator and the documented SIWC refresh flow.
- [x] Keep the verified grant in the host broker between runs and serialize token rotation. Give each VM a separate, revocable capability.
- [x] Run the pinned client in two fresh VMs with one real consent, verify native execution before and after renewal, then check the provider and native outcomes of a separately budgeted text request.
- [x] Record the account, runtime and inference results separately.
- [ ] Qualify a positive native response before admitting Astra to the production Builder.

On 23 November, one live sign-in covered two native commands and one budgeted Astra text request across three fresh Docker VMs. The host renewed the subscription once. Both commands exited 0. The provider completed the text request using 39 input and 31 output tokens. The host withheld the text on an opaque moderation report and Codex exited 1. All three workspaces were empty after shutdown. [Trial 9](../bench/sbx/README.md#astra-subscription-trials-on-22-november-2026)

## One place to write — runtime admission

- [x] Inventory the existing admission, independent delivery identity, direct executables, npm lifecycle scripts and hosted jobs at a3b92e1d.
- [x] Require a physical admitted context before a repository payload starts and preserve the parent run for nested commands.
- [x] Migrate the root and benchmark manifests, directly callable host entrypoints and the six installing workflow files atomically.
- [x] Exercise missing, forged and substituted contexts, partial-setup rollback, caller locations, Git and forge identity, hosted floors and the native sandbox.
- [x] Bind local and hosted receipts to the single integration commit and update the roadmap after validation.

## Isolated session writes (1b)

- [x] Give the pinned engine and its child the same private temporary directory. Prevent each profile from writing host-home caches, global temporary files, shared caches and other runs, or reading another run or host state.
- [x] Exercise the five production profiles with the native engine on macOS and Linux, including the default writable locations of the pinned SRT, an existing sibling file, and a successful private write.
- [x] Put host usage and delivery logs in the admitted durable state while retaining forge identity and the original journals.
- [x] Keep approved input separate from retained Step reports and disposable streams, with exclusive creation and an unchanged evidence archive.
- [x] Run repository checks, mutation and independent replay on the published commit. Record the actual jobs before closing this milestone.

## Active milestone — Gate and delivery (2)

- [x] Verify the previous integration on main. [Gate after #120](https://github.com/cdeust/architect-os/actions/runs/44963755418) passed all 36 jobs on f675623b.
- [x] Take a kernel lock per physical checkout. Recover the recorded source before loading a candidate or altering prior reports. Refuse conflicting operator edits.
- [x] Move reports, mutation copies and replay work below the admitted run. Keep the identity of every producer and replay and resume only the allocation bound to its hosted job.
- [x] Publish the successful commit-bound Gate receipt and prove that Deliver uses it with a closed process environment.
- [ ] Exercise kill/restart, concurrent and distinct checkouts, aliases, alternate runtime roots, receipt substitutions, both native operating systems, the 16 hosted producers and independent replay.
- [ ] Align README, roadmap and diagram with the verified paths, then record the integrated result.

## Remaining work in order

The ordered [orchestration roadmap](../README.md#what-comes-next) is the source of truth for all subsequent bricks. Within this brick the remaining checkpoints are below.

- [x] Restrict profile writes and neighbour reads; put host and child session paths and the session npm cache under the admitted root.
- [ ] Serialize each worktree’s Gate and restore interrupted mutations; move reports under its run and bind delivery to the commit's receipt.
- [ ] Stop owned processes, remove only the recorded runs, mask secrets on both output streams and publish the step atomically.
- [ ] Measure root and home peaks for Step, Gate and concurrent runs; replace provisional floors and decide hard per-run capacity.

## Subsequent roadmap checkpoints

- [ ] The gate under the sandbox
- [ ] One copy of the dependencies
- [ ] Disposable worktrees
- [ ] The base of errors and the reflection step
- [ ] Invented inputs at verification
- [ ] Mutation as a phase of the step
- [ ] A refusal goes back by itself
- [ ] What the build declares, given to the reviews
- [ ] Scenarios written apart, then frozen
- [ ] One commit per pass
- [ ] Cache share and cost per accepted step
- [ ] The duration of the suite
- [ ] The broker bounds what a task token can spend
- [ ] The delivery gate
- [ ] Prompts replayed on specimens
- [ ] What the checks take off a review (pilot HR2)
- [ ] Review by dimension (O.3d)
- [ ] The reading of the watch, and the inventory (O.3e)
- [ ] Explorations and remaining human gates
- [ ] The verification from end to end
- [ ] A judge from another provider
- [ ] A builder from another provider
- [ ] The loop through the gateway (O.2)
- [ ] Governance and distribution
- [ ] The measures of an engagement
- [ ] Bricks 1c, 2 to 8, D
- [ ] The evidence desk, S.3 and S.4

## Review

The native macOS sandbox runs inside the admitted temporary directory. The real workstation rejects the production policy with `RUNTIME_HOME_SPACE_LOW`; the successful local admission checks use a disposable launcher copy with test floors. With the native Stryker runner, the context guard detected all 182 mutations (181 killed, one timeout). The two admission issuer files recorded 167 killed and 14 runtime errors across 181 mutants. The hosted Gate independently replays detections. The workflow tests exercised both baseline downloads, the mutation-lane download and the aggregate download against a local fixture. The [main Gate](https://github.com/cdeust/architect-os/actions/runs/44956541338) passed all 36 jobs at 4cfc1ae0.

The five 1b profiles passed the real macOS session-location probes on an admitted workstation. The native runner Stryker scope recorded 48 killed and two runtime errors; the Step scope killed all 83 mutants. The host journal and admission adapter suites rejected all 165 and 77 instrumenter substitutions respectively. The [hosted Linux and macOS functional checks](https://github.com/cdeust/architect-os/actions/runs/44960509640) passed 4,126 scenarios and 99 scenarios respectively on fa05f48f. The hosted mutation campaign killed both former 0400 settings-file mutants and exposed two assertion gaps. Those checks are now covered; the current [PR](https://github.com/cdeust/architect-os/pull/120) tracks the final full Gate and independent replay.

The [milestone 2 integration](https://github.com/cdeust/architect-os/pull/124) exercises a real full Linux Gate on a disposable checkout. The same admission plans, publishes the checked commit, preserves it on a new plan and revokes it on a red check. Local interruption and recovery tests include aliases, a different runtime root, a damaged recovery record, worktree edits and a trusted external issuer. The hosted 16-lane verdict remains open.

## SBX host-mediated native turn

- [x] Add a single text challenge over the verified offline VM's process pipes, with bounded messages, model binding and independent host/guest receipt comparison.
- [x] Run the pinned Codex native fixture, the existing write witness and the Google refusal through the admitted workstation launcher.
- [x] Observe a model-bound provider terminal and validate its usage independently when native stream admission refuses an earlier event.
- [x] Verify that the host can attribute one completed, tool-free inference and its token usage to Astra on the subscription route.
- [ ] Reconcile the cost with provider billing evidence.
- [ ] Qualify a production Builder and independent review through the admitted Step.

The admitted workstation reproduced the write witness, one read-only host fixture turn with matching synthetic usage (8 input and 4 output tokens), and the Google ACP refusal (`-32000`, process exit 1). These fixtures made zero upstream calls.

Five subscription responses completed at the provider with measured usage. Trial 8 returned a native refusal through the VM after the host withheld the text on turn moderation. Usage for trials 1–3 and monetary cost for all eight remain unknown. [Qualification evidence](../bench/sbx/README.md#astra-subscription-trials-on-22-november-2026)

## Astra subscription request

- [x] Exercise the SIWC request body, one-shot dispatch and same-account model catalogue refresh with an offline transport.
- [x] Confirm the positive and negative paths in native SBX, including the inline notice, reasoning header and a mandatory safety block.
- [x] Bind the private worker receipt to the host's challenge, observed counts, served controls and workspace cleanup.
- [x] Record the seven subscription trials and the last refusal at the stream boundary.
- [ ] Resolve opaque turn-moderation reports against an authoritative OpenAI contract.
- [x] Draw the separate SRT process and Docker SBX VM, the host broker and their process pipes. Verify the diagram at the README width.
- [x] Propagate a withheld answer to the native client and verify its exit and the empty workspace after shutdown in the offline fixture and on subscription trial 8.
- [ ] Confirm a successful native subscription turn with the exact model, matching receipt and verified shutdown.

## Builder de Step sous Docker SBX (24 novembre 2026)

- [x] B.1 Introduire le port Builder et vérifier ensemble Claude et le double en mémoire.
- [x] B.2 Relayer les octets natifs vers une route SIWC fermée et vérifier les budgets et les terminaux sur un faux amont.
- [x] B.3 Monter le worktree du Step, protéger ses entrées réservées et vérifier une écriture native hors ligne.
- [ ] B.4 Intégrer la session de compte, les contrôles de provenance et le reçu du constructeur.
- [ ] Essai par le Step de production après le signal du mainteneur pour le consentement.
