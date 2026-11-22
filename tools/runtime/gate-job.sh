#!/bin/sh
# Start only the pinned Node, without process hooks or cache outputs inherited from this step.
set -eu
here=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd -P)
unset NODE_OPTIONS NODE_V8_COVERAGE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE
while IFS= read -r location <&3; do
  if [ -x "$location/node" ]; then
    IFS= read -r pin < "$here/../../.nvmrc"
    test "$("$location/node" --version)" = "v$pin" || exit 2
    exec "$location/node" "$here/gate-job.mjs" "$@" 3<&-
  fi
done 3< "$here/node-locations"
exit 2
