#!/bin/sh
# npm run gate [-- --job macos]: the CI gate in one local command (docs/design/platform-v3-srt.md §7).
#   1. test-gate plan: diff against the first parent, perimeter, Stryker mutate list -> reports/gate-plan.json
#   2. tsc -b, then cucumber-js (job macos: profile macos, features/sandbox only); its exit code is never read
#   3. Stryker, linux job only and only when the plan mutates something (always the canary of rule 7)
#   4. test-gate replay: each verdict of Stryker in the perimeter and the canary replayed with cucumber-js directly;
#      its exit code is never read either, check reads its record
#   5. test-gate check: the verdict, from the reports only; its exit code is the exit code of this script
# --mutation-only produces mutation and replay reports for the hosted gate to verify.
# Previous reports are removed first: a stale report must never be read as the result of this run.
set -u
job=linux
mutation_only=false
if [ "$#" -eq 1 ] && [ "$1" = --mutation-only ]; then
  mutation_only=true
  shift
fi
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != "--job" ]; then
    echo "usage: npm run gate [-- --job <name> | --mutation-only]" >&2
    exit 1
  fi
  job=$2
fi
gate="node --import tsx tools/test-gate/src/main.ts"
rm -rf reports/cucumber.ndjson reports/mutation reports/replay reports/gate-plan.json reports/gate-report.md reports/gate-base.json
$gate plan --job "$job" || exit 1
# The platform launches its modules and workers from their built entry points (topology/modules.mcp.json): build first.
npx tsc -b || exit 1
if [ "$mutation_only" = false ]; then
  if [ "$job" = linux ]; then
    cucumber-js
  else
    cucumber-js --profile "$job"
  fi
fi
if [ "$job" = linux ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync("reports/gate-plan.json","utf8")).mutate.length > 0 ? 0 : 1)'; then
  started=$(date +%s)
  stryker run
  echo "stryker: $(($(date +%s) - started)) s"
  started=$(date +%s)
  $gate replay
  echo "replay: $(($(date +%s) - started)) s"
fi
if [ "$mutation_only" = true ]; then
  test -s reports/mutation/mutation.json && test -s reports/mutation/replay.json
  exit $?
fi
exec $gate check --job "$job"
