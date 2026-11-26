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

// A rule is one of three forms. `dir/`: that root-relative subtree, and a change that replaces one of its ancestors.
// `**/name/`: a directory of that name at any depth, and anything below it (Node resolves `node_modules` from every
// directory up to the root). Anything else: a basename pattern, at any depth.
export function changesJudge(paths: readonly string[], rules: readonly string[]): boolean {
  return paths.some((name) => {
    const path = name.toLowerCase();
    return rules.some((rule) => {
      if (rule.startsWith('**/') && rule.endsWith('/')) return path.split('/').includes(rule.slice(3, -1));
      if (rule.endsWith('/')) return path.startsWith(rule) || rule.startsWith(path + '/');
      return posix.matchesGlob(posix.basename(path), rule);
    });
  });
}
