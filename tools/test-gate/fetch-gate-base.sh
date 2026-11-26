#!/bin/sh
# Restore the executed pickle count from a successful main push of the exact first parent (§7.2).
set -eu
case "$1" in linux|macos) ;; *) exit 2 ;; esac
artifact=gate-base-$1
entry=$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)
base=$(node "$entry/tools/test-gate/report-files.mjs" path reports/base)
if [ -e "$base/gate-base.json" ] || [ -L "$base/gate-base.json" ]; then
  echo "base: destination already contains a count" >&2
  exit 1
fi
parents=$(git show -s --format=%P HEAD)
parent=${parents%% *}
if [ -z "$parent" ]; then echo "base: no first parent"; exit 0; fi

# The first main push of the split still has a parent judged by the combined workflow.
workflow=.github/workflows/gate-push.yml
recorded=$(git ls-tree --name-only "$parent" -- "$workflow")
if [ -z "$recorded" ]; then workflow=.github/workflows/gate.yml; fi
repository="repos/$GITHUB_REPOSITORY/actions"
# A repository-wide query also works before the new filename is registered on the default branch.
pages=$(gh api --paginate --slurp "$repository/runs?branch=main&event=push&status=success&head_sha=$parent&per_page=100")
run=$(printf '%s\n' "$pages" | jq -er --arg workflow "$workflow" --arg sha "$parent" --arg repo "$GITHUB_REPOSITORY" '
  def id: if type == "number" and (tostring | test("^[1-9][0-9]*$")) then . else error("invalid run id") end;
  if type != "array" or length == 0 or any(.[]; (.workflow_runs | type) != "array")
  then error("invalid run list") end |
  [.[].workflow_runs[]] as $runs |
  if any(.[]; .total_count != ($runs | length)) or
     ([$runs[].id | id] | unique | length) != ($runs | length) or
     any($runs[]; (.path | type) != "string" or .path == "")
  then error("incomplete or invalid run list") end |
  [$runs[] |
    if .head_sha != $sha or .head_branch != "main" or .event != "push" or .status != "completed" or
       .conclusion != "success" or .head_repository.full_name != $repo
    then error("run does not match the base query") end |
    select(.path == $workflow) | .id] | max // "none"')
if [ "$run" = none ]; then echo "base: no green main push of $workflow for $parent"; exit 0; fi

metadata=$(gh api "$repository/runs/$run/artifacts?name=$artifact&per_page=1")
available=$(printf '%s\n' "$metadata" | jq -er --arg name "$artifact" '
  if .total_count == 0 and .artifacts == [] then "none"
  elif .total_count == 1 and (.artifacts | type == "array" and length == 1) and .artifacts[0].name == $name then
    .artifacts[0] | if .expired == true then "none" elif .expired == false then "present"
    else error("invalid artifact expiry") end
  else error("invalid or ambiguous base artifact list") end')
if [ "$available" = none ]; then echo "base: $artifact absent or expired on run $run"; exit 0; fi

# A transport or archive error stops the job. Publish the complete file only after a successful download.
mkdir -p "$base"
stage=$(mktemp -d "$base/.download.XXXXXX")
trap 'rm -rf "$stage"' EXIT
gh run download "$run" -n "$artifact" -D "$stage" -R "$GITHUB_REPOSITORY"
test -f "$stage/gate-base.json" && test ! -L "$stage/gate-base.json" || exit 1
mv "$stage/gate-base.json" "$base/gate-base.json"
