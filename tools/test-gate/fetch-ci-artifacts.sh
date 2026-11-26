#!/bin/sh
# A failed-jobs rerun retains the successful producer jobs and their artifacts from earlier attempts.
set -eu
entry=$(CDPATH= cd -P -- "$(dirname -- "$0")/../.." && pwd -P) || exit 2
node "$entry/scripts/require-run.mjs" || exit $?
checkout_head=$(git rev-parse --verify HEAD)
repository="repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
head=$(gh api "$repository" --jq .head_sha)
case "$head" in
  ''|*[!0-9a-f]*) exit 1 ;;
esac
test "${#head}" -eq 40
# Attempt-scoped pages distinguish a real execution from a successful job copied by a partial rerun.
# Fetch each set of pages and its boundary once, before the parallel lot downloads.
jobs=$(
  n=1
  while [ "$n" -le "$GITHUB_RUN_ATTEMPT" ]; do
    start=null
    if [ "$GITHUB_RUN_ATTEMPT" -gt 1 ]; then
      meta=$(gh api "$repository/attempts/$n") || exit 1
      start=$(printf '%s\n' "$meta" | jq -er --argjson n "$n" --argjson run "$GITHUB_RUN_ID" --arg head "$head" '
        select(.run_attempt == $n and .id == $run and .head_sha == $head) | .run_started_at | fromdateiso8601') || exit 1
    fi
    pages=$(gh api --paginate --slurp "$repository/attempts/$n/jobs?per_page=100") || exit 1
    printf '%s\n' "$pages" | jq -ce --argjson n "$n" --argjson start "$start" '
      {attempt:$n, start:$start, jobs:[.[].jobs[] |
        if has("run_attempt") and .run_attempt != $n then error("producer attempt differs")
        else .run_attempt = $n end]}' || exit 1
    n=$((n + 1))
  done
)
jobs=$(printf '%s\n' "$jobs" | jq -cse '
  if length == 1 or ([.[].start] as $s | $s == ($s | sort | unique)) then .
  else error("ambiguous attempt boundaries") end')
artifacts=$(gh api --paginate --slurp "$repository/artifacts?per_page=100")
artifact_names=$(printf '%s\n' "$artifacts" | jq -c '[.[].artifacts[].name]')
job_origin() {
  printf '%s\n' "$jobs" | jq -er --arg name "$1" --arg prefix "$2" --arg suffix "$3" --arg head "$head" \
    --argjson artifacts "$artifact_names" --argjson run "$GITHUB_RUN_ID" '
      def success: .status == "completed" and .conclusion == "success";
      def signature: [.runner_id, .started_at, .completed_at,
        [.steps[] | {number, name, status, conclusion, started_at, completed_at}]];
      . as $attempts | [.[].jobs[] | select(.name == $name)] as $rows
      | if ($rows | length) == 0 or
          ($rows | any(.run_id != $run or .head_sha != $head or (.id | type != "number" or . <= 0))) or
          ($rows | group_by(.run_attempt) | any(length != 1)) or
          any($attempts[]; .attempt as $n |
            ($rows | all(.run_attempt != $n)) and
            ($artifacts | index($prefix + ($n | tostring) + $suffix)) != null) or
          ($rows | map(.id) | unique | length) != ($rows | length)
        then error("producer absent or ambiguous: " + $name) else . end
      | reduce $rows[] as $job (null;
          ($attempts[$job.run_attempt - 1].start) as $start
          | ($attempts[$job.run_attempt].start) as $next
          | if $start == null then $job
            elif ($job.started_at | fromdateiso8601) >= $start then
              if ($job | success) and (
                ($job.completed_at | fromdateiso8601) < ($job.started_at | fromdateiso8601) or
                ($next != null and ($job.completed_at | fromdateiso8601) >= $next))
              then error("producer outside attempt: " + $name) else $job end
            elif . != null and success and ($job | success) and
              ($job.completed_at | fromdateiso8601) < $start and
              ($job.started_at | fromdateiso8601) <= ($job.completed_at | fromdateiso8601) and
              ($job.runner_id | type == "number" and . > 0) and
              ($job.steps | type == "array" and length > 0 and
                all(.[]; (.name | type == "string" and length > 0) and (.number | type == "number"))) and
              signature == ($job | signature) and
              ($artifacts | index($prefix + ($job.run_attempt | tostring) + $suffix)) == null
            then . else error("unproven reused producer: " + $name) end)
      | if success then "\(.run_attempt) \(.id)" else error("producer failed: " + $name) end'
}
artifact_origin() {
  printf '%s\n' "$artifacts" | jq -er --arg name "$1" '
    [.[].artifacts[] | select(.name == $name)] as $rows
    | if ($rows | length) == 1 and $rows[0].expired == false and
         ($rows[0].id | type == "number" and . > 0)
      then $rows[0].id
      else error("artifact absent or ambiguous: " + $name)
      end'
}
# Extract only the files this producer owns. Publish a complete, head-checked lot.
download_artifact() (
  id=$1
  target=$2
  logical=reports/${target#"$ARCHITECT_OS_RUN_DIR/reports/"}
  test "$(node "$entry/tools/test-gate/report-files.mjs" path "$logical")" = "$target"
  head_file=$3
  shift 3
  stage=$(mktemp -d "${TMPDIR:?}/artifact.XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  mkdir "$stage/files"
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$id/zip" > "$stage/archive"
  unzip -Z -1 "$stage/archive" > "$stage/members"
  for member in "$head_file" "$@"; do
    test "$(grep -Fxc "$member" "$stage/members")" = 1
    mkdir -p "$stage/files/$(dirname "$member")"
    unzip -p "$stage/archive" "$member" > "$stage/files/$member"
  done
  test "$(cat "$stage/files/$head_file")" = "$checkout_head"
  if [ "$head_file" = mutation/head ]; then
    printf '%s\t%s\t%s\t%s\t%s\n' "$GITHUB_RUN_ID" "$head" "$attempt" "$job" "$id" > "$stage/files/producer"
  fi
  mkdir -p "$(dirname "$target")"
  test ! -e "$target" && test ! -L "$target" || exit 1
  mv "$stage/files" "$target"
)
download_mutation() {
  lane=$1
  binding=$(job_origin "gate-linux-lane-$lane / mutation" gate-mutation-linux- "-$lane")
  attempt=${binding%% *}
  job=${binding#* }
  name="gate-mutation-linux-$attempt-$lane"
  artifact=$(artifact_origin "$name")
  target="${ARCHITECT_OS_RUN_DIR:?}/reports/mutation-shards/$lane"
  download_artifact "$artifact" "$target" mutation/head mutation/native.json mutation-inventory.json
}
# A lane is named by the plan of the checkout that asks for it: a number without a leading zero, three digits at most
# (a matrix of GitHub Actions holds 256 jobs). Whether the plan holds it is decided by hosted-gate, never here.
valid_lane() {
  case "$1" in
    [1-9]|[1-9][0-9]|[1-9][0-9][0-9]) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "$#" -eq 2 ] && [ "$1" = mutation ]; then
  valid_lane "$2"
  download_mutation "$2"
  exit 0
fi
test "$#" -eq 0
# The judge downloads the producers of the plan it derived from its own checkout (`hosted-gate lanes`, the step before
# this one), never a list a producer or the plan job gave: the lanes 1 to n, and a run that holds a lane job or a lane
# artifact of any other name is refused whole.
plan_file=$(node "$entry/tools/test-gate/report-files.mjs" path reports/mutation-lanes.json)
lanes=$(jq -er 'if type == "array" and length >= 1 and length <= 256 and . == [range(1; length + 1)]
  then length else error("plan absent or invalid") end' "$plan_file")
printf '%s\n' "$jobs" | jq -e --argjson lanes "$lanes" '
  [range(1; $lanes + 1) | "gate-linux-lane-\(.) / mutation", "gate-linux-lane-\(.) / replay"] as $planned
  | [.[].jobs[].name] as $names
  | if ($planned | all(. as $name | $names | index($name) != null)) | not then error("planned producer absent")
    elif ($names | any(startswith("gate-linux-lane-") and (. as $name | $planned | index($name) == null)))
    then error("producer outside the plan") else true end' > /dev/null
printf '%s\n' "$artifact_names" | jq -e --argjson lanes "$lanes" '
  [.[] | select(test("^gate-(mutation|replay)-linux-"))
    | select((capture("^gate-(mutation|replay)-linux-[1-9][0-9]*-(?<lane>[1-9][0-9]*)$") // {lane: "0"})
        | (.lane | tonumber) as $lane | $lane < 1 or $lane > $lanes)]
  | if length == 0 then true else error("artifact outside the plan") end' > /dev/null
for part in 1 2; do
  binding=$(job_origin "gate-linux-cucumber-$part" gate-cucumber-linux- "-$part")
  attempt=${binding%% *}
  name="gate-cucumber-linux-$attempt-$part"
  artifact=$(artifact_origin "$name")
  target="${ARCHITECT_OS_RUN_DIR:?}/reports/cucumber-shards/$part"
  download_artifact "$artifact" "$target" cucumber-head cucumber.ndjson
done
download_replay() {
  part=$1
  download_mutation "$part"
  binding=$(job_origin "gate-linux-lane-$part / replay" gate-replay-linux- "-$part")
  attempt=${binding%% *}
  name="gate-replay-linux-$attempt-$part"
  artifact=$(artifact_origin "$name")
  target="${ARCHITECT_OS_RUN_DIR:?}/reports/replay-shards/$part"
  download_artifact "$artifact" "$target" head replay.json timings.json
}
pids=
failed=0
wait_downloads() {
  for pid in $pids; do
    wait "$pid" || failed=1
  done
  pids=
}
for part in $(seq 1 "$lanes"); do
  download_replay "$part" &
  pids="$pids $!"
  if [ "$((part % 5))" -eq 0 ]; then
    wait_downloads
  fi
done
wait_downloads
test "$failed" -eq 0
