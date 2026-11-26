import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// .github/workflows/gate-push.yml is produced here whole, from .github/workflows/gate.yml (`npm run
// workflow:gate-push` writes it). features/descriptive/gate-concurrency.feature requires the whole file to equal what
// this produces. No part of that file is written by hand: the two entries of the gate run the same jobs because one is
// written from the other, and they differ by what is written below and nothing else.

export const SOURCE = '.github/workflows/gate.yml';
export const PRODUCED = '.github/workflows/gate-push.yml';

/** Everything of the push entry before its jobs: its name, its trigger, its permissions, and no concurrency key. */
const HEAD = `# GENERATED from .github/workflows/gate.yml by \`npm run workflow:gate-push\` (features/support/gate-push-entry.ts).
# Do not edit: change gate.yml, then run the command. features/descriptive/gate-concurrency.feature requires this
# file to equal what the command writes.
# The CI gate (docs/design/platform-v3-srt.md §7): plan, Gherkin suite, Stryker on the changed lines, verdict.
# No secret, no cache. The token is the automatic one, restricted to contents: read and actions: read.
# The push entry. The pull-request entry is gate.yml; the jobs below are its jobs, unchanged, so that both report the
# checks gate-linux and gate-macos as jobs of their own run: a job of a called workflow would report as
# \`<caller job> / <job>\`.
# No concurrency key, here or on a job: a run on main publishes the base of the count that the next run reads, and a
# run on a trial branch is the one the delivery waits for. A run in no group cannot be cancelled through a group.
name: gate-push

on:
  push:
    branches:
      - main
      # The delivery (CONTRIBUTING.md, the maintainer's line): a commit is pushed to a trial branch first, where
      # this gate gives it the two checks the rulesets of feat/gate-1a and of main require; it then reaches both
      # branches as it is. feat/gate-1a is not listed: it would run the same commit a second time.
      - sentinel/gate-1a-*

permissions:
  contents: read
  actions: read

`;

/**
 * The push entry, from the text of the pull-request entry: the head above, then the source from its line `jobs:` to
 * its end, byte for byte. A source that does not hold exactly one such line is refused: nothing says where its jobs
 * begin.
 */
export function pushEntry(source: string): string {
  const starts = [...source.matchAll(/^jobs:\n/gm)];
  if (starts.length !== 1) throw new Error(`${SOURCE} must hold exactly one line "jobs:"`);
  return HEAD + source.slice(starts[0]?.index);
}

/** Writes the push entry of the tree at `root` when it differs; tells whether it wrote. */
export function writePushEntry(root: string): boolean {
  const file = join(root, PRODUCED);
  const next = pushEntry(readFileSync(join(root, SOURCE), 'utf8'));
  let current: string | undefined;
  try {
    current = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (next === current) return false;
  writeFileSync(file, next);
  return true;
}
