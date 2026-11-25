# Read a pending Define handoff

After `./aos -- npm ci --ignore-scripts` and `./aos -- npm run typecheck`, run the reader with the run ID, the root of a trusted local prd-gen plugin and the SHA-256 of the bundle the operator installed there.

```sh
./aos -- npm run --silent define -- <run_id> <prd-gen-plugin-root> <bundle-sha256>
```

The root is the directory that contains the plugin's bundled server, `mcp-server/index.js`. The operator selects that directory and gives the lowercase SHA-256 of that file, for example from `shasum -a 256 mcp-server/index.js` after installing a reviewed producer revision. Before each read, the adapter resolves the physical path of the bundle, refuses a symbolic link or a different digest with `SPEC_BUNDLE_MISMATCH` (exit 2) without starting anything, then starts the bundle itself with Node, as the planning host does (`withPlanningSpec`). It never starts the plugin's `bin/ensure-deps.mjs`, so a read installs nothing and reaches no registry: the operator provisions the bundle's runtime dependencies once, by launching the plugin as Claude Code does. Those dependencies under `mcp-server/node_modules` are not covered by the digest, on this path as on the planning path. The adapter passes only the bundle path and the skill configuration. The SDK inherits its standard environment allowlist so that prd-gen reads the checkpoints under the same user home as the host.

The reader requests `get_pipeline_state` in `define_handoff_v1` format. Exit 0 writes one JSON line with a `handoff` property. The consumer requires version 1, the requested run ID, unique requirement and criterion IDs, and complete acceptance coverage. Exit 2 reports invalid invocation, a bundle that does not match the pinned digest, rejected or invalid planning data, or a mismatched run. Exit 3 reports a failure opening or querying the MCP transport. Refusals leave stdout empty.

The reader leaves the gate decision and saved checkpoint in prd-gen. The handoff holds requirements, acceptance criteria and an optional `tickets` array. Each ticket holds `id` (`TICKET-001` to `TICKET-999`), `story_points` (a positive safe Fibonacci integer), `depends_on` (distinct ticket IDs, possibly empty), and `acceptance_ids` (one or more distinct criterion IDs). All references must resolve within the handoff and the ticket graph must be acyclic. Unknown fields and invalid ticket data return `DEFINE_REPLY_INVALID`. Legacy v1 handoffs omit the field and remain readable.

The data feeds the [Plan command](plan.md). The operator supplies launcher policy and approves any materialization separately. The named Spec checkout for this work returned MCP argument errors for both versioned projections. It needs the producer changes in [SPEC-PLUG-PRODUCER.md](../SPEC-PLUG-PRODUCER.md) before a real checkpoint from that checkout can enter this flow.

## Drive Spec planning

The admitted host library `runSpecPlanning` can drive a compatible pinned bundle over stdio with an injected model dispatcher and a private journal. Its terminal artifacts are `define.json` and `reviewed-plan.json`. Give those files to Plan for an independently reviewed preview. The replay uses controlled dispatchers. The plain checkpoint readers above can be run independently of this host library.

## Recorded pilot

The pinned prd-gen producer was `c5fc803ae0cd5b154c60fdbc8843698be3042d0b`. Its shipped bundle SHA-256 was `f26a85805c3199d0d23e30c697db2c0ced87cab55eef9b798ad267992bbdf365`. The producer's eight `define-boundary-stdio` cases ran through the manifest launcher. The replay retained the checkpoints from the historical delivery case and from the passing variant with corrected testing traceability. Both runs used recorded clarifications and canned drafts and judge responses.

| Run                   | Outcome at the gate | Architect-os read                                                                         | Read time |
| --------------------- | ------------------- | ----------------------------------------------------------------------------------------- | --------- |
| `run_mwox8k21_2tbbpg` | `passed`            | Exit 0, exact producer payload with `AC-001→FR-001`, `AC-002→FR-002`, and `AC-003→FR-003` | 832 ms    |
| `run_mwox8itw_qfir2b` | `needs_attention`   | Exit 2, `DEFINE_REFUSED`, empty stdout                                                    | 683 ms    |

Both runs reached the pending decision after 28 producer actions. Each CLI read started a new plugin process. Byte comparison before and after each read showed that its checkpoint remained unchanged. The accepted output SHA-256 was `e872d98ddfd70f6624ee2eab6ade6c6cff14c8d3a51634946d671cf7f0a74dcb`. These timings include npm startup and the local stdio exchange. The replay made no external model calls. A model-backed generation and delivery cost has yet to be measured.
