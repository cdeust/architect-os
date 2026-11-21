#!/bin/sh
# A failed-jobs rerun retains the successful producer jobs and their artifacts from earlier attempts.
set -eu
checkout_head=$(git rev-parse --verify HEAD)
repository="repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
head=$(gh api "$repository" --jq .head_sha)
case "$head" in
  ''|*[!0-9a-f]*) exit 1 ;;
esac
test "${#head}" -eq 40
jobs=$(gh api --paginate --slurp "$repository/jobs?filter=all&per_page=100")
# Some jobs responses omit run_attempt. In that case, establish provenance with the attempt-specific endpoint.
if ! printf '%s\n' "$jobs" | jq -e 'all(.[].jobs[]; has("run_attempt"))' >/dev/null; then
  jobs=$(
    n=1
    while [ "$n" -le "$GITHUB_RUN_ATTEMPT" ]; do
      pages=$(gh api --paginate --slurp "$repository/attempts/$n/jobs?per_page=100") || exit 1
      printf '%s\n' "$pages" | jq -ce --argjson n "$n" '
        .[] | .jobs |= map(
          if has("run_attempt") and .run_attempt != $n then error("producer attempt differs")
          else .run_attempt = $n end
        )' || exit 1
      n=$((n + 1))
    done
  )
  jobs=$(printf '%s\n' "$jobs" | jq -cs '.')
fi
job_origin() {
  printf '%s\n' "$jobs" | jq -er --arg name "$1" --arg head "$head" \
    --argjson run "$GITHUB_RUN_ID" --argjson attempt "$GITHUB_RUN_ATTEMPT" '
      [.[].jobs[] | select(.name == $name)] as $rows
      | if ($rows | length) > 0 and
          ($rows | all(
            .run_id == $run and .head_sha == $head and
            (.run_attempt | type == "number") and
            .run_attempt >= 1 and .run_attempt <= $attempt and
            (.id | type == "number") and .id > 0
          )) and
          ($rows | group_by(.run_attempt) | all(length == 1)) and
          ($rows | map(.id) | unique | length) == ($rows | length)
        then $rows | max_by(.run_attempt)
        else error("producer absent or ambiguous: " + $name)
        end
      | if .status == "completed" and .conclusion == "success" then "\(.run_attempt) \(.id)"
        else error("producer failed: " + $name)
        end'
}
artifacts=$(gh api --paginate --slurp "$repository/artifacts?per_page=100")
artifact_origin() {
  printf '%s\n' "$artifacts" | jq -er --arg name "$1" '
    [.[].artifacts[] | select(.name == $name)] as $rows
    | if ($rows | length) == 1 and $rows[0].expired == false and
         ($rows[0].id | type == "number" and . > 0)
      then $rows[0].id
      else error("artifact absent or ambiguous: " + $name)
      end'
}
download_artifact() {
  mkdir -p "$2"
  archive=$(mktemp)
  if ! gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$1/zip" > "$archive" ||
     ! unzip -oq "$archive" -d "$2"; then
    rm -f "$archive"
    return 1
  fi
  rm -f "$archive"
}
download_mutation() {
  lane=$1
  binding=$(job_origin "gate-linux-lane-$lane / mutation")
  attempt=${binding%% *}
  job=${binding#* }
  name="gate-mutation-linux-$attempt-$lane"
  artifact=$(artifact_origin "$name")
  target="reports/mutation-shards/$lane"
  download_artifact "$artifact" "$target"
  test "$(cat "$target/mutation/head")" = "$checkout_head"
  printf '%s\t%s\t%s\t%s\t%s\n' "$GITHUB_RUN_ID" "$head" "$attempt" "$job" "$artifact" > "$target/producer"
}
valid_lane() {
  case "$1" in
    [1-9]|1[0-9]|20) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "$#" -eq 2 ] && [ "$1" = mutation ]; then
  valid_lane "$2"
  download_mutation "$2"
  exit 0
fi
test "$#" -eq 0
for part in 1 2; do
  binding=$(job_origin "gate-linux-cucumber-$part")
  attempt=${binding%% *}
  name="gate-cucumber-linux-$attempt-$part"
  artifact=$(artifact_origin "$name")
  target="reports/cucumber-shards/$part"
  download_artifact "$artifact" "$target"
  test "$(cat "$target/cucumber-head")" = "$checkout_head"
done
download_replay() {
  part=$1
  download_mutation "$part"
  binding=$(job_origin "gate-linux-lane-$part / replay")
  attempt=${binding%% *}
  name="gate-replay-linux-$attempt-$part"
  artifact=$(artifact_origin "$name")
  target="reports/replay-shards/$part"
  download_artifact "$artifact" "$target"
  test "$(cat "$target/head")" = "$checkout_head"
}
pids=
failed=0
for part in $(seq 1 20); do
  download_replay "$part" &
  pids="$pids $!"
  if [ "$((part % 5))" -eq 0 ]; then
    for pid in $pids; do
      wait "$pid" || failed=1
    done
    pids=
  fi
done
test "$failed" -eq 0
