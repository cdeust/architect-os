# Prepare and approve one Step input bundle

After installing the pinned dependencies and running `./aos -- npm run typecheck`, select a trusted installed producer bundle and a saved run whose specification has passed the readiness check at the producer's pending implementation gate. For a compatible producer, save the accepted JSON output of [Define](define.md) and the verified proposal for the same run and Step. Keep the exact file bytes, including the trailing newline.

```sh
./aos -- npm run --silent define -- "$RUN_ID" "$PLUGIN_ROOT" "$BUNDLE_SHA256" > define.json
./aos -- npm run --silent plan:proposal -- "$RUN_ID" "$PLUGIN_ROOT" "$BUNDLE_SHA256" delivery define.json > proposal.json
```

The reader requests `get_pipeline_state(format: "verified_plan_v1", plan_step: "delivery")`. It checks the run, Step name, and the producer's SHA-256 values for the saved Define, proposal and binding. A refused projection exits with empty stdout. These digests check consistency with the operator-selected producer. The operator can also supply a proposal using the schema below. Prepare the preview with:

```sh
./aos -- npm run --silent plan -- prepare define.json proposal.json policy.json > preview.json
```

For model-assisted drafting, [choose Claude, GPT or Gemini](plan-models.md).

The proposal has one Step name, an objective, an observable verification and the acceptance IDs for the work. The first slice plans one coherent Step that covers every criterion in the handoff once. A criterion can refer to several requirements.

```json
{
  "step": "delivery",
  "objective": "Deliver the commit accepted by the gate.",
  "verification": "Observe a CI-only stop and check the commit against the evidence.",
  "acceptance_ids": ["AC-001", "AC-002", "AC-003"]
}
```

The host policy is a JSON object with `step` (build, scouts, checks, reviews and parallelism) and `scout_questions`, mapping each configured scout name to the contents of its question file. Use an empty object for questions when the policy has no scouts. The operator chooses the policy file that supplies models, effort, commands, limits and reviews. Both proposal and policy reject a `tickets` field with `PLAN_INPUT_INVALID`. When the Define handoff contains tickets, Plan copies its validated array in order to the brief and `step.json`. Each ticket retains its own estimate and prerequisites. Plan still prepares one Step for all criteria.

The preview contains the exact UTF-8 output texts and their manifest. The manifest binds the Define run and Step name to SHA-256 fingerprints of the three source files and every output file. The approval fingerprint is SHA-256 of the manifest encoded by `JSON.stringify`. Keep the preview and the decision file with the planning evidence outside the repository's `steps/` archive.

After inspecting the preview and its inputs, an operator may record an explicit decision in a separate local file. The file has `version: 1`, `decision: "approve"` and `approval_sha256` copied from the reviewed preview. This is a local decision record. It has no cryptographic identity attestation. The producer's implementation decision is independent and this command leaves it untouched.

```sh
./aos -- npm run --silent plan -- materialize define.json proposal.json policy.json decision.json /absolute/intake/delivery
```

The destination must be new, match the approved Step name and stay outside every Git checkout, including linked worktrees and the `steps/` archive. Materialization revalidates the sources and output fingerprints before making the folder. It writes `brief.md`, configured scout questions and `step.json` last. `step.json` is the policy's Step with `acceptance` set to the approved `acceptance_ids`, in order; a policy that names its own is refused (`PLAN_INPUT_INVALID`): every review of the Step gives one status per criterion, and the host refuses a verdict that does not ([R2](design/exigences-spec.md)). Missing, refused or stale decisions produce exit 2 and leave the destination untouched. To start the sessions, run Step from the root of the target linked worktree. Set `LAUNCHER` to the absolute path of the trusted launcher checkout and pass the folder that Plan just materialized:

```sh
"$LAUNCHER/aos" -- npm --prefix "$LAUNCHER" run step -- /absolute/intake/delivery
```

