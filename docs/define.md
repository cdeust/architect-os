# Read a pending Define handoff

After `./aos -- npm ci --ignore-scripts` and `./aos -- npm run typecheck`, run the reader with the run ID, the root of a local prd-gen plugin and the digest the operator pinned for the producer installed there.

```sh
./aos -- npm run --silent define -- <run_id> <prd-gen-plugin-root> <producer-sha256>
```

The root is the directory that contains the plugin's server, `mcp-server/`, and its skill files, `packages/skill/`.

**What the operator pins.** Every file the server can load or read relative to its own root: the bundle `mcp-server/index.js`, its `package.json` (which decides how the bundle loads), the dependencies installed beside it under `mcp-server/node_modules` (the native `better-sqlite3` module included), and `packages/skill/` (the skill configuration and `SKILL.md`, which the server reads from its plugin root). The producer's bundle cannot be self-contained: `better-sqlite3` is a native module, loaded at run time. npm writes links for commands into `mcp-server/node_modules/.bin`; Node never resolves a module through them, so that one directory is neither pinned nor copied. Any other link, and any file that is not a regular file or a directory, is refused (`SPEC_PRODUCER_LINK`, `SPEC_PRODUCER_FILE`), as is a name holding a newline or a backslash (`SPEC_PRODUCER_PATH`), a tree without `mcp-server/index.js` or `packages/skill/skill-config.json` (`SPEC_PRODUCER_INCOMPLETE`), and a tree of more than 20 000 files or 256 MiB (`SPEC_PRODUCER_TOO_LARGE`). A file left by an install in progress, or a `.DS_Store`, changes the digest: pin after provisioning, and pin again after any change.

**The digest.** The SHA-256 of what `shasum -a 256` prints for those files sorted by the bytes of their paths. The host prints it with `./aos -- npm run --silent producer:digest -- <prd-gen-plugin-root>`; an operator can recompute it without the host, from the plugin root:

```sh
find mcp-server packages/skill -type f ! -path 'mcp-server/node_modules/.bin/*' -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256
```

The digest depends on the platform, since the native module and the install differ: it proves that the producer did not change since the operator pinned it, not that it matches the producer's lockfile. Provision once, by launching the plugin as Claude Code does (`bin/ensure-deps.mjs` runs `npm ci`), then pin.

**What runs.** Before each read, the host reads the pinned files once, each opened without following a link and judged by its descriptor, and compares the digest of those bytes with the pinned one; on a difference it refuses with `SPEC_PRODUCER_MISMATCH` (exit 2) and starts nothing. It then writes the same bytes, read-only, into a fresh private directory of the host (mode 0700, under the run's temporary directory) and starts that copy, never the plugin root: a change to the root after the check reaches nothing that runs. The copy runs under Node's permission model: it may read its copy and the producer's data directory `~/.prd-gen` of the host's home, write only there, and load the native module of its copy; it gets no child process, worker, network or inspector. A read never starts `bin/ensure-deps.mjs`, installs nothing and reaches no registry. The copy is removed when the read ends. The planning host (`withPlanningSpec`) uses the same pin, copy and permissions, with its private journal and temporary directories in place of `~/.prd-gen`.

The reader requests `get_pipeline_state` in `define_handoff_v1` format. Exit 0 writes one JSON line with a `handoff` property. The consumer requires version 1, the requested run ID, unique requirement and criterion IDs, and complete acceptance coverage. Exit 2 reports invalid invocation, a producer refused by the pin (`SPEC_PRODUCER_*`), rejected or invalid planning data, or a mismatched run. Exit 3 reports a failure opening or querying the MCP transport. Refusals leave stdout empty.

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
