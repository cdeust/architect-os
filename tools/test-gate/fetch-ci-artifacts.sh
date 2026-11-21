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
attempt_of() {
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
      | if .status == "completed" and .conclusion == "success" then .run_attempt
        else error("producer failed: " + $name)
        end'
}
for shard in 1 2; do
  attempt=$(attempt_of "gate-linux-mutation-$shard")
  target="reports/mutation-shards/$shard"
  gh run download "$GITHUB_RUN_ID" --name "gate-mutation-linux-$attempt-$shard" --dir "$target"
  test "$(cat "$target/mutation/head")" = "$checkout_head"
done
if [ "$#" -eq 1 ] && [ "$1" = mutation ]; then exit 0; fi
test "$#" -eq 0
for shard in 1 2; do
  attempt=$(attempt_of "gate-linux-cucumber-$shard")
  gh run download "$GITHUB_RUN_ID" --name "gate-cucumber-linux-$attempt-$shard" --dir "reports/cucumber-shards/$shard"
  test "$(cat "reports/cucumber-shards/$shard/cucumber-head")" = "$checkout_head"
done
for shard in 1 2; do
  attempt=$(attempt_of "gate-linux-replay-$shard")
  gh run download "$GITHUB_RUN_ID" --name "gate-replay-linux-$attempt-$shard" --dir "reports/replay-shards/$shard"
  test "$(cat "reports/replay-shards/$shard/head")" = "$checkout_head"
done
