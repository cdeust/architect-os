#!/bin/sh
# npm run gate [-- --job macos]: the CI gate in one local command (docs/design/platform-v3-srt.md §7).
#   1. test-gate plan: diff against the first parent, perimeter, Stryker mutate list -> reports/gate-plan.json
#   2. tsc -b, then cucumber-js (job macos: profile macos, features/sandbox only); its exit code is never read
#   3. Stryker, linux job only and only when the plan mutates something (always the canary of rule 7)
#   4. test-gate replay: each verdict of Stryker in the perimeter and the canary replayed with cucumber-js directly;
#      its exit code is never read either, check reads its record
#   5. test-gate check: the verdict, from the reports only; its exit code is the exit code of this script
# --mutation-only produces both reports; --mutation-report-only leaves replay to the hosted runners.
# Previous reports are removed first: a stale report must never be read as the result of this run.
set -u
entry=$(CDPATH= cd -P -- "$(dirname -- "$0")/../.." && pwd -P) || exit 2
node "$entry/scripts/require-run.mjs" || exit $?
# Keep the kernel lease across plan, candidate tests, mutation, replay and receipt publication.
# The shell program is literal; the user's arguments remain separate argv entries.
exec /usr/bin/python3 -I "$entry/tools/test-gate/with-tree-lock.py" full /bin/sh -c "$(cat <<'AOS_LOCKED_GATE'
set -u
candidate() { /usr/bin/python3 -I tools/test-gate/with-tree-lock.py candidate "$@"; }
reports="$ARCHITECT_OS_RUN_DIR/reports"
job=linux
mutation_only=false
report_only=false
if [ "$#" -eq 1 ] && [ "$1" = --mutation-report-only ]; then
  mutation_only=true
  report_only=true
  shift
fi
if [ "$#" -eq 1 ] && [ "$1" = --mutation-only ]; then
  mutation_only=true
  shift
fi
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != "--job" ]; then
    echo "usage: npm run gate [-- --job <name> | --mutation-only | --mutation-report-only]" >&2
    exit 1
  fi
  job=$2
fi
gate="node --import tsx tools/test-gate/src/main.ts"
node tools/test-gate/report-files.mjs clean || exit $?
$gate plan --job "$job" || exit 1
# The platform launches its modules and workers from their built entry points (topology/modules.mcp.json): build first.
candidate npx tsc -b || exit 1
if [ "$mutation_only" = false ]; then
  if [ "$job" = linux ]; then
    candidate cucumber-js
  else
    candidate cucumber-js --profile "$job"
  fi
fi
if [ "$job" = linux ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.env.ARCHITECT_OS_RUN_DIR + "/reports/gate-plan.json","utf8")).mutate.length > 0 ? 0 : 1)'; then
  started=$(date +%s)
  if [ "$report_only" = true ]; then
    if [ -n "${AOS_MUTATION_SHARD:-}" ]; then
      $gate inventory --shard "$AOS_MUTATION_SHARD" || exit 1
    else
      $gate inventory --job linux || exit 1
    fi
    AOS_NATIVE_MUTATION_LOTS=1 candidate stryker run
  else
    $gate inventory --job linux || exit 1
    AOS_NATIVE_MUTATION_LOTS=1 candidate stryker run
  fi
  stryker_status=$?
  echo "stryker: $(($(date +%s) - started)) s"
  if [ "$report_only" = true ]; then
    [ "$stryker_status" -eq 0 ] || exit "$stryker_status"
    if [ -n "${AOS_MUTATION_SHARD:-}" ]; then
      exec $gate inventory-project --shard "$AOS_MUTATION_SHARD"
    fi
    exec $gate inventory-project --job linux
  fi
  [ "$stryker_status" -eq 0 ] || exit "$stryker_status"
  $gate inventory-project --job linux || exit 1
  started=$(date +%s)
  $gate replay
  echo "replay: $(($(date +%s) - started)) s"
fi
if [ "$mutation_only" = true ]; then
  test -s "$reports/mutation/mutation.json" && test -s "$reports/mutation/replay.json"
  exit $?
fi
exec $gate check --job "$job"
AOS_LOCKED_GATE
)" gate "$@"
