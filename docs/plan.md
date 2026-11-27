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

Step requires the separately issued host receipt `ARCHITECT_OS_STEP_EVIDENCE`, bound to the target tree, input bytes, launcher, reviews and prompt specimens. The production receipt issuer is pending. Step reads the approved folder once and validates `step.json` before launching sessions. The target worktree must be clean and on a work branch other than `main`; at its end Step commits the pass and `steps/<name>/` on that branch. The host archives the input hashes and the optional tickets in `steps/<name>/record.json` in the target worktree. Ticket points and dependencies are recorded, not yet used: no code chooses a model, effort or command from them. Session models and commands come from the host policy. Under `ARCHITECT_OS_RUNTIME_ROOT`, reports and verdicts go to `state/steps/<run-id>/delivery/` and raw streams to `run/<run-id>/tmp/steps/delivery/`.

The offline integration scenario reads both projections across MCP stdio from a fixture, approves and materializes the exact preview, then runs the Step host with controlled sessions and a test receipt. It checks the archived tickets and policy along with the input fingerprints. See the [producer report](../SPEC-PLUG-PRODUCER.md) for the rejected projections from the named checkout. Automated exploration before approval and a measured replay through Deliver remain future work.

## Preview an independently reviewed Spec Plan

Pass `reviewed-plan.json` in place of `proposal.json` to `plan prepare`, using the exact paired `define.json` written by the Spec planning host. Plan verifies both reviews and the bound input bytes. `plan materialize` returns `PLAN_SPECIMEN_EVIDENCE_REQUIRED` for this receipt even with a matching local approval. Production specimen evidence and the receipt issuer are pending.

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
