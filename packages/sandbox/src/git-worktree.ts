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
  input?: string,
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

/** The first visible nested .git marker, without opening it or asking Git to classify it. */
export function visibleNestedMarker(
  root: string,
  committed: string,
  timeout?: number,
): NestedMarker | undefined {
  // The guard prints the marker and, after a NUL, the changed ignore file that ignored its directory.
  const [path, changedIgnoreFile] = inspect(root, 'inspect-markers', [0], committed, timeout).stdout.split(
    '\0',
  );
  if (path === '' || path === undefined) return undefined;
  return changedIgnoreFile === undefined ? { path } : { path, changedIgnoreFile };
}

/** Verify the real index and checkout bytes with the same comparison as the native lease: 1 is a checkout not clean. */
export function checkoutIsClean(root: string): boolean {
  return inspect(root, 'inspect-clean', [0, 1]).status === 0;
}