Step requires the separately issued host receipt `ARCHITECT_OS_STEP_EVIDENCE`, bound to the target tree, input bytes, launcher, reviews and prompt specimens. `npm run admit` issues it ([below](#issue-the-step-admission-receipt)). Step reads the approved folder once and validates `step.json` before launching sessions. The host archives the input hashes and the optional tickets in `steps/<name>/record.json` in the target worktree. Ticket points and dependencies are recorded, not yet used: no code chooses a model, effort or command from them. Session models and commands come from the host policy. Under `ARCHITECT_OS_RUNTIME_ROOT`, reports and verdicts go to `state/steps/<run-id>/delivery/` and raw streams to `run/<run-id>/tmp/steps/delivery/`.

The offline integration scenario reads both projections across MCP stdio from a fixture, approves and materializes the exact preview, then runs the Step host with controlled sessions and a test receipt. It checks the archived tickets and policy along with the input fingerprints. See the [producer report](../SPEC-PLUG-PRODUCER.md) for the rejected projections from the named checkout. Automated exploration before approval and a measured replay through Deliver remain future work.

## Preview an independently reviewed Spec Plan

Pass `reviewed-plan.json` in place of `proposal.json` to `plan prepare`, using the exact paired `define.json` written by the Spec planning host. Plan verifies both reviews and the bound input bytes. With a matching local approval, `plan materialize` writes the folder as for a proposal. The folder starts nothing: Step refuses it until `npm run admit` has issued its receipt, which requires the specimen proof.

## Issue the Step admission receipt

Only a reviewed Plan can be admitted. Run the issuer from the trusted launcher checkout, the one whose `aos` will start Step, with the same Plan sources and decision, the specimen proof, the materialized folder and the root of the clean linked worktree:

```sh
./aos -- npm run --silent admit -- define.json reviewed-plan.json policy.json decision.json specimens.json "$INTAKE/delivery" "$WORKTREE"
```

`npm run admit` is a separate entry: `npm run step` never calls it, and a dependency rule lets only the issuing adapter of Plan import the issuer. Before it writes anything, the issuer:

- re-derives the manifest from the three sources as `plan prepare` does, and requires the reviewed Plan (`ADMIT_INPUT_INVALID`, `ADMIT_REVIEWED_PLAN_REQUIRED`). Both reviews must use a different provider and model from their drafters.
- requires the decision for that exact approval digest (`ADMIT_NOT_APPROVED`).
- requires a folder named for the Step and outside every Git checkout (`ADMIT_FOLDER_INVALID`). Step's own pre-session reader must accept it: no blank brief or scout question, no `STEP_CORRECTNESS_PROVIDER` (`ADMIT_STEP_REFUSED`). Its `brief.md`, `step.json` and scout questions must carry the approved digests (`ADMIT_INPUTS_MISMATCH`).
- requires the canonical root of a linked worktree whose tree is clean, and takes its fingerprint (`ADMIT_WORKTREE_INVALID`, `ADMIT_TREE_DIRTY`).
- requires a launcher checkout outside the target worktree (`ADMIT_LAUNCHER_INSIDE_WORKTREE`) and reads the launcher files that this Step will load (`ADMIT_LAUNCHER_UNREADABLE`).
- requires one specimen proof per role that the Step launches, and nothing more. Each proof has its provider and model, the digest of the launcher prompt and replays that match their expected verdict, findings and criteria. A review proof also has a criteria case (`ADMIT_SPECIMENS_REQUIRED`).
- applies the Step check to the sealed receipt (`ADMIT_EVIDENCE_MISMATCH`).

It then creates `<step>-<approved_sha256>.json`, mode 0600, in `~/.config/architect-os/step-admission`. That directory must be mode 0700, owned by the effective user, canonical and outside the worktree (`ADMIT_AUTHORITY_UNSAFE`). The issuer writes under a temporary name in the same directory, created exclusively without following a link. It then links that file to the final name, so the final name appears only when complete and never replaces a receipt (`ADMIT_RECEIPT_EXISTS`). A failed write or link never leaves the final name (`ADMIT_RECEIPT_WRITE_FAILED`). If the temporary file cannot be removed, it remains, and Step never reads it. On success it prints `{"status":"issued","step",...,"path","approved_sha256"}`; set `ARCHITECT_OS_STEP_EVIDENCE` to that `path`. Exit codes: 0 issued, 2 refused with the code on stderr, 3 unexpected error.

The receipt is unsigned. The separation rests on two facts. Every srt profile denies the sessions `~/.config/architect-os`. Only the issuer module can seal a receipt: `step-admission.ts` only reads and checks it, and the dependency rule allows no other importer.

The specimen file is an array in the receipt's `specimens` form. The issuer checks its coverage and replay results. It cannot establish that a host replay produced them. That provenance belongs to the prompt specimens brick, which is still pending. Step folders in `main` have no relaunch pass. A relaunch bound to a refused record therefore has no receipt case yet.

## Recorded Define-to-Plan replay

The packaged prd-gen bundle from producer `c5fc803ae0cd5b154c60fdbc8843698be3042d0b` ran all eight Define boundary cases using its shipped stdio launcher. The architect-os commands read the real ready checkpoint `run_mwp11ad2_ieuog8` and prepared a pending preview with approval SHA-256 `4423b720ee20911c5039bba79b3bc7e2f4180b5c883a8d6f3201e54fc5efdf97`. Materialization without a decision returned exit 2. The historical checkpoint `run_mwp118s0_8w13io` produced no Define output. Both checkpoint files were byte-identical before and after reading them.

## Measure the checkpoint-to-Plan path

Use a fresh receipt filename for every attempt. These wrappers run the same command entry points and forward their stdout, stderr and exit status. In the example the operator supplies a trusted policy, the checkpoint ID and the plugin root. Run each next command only after the preceding command succeeds.

```sh
set -e
./aos -- npm run --silent baseline:planning -- 01.jsonl define "$RUN_ID" "$PLUGIN_ROOT" "$BUNDLE_SHA256" > define.json
./aos -- npm run --silent baseline:planning -- 02.jsonl proposal "$RUN_ID" "$PLUGIN_ROOT" "$BUNDLE_SHA256" delivery define.json > proposal.json
./aos -- npm run --silent baseline:planning -- 03.jsonl prepare define.json proposal.json policy.json > preview.json
# After an independent decision on the preview:
./aos -- npm run --silent baseline:planning -- 04.jsonl materialize define.json proposal.json policy.json decision.json "$INTAKE/delivery"
```

To measure a model-drafted proposal, run `draft` in place of `proposal` after `define`. This path selects one provider and model. It uses the native draft receipt, which includes the reported provider usage when available.

```sh
./aos -- npm run --silent baseline:planning -- 02-draft.jsonl draft "$PROVIDER" "$MODEL" delivery define.json "$TIMEOUT_MS" > proposal.json
```

Use the same `prepare` and independent approval commands. Match `run_id`, `define_sha256` and `proposal_sha256` in the draft receipt to the prepared manifest. `proposal` remains the route for the verified Spec projection. See [model drafting](plan-models.md) for the native account setup and receipt fields.

For `define`, `proposal`, `prepare` and `materialize`, the journal starts with an attempt ID and UTC time.
These measurements include process startup. Completed commands record exit status, signal, the SHA-256 of stdout, run ID when available and approval fingerprint when emitted.
A `measurement_failed` event identifies an observer or launch error. A lone start identifies an interrupted observation.
A second read of a checkpoint contributes a new local latency observation. These four stages record `producer_usage` as null because the checkpoint projections supply no generation usage.

The native `draft` chronometer starts in the child after its receipt is opened. Its terminal event records outcome, CLI exit code or signal, and usage when available, and the `proposal` hash on success.
A failure before the receipt opens creates no new journal. Count distinct attempt IDs when combining copies.

For generation, retain the producer's `bench:real` plan, per-call `rows.jsonl`, per-arm `record.json` and `summary.md`. In the native record, use one arm's totals once. The journal and per-purpose breakdown describe those same calls. Preserve requested vs reported models, cache reads/writes, unknown fields, unmetered counts and terminal outcome. Record the producer revision and arm artifact digest. The benchmark drives an in-memory reducer and omits the MCP checkpoint identity and host-session cost. Keep its costs at benchmark-arm scope until a producer supplies an explicit binding to a checkpoint.

On 2026-11-21 the packaged producer at `d5e95362b20b9828b0b2d8b7b14f1cbb3e7c0a3d` reached its implementation gate using the upstream ready delivery fixture and canned host responses. The recorded local commands took 506 ms for Define, 502 ms for the verified proposal and 217 ms for a pending preview. Materialization without a decision returned 2 in 194 ms. The [four attempt journals](../baseline/results/planning-2026-11-21.jsonl) include output fingerprints and the preview approval hash.

A separate paid producer smoke at `7a17fba5` requested Haiku with low effort under a USD 1 cap. The first probe hit the account quota after 2,622 ms of total wall time. Its CLI usage explicitly reported zero input, output, cache-read and cache-creation tokens and USD 0, with one errored invocation and zero unmetered calls. The reported model field was empty. The run stopped before drafting. Cost per successful Define or Plan remains unknown. SHA-256 of the native arm record is `0ce02149c5713d2990e2098a4105013991141397b5a854d17392b618b2514674`; the call journal digest is `aee5264fe0079628220e60b5587587a7365b12cb6d283730897a411db624c197`.
