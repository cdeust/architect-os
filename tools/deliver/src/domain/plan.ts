// What to publish (docs/design/orchestration-fable-5-2.md §14, phase 1): the work branch, the head of the pull request.
// The destination is neither read nor compared: only a pull request changes it, and the gate alone judges against it.

export type Plan =
  { ok: true; push: boolean } | { ok: false; reason: "la branche distante n'est pas un ancêtre du commit" };

/**
 * `work` is where the remote has the work branch (undefined when it has none yet), `descends` says whether a commit is
 * the hash or one of its ancestors. The work branch is pushed without force, so the commit descends from it; a work
 * branch already at the hash is not pushed again, and its pull request is still opened, or found.
 */
export function planPublication(
  hash: string,
  work: string | undefined,
  descends: (ancestor: string) => boolean,
): Plan {
  if (work !== undefined && work !== hash && !descends(work)) {
    return { ok: false, reason: "la branche distante n'est pas un ancêtre du commit" };
  }
  return { ok: true, push: work !== hash };
}
