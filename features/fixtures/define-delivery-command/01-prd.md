# PRD: Specify npm run deliver -- <name> for a commit already prepared in the delivery worktree.

Run ID: run_mwoa0qk4_8j9yhm
Context: feature
Request size: tiny

## Overview

The delivery command verifies and publishes an already prepared commit. Its checks bind the exact commit to the results of the gate and CI.

## Requirements

- FR-001: Publish only the commit accepted by the local gate and CI.
- FR-002: Stop before publication with `--until ci`.
- FR-003: Recheck both destination refs on resume and require a passing ruleset result for a ref that was already advanced.

## Acceptance Criteria

- AC-001: Given a failing check, the command stops and publishes no commit (FR-001).
- AC-002: Given `--until ci`, the command ends after CI before any publication (FR-002).
- AC-003: Given a partially completed delivery with a failed ruleset result, resuming stops before the next update (FR-003).