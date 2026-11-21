#!/bin/sh
# Only the marked root crosses steps. Every invocation of aos allocates its own run.
set -eu
umask 077
parent=$(CDPATH= cd -P "${RUNNER_TEMP:?}" && pwd -P)
root=$parent/a
mkdir "$root"
printf '%s\n' 'architect-os-runtime-root/v2' 'environment=hosted-runner' > "$root/.architect-os-runtime-root"
printf 'ARCHITECT_OS_RUNTIME_ROOT=%s\n' "$root" >> "${GITHUB_ENV:?}"
