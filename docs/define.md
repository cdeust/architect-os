# Read a pending Define handoff

After `./aos -- npm ci --ignore-scripts` and `./aos -- npm run typecheck`, run the reader with the run ID and the root of a trusted local prd-gen plugin.

```sh
./aos -- npm run --silent define -- <run_id> <prd-gen-plugin-root>
```

The root is the directory that contains the plugin's `.mcp.json`, `bin/ensure-deps.mjs` and bundled server. The operator selects that directory. The adapter starts the fixed launcher and passes only its fixed paths and the skill configuration. The SDK inherits its standard environment allowlist so that prd-gen reads the checkpoints under the same user home as the host. The launcher and its locked dependencies must be trusted by that user.

The reader requests `get_pipeline_state` in `define_handoff_v1` format. Exit 0 writes one JSON line with a `handoff` property. The consumer requires version 1, the requested run ID, unique requirement and criterion IDs, and complete acceptance coverage. Exit 2 reports invalid invocation, rejected or invalid planning data, or a mismatched run. Exit 3 reports a failure opening or querying the MCP transport. Refusals leave stdout empty.

The reader leaves the gate decision and saved checkpoint in prd-gen. Its output contains requirements and acceptance criteria. It carries no launcher policy, executable arguments, plan approval, or authority to create an execution step. The [Plan command](plan.md) can validate this output and materialize one Step bundle after its independent operator decision. The full replay through Deliver is still pending.

## Recorded pilot

The pinned prd-gen producer was `c5fc803ae0cd5b154c60fdbc8843698be3042d0b`. Its shipped bundle SHA-256 was `f26a85805c3199d0d23e30c697db2c0ced87cab55eef9b798ad267992bbdf365`. The producer's eight `define-boundary-stdio` cases ran through the manifest launcher. The replay retained the checkpoints from the historical delivery case and from the passing variant with corrected testing traceability. Both runs used recorded clarifications and canned drafts and judge responses.

| Run                   | Outcome at the gate | Architect-os read                                                                         | Read time |
| --------------------- | ------------------- | ----------------------------------------------------------------------------------------- | --------- |
| `run_mwox8k21_2tbbpg` | `passed`            | Exit 0, exact producer payload with `AC-001→FR-001`, `AC-002→FR-002`, and `AC-003→FR-003` | 832 ms    |
| `run_mwox8itw_qfir2b` | `needs_attention`   | Exit 2, `DEFINE_REFUSED`, empty stdout                                                    | 683 ms    |

Both runs reached the pending decision after 28 producer actions. Each CLI read started a new plugin process. Byte comparison before and after each read showed that its checkpoint remained unchanged. The accepted output SHA-256 was `e872d98ddfd70f6624ee2eab6ade6c6cff14c8d3a51634946d671cf7f0a74dcb`. These timings include npm startup and the local stdio exchange. The replay made no external model calls. A model-backed generation and delivery cost has yet to be measured.
