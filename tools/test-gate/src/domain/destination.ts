// The first parent the gate judges the tree against (docs/design/trusted-gate.md; CLAUDE.md, « Never compare a branch
// to `main` »: the gate judges the PR diff as GitHub presents it). In CI the head is GitHub's merge commit, whose first
// parent is the destination. On a workstation the head is the branch itself: its own first parent is only its last
// commit, or the branch side of a merge of the destination into it. The gate judges, instead, the merge GitHub would
// build, first parent the destination as the local repository knows it, second parent the head; it can run the
// scenarios and the mutation only on that tree when it is the tree of the head, which is when the destination is in
// the history of the head. Otherwise it refuses by name, and says what to do.

/** What git says of the head and of the destination named by the configuration of the gate. */
export interface DestinationFacts {
  readonly head: string;
  /** `HEAD^1`, null for a root commit. */
  readonly parent: string | null;
  /** The commit the destination reference names; undefined when the reference does not exist. */
  readonly destination: string | undefined;
  /**
   * Asked only when the destination is neither the head nor its first parent: the commits of the destination not in
   * the head (`behind`, 0 when the destination is in the history of the head) and of the head not in the destination.
   */
  readonly counts: () => { readonly behind: number; readonly ahead: number };
  /** The tree of the merge of the destination and the head, or `conflict`; asked only when it is needed. */
  readonly merged: () => string | 'conflict';
  readonly headTree: string;
}

export type DestinationRefusal =
  | 'GATE_DESTINATION_MISSING'
  | 'GATE_DESTINATION_CONFLICT'
  | 'GATE_DESTINATION_NOT_INTEGRATED'
  | 'GATE_DESTINATION_MISMATCH';

/** What the verdict records: the first parent judged, the destination commit taken, and how many commits it judged. */
export interface JudgedParent {
  readonly firstParent: string | null;
  /** The destination commit, null when the head is a root commit and no destination exists. */
  readonly destination: string | null;
  /** Commits between the first parent judged and the head: 1 when only the last commit is judged. */
  readonly commits: number;
}

export function judgedParent(
  facts: DestinationFacts,
): JudgedParent | { readonly refusal: DestinationRefusal } {
  const { head, parent, destination } = facts;
  if (destination === undefined) {
    // A root commit has nothing to be compared with: every tracked file is judged, as without a destination.
    return parent === null
      ? { firstParent: null, destination: null, commits: 1 }
      : { refusal: 'GATE_DESTINATION_MISSING' };
  }
  // The head is the destination (a push to it), or the destination is its first parent (GitHub's merge commit, or a
  // single commit on the destination): the first parent of the head, as before.
  if (destination === head || destination === parent) return { firstParent: parent, destination, commits: 1 };
  const { behind, ahead } = facts.counts();
  if (behind === 0) {
    // The merge is the head's own tree by construction; checked by object identifiers all the same.
    if (facts.merged() !== facts.headTree) return { refusal: 'GATE_DESTINATION_MISMATCH' };
    return { firstParent: destination, destination, commits: ahead };
  }
  return {
    refusal: facts.merged() === 'conflict' ? 'GATE_DESTINATION_CONFLICT' : 'GATE_DESTINATION_NOT_INTEGRATED',
  };
}

/** The line of a refusal, with what to do. */
export function destinationMessage(refusal: DestinationRefusal, reference: string): string {
  switch (refusal) {
    case 'GATE_DESTINATION_MISSING':
      return `${refusal} : la destination ${reference} est absente du dépôt ; la récupérer avant la porte`;
    case 'GATE_DESTINATION_CONFLICT':
      return `${refusal} : la tête ne se fusionne pas sans conflit dans ${reference} ; intégrer la destination d'abord`;
    case 'GATE_DESTINATION_NOT_INTEGRATED':
      return `${refusal} : ${reference} a des commits que la tête n'a pas ; intégrer la destination d'abord`;
    case 'GATE_DESTINATION_MISMATCH':
      return `${refusal} : la fusion de ${reference} et de la tête n'a pas l'arbre de la tête`;
  }
}
