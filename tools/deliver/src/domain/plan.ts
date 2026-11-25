// What to publish (docs/design/orchestration-fable-5-2.md §14, phase 1).

import { posix } from 'node:path';

export interface RemoteBranch {
  branch: string;
  /** The hash of the branch on the remote. */
  head: string;
}

export type Plan =
  | { ok: true; parent: string; publish: string[] }
  | { ok: false; reason: 'rien à livrer' | 'les branches distantes diffèrent' };

/** A branch already at the hash is up to date; the others must all be at one same commit, the parent. */
export function planPublication(hash: string, remotes: readonly RemoteBranch[]): Plan {
  const behind = remotes.filter((remote) => remote.head !== hash);
  const first = behind[0];
  if (first === undefined) return { ok: false, reason: 'rien à livrer' };
  if (behind.some((remote) => remote.head !== first.head)) {
    return { ok: false, reason: 'les branches distantes diffèrent' };
  }
  return { ok: true, parent: first.head, publish: behind.map((remote) => remote.branch) };
}

/** A directory entry or any of its descendants, or a tool/configuration basename wherever it is installed. */
export function changesJudge(paths: readonly string[], rules: readonly string[]): boolean {
  return paths.some((name) => {
    const path = name.toLowerCase();
    return rules.some((rule) =>
      rule.endsWith('/')
        ? path.startsWith(rule) || rule.startsWith(path + '/')
        : posix.matchesGlob(posix.basename(path), rule),
    );
  });
}
