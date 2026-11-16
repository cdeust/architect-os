#!/bin/sh
# Trial, outside production: packs what the real adapter needs to run on a Linux host that has no checkout of this
# repository (the VM of the measures): the compiled sandbox package, its profiles, zod, and the two files of this trial.
# Run it at the root of the repository, after `npx tsc -b`:
#   sh bench/docker-bridge/adapter/bundle.sh /tmp/aos-bundle.tgz
set -eu
OUT="$1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/packages/sandbox" "$WORK/node_modules"
cp -R packages/sandbox/dist packages/sandbox/profiles packages/sandbox/package.json "$WORK/packages/sandbox/"
cp -R node_modules/zod "$WORK/node_modules/"
cp bench/docker-bridge/adapter/drive.mjs bench/docker-bridge/adapter/module-probe.mjs "$WORK/"
COPYFILE_DISABLE=1 tar -czf "$OUT" -C "$WORK" .
echo "bundle: $OUT, built from $(git rev-parse --short HEAD)$(git diff --quiet HEAD -- packages/sandbox/src || echo ' with local changes')"
