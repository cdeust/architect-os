# Prepare and approve one Step input bundle

After installing the pinned dependencies and running `npm run typecheck`, save the accepted JSON output of [Define](define.md) in a local file. Author a proposal and select a trusted local Step policy. Prepare a preview with:

```sh
npm run --silent plan -- prepare define.json proposal.json policy.json > preview.json
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

The host policy is a JSON object with `step`, using the existing `step.json` schema, and `scout_questions`, mapping each configured scout name to the contents of its question file. Use an empty object for questions when the policy has no scouts. Requirements, criteria and proposals supply text and links. The operator chooses the policy file that supplies models, effort, commands, limits and reviews.

The preview contains the exact UTF-8 output texts and their manifest. The manifest binds the Define run and Step name to SHA-256 fingerprints of the three source files and every output file. The approval fingerprint is SHA-256 of the manifest encoded by `JSON.stringify`. Keep the preview and the decision file with the planning evidence outside the repository's `steps/` archive.

After inspecting the preview and its inputs, an operator may record an explicit decision in a separate local file. The file has `version: 1`, `decision: "approve"` and `approval_sha256` copied from the reviewed preview. This is a local decision record. It has no cryptographic identity attestation. The producer's implementation decision is independent and this command leaves it untouched.

```sh
npm run --silent plan -- materialize define.json proposal.json policy.json decision.json /absolute/intake/delivery
```

The destination must be new, match the approved Step name and stay outside every Git checkout, including linked worktrees and the `steps/` archive. Materialization revalidates the sources and output fingerprints before making the folder. It writes `brief.md`, configured scout questions and `step.json` last. Missing, refused or stale decisions produce exit 2 and leave the destination untouched. Only a separate invocation of `npm run step -- <folder>` can start the sessions. Its own archive records the hashes of the inputs it actually read.

The integration scenario runs that Step reader with controlled in-memory sessions and checks the archive against the Plan manifest. Automated exploration before approval and a measured replay through Deliver remain future work.

## Recorded Define-to-Plan replay

The packaged prd-gen bundle from producer `c5fc803ae0cd5b154c60fdbc8843698be3042d0b` ran all eight Define boundary cases using its shipped stdio launcher. The architect-os commands read the real ready checkpoint `run_mwp11ad2_ieuog8` and prepared a pending preview with approval SHA-256 `4423b720ee20911c5039bba79b3bc7e2f4180b5c883a8d6f3201e54fc5efdf97`. Materialization without a decision returned exit 2. The historical checkpoint `run_mwp118s0_8w13io` produced no Define output. Both checkpoint files were byte-identical before and after reading them.
