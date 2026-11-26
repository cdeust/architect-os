// What to publish (docs/design/orchestration-fable-5-2.md §14, phase 1): the work branch, which is the head of the pull
// request, and never the destination, which only a pull request changes.

export type Plan =
  | { ok: true; parent: string; push: boolean }
  | { ok: false; reason: 'rien à livrer' | "la branche distante n'est pas un ancêtre du commit" };

/**
 * `destination` and `work` are where the remote has those branches (`work` undefined when it has none yet), `descends`
 * says whether a commit is the hash or one of its ancestors. A destination already at the hash leaves nothing to deliver.
 * The commit descends from the destination, so that the change the pull request shows is the one the append-only files
 * were checked on, and from the work branch, which is pushed without force; a work branch already at the hash is not
 * pushed again, and its pull request is still opened, or found.
 */
export function planPublication(
  hash: string,
  destination: string,
  work: string | undefined,
  descends: (ancestor: string) => boolean,
): Plan {
  if (destination === hash) return { ok: false, reason: 'rien à livrer' };
  if (!descends(destination))
    return { ok: false, reason: "la branche distante n'est pas un ancêtre du commit" };
  if (work !== undefined && work !== hash && !descends(work)) {
    return { ok: false, reason: "la branche distante n'est pas un ancêtre du commit" };
  }
  return { ok: true, parent: destination, push: work !== hash };
}
