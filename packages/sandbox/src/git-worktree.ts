import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve from the launcher package, never from the checkout under inspection.
const guard = fileURLToPath(
  new URL(
    '../../../tools/test-gate/with-tree-lock.py',
    import.meta.resolve('@architect-os/sandbox/runtime-context'),
  ),
);

/** Run the guard in `mode`; an exit status outside `accepted`, or none (not started, stopped at its bound), throws. */
function inspect(
  root: string,
  mode: 'inspect-clean' | 'inspect-markers',
  accepted: readonly (number | null)[],
  input?: Buffer,
  timeout = 60_000,
) {
  const result = spawnSync('/usr/bin/python3', ['-I', guard, mode], {
    cwd: root,
    // The guard gives its git calls their own closed environment (`closed_git` of with-tree-lock.py): none of the host's.
    env: {},
    input,
    encoding: 'utf8',
    timeout,
    maxBuffer: 1 << 30,
  });
  if (!accepted.includes(result.status)) throw new Error('GATE_CHECKOUT_UNREADABLE');
  return result;
}

/** A directory of the tree that holds a `.git` marker. */
export interface NestedMarker {
  readonly path: string;
  /**
   * The tracked ignore file that ignored the directory of the marker and is no longer the one recorded. Its rules are
   * not applied, since a session can rewrite it: the marker is found where the repository itself would not look.
   */
  readonly changedIgnoreFile?: string;
}

/**
 * The path of the first Git link of a NUL-delimited list of `ls-files -s -z` or `ls-tree -r -z`: the record that starts
 * with mode 160000, whose path follows its first TAB. Read as bytes: a path is never decoded before it is found, and
 * `160000 ` inside a path (after a TAB, never after a NUL) is not a mode.
 */
export function firstGitlinkPath(list: Buffer): string | undefined {
  const mode = '160000 ';
  const first = list.indexOf(mode) === 0;
  const after = list.indexOf('\0' + mode);
  if (!first && after === -1) return undefined;
  const start = first ? 0 : after + 1;
  // Git ends every record of a -z list with a NUL, the last one included.
  return list.subarray(list.indexOf('\t', start) + 1, list.indexOf('\0', start)).toString('utf8');
}

/** Whether a NUL-delimited list of Git records holds a Git link. */
export function containsGitlink(list: Buffer): boolean {
  return firstGitlinkPath(list) !== undefined;
}

/** The first visible nested .git marker, without opening it or asking Git to classify it. */
export function visibleNestedMarker(
  root: string,
  committed: Buffer,
  timeout?: number,
): NestedMarker | undefined {
  // The guard prints the marker and, after a NUL, the changed ignore file that ignored its directory.
  // `split` gives at least one part, the empty text when the guard found nothing.
  const [path, changedIgnoreFile] = inspect(root, 'inspect-markers', [0], committed, timeout).stdout.split(
    '\0',
  ) as [string, ...string[]];
  if (path === '') return undefined;
  return changedIgnoreFile === undefined ? { path } : { path, changedIgnoreFile };
}

/** Verify the real index and checkout bytes with the same comparison as the native lease: 1 is a checkout not clean. */
export function checkoutIsClean(root: string): boolean {
  return inspect(root, 'inspect-clean', [0, 1]).status === 0;
}
