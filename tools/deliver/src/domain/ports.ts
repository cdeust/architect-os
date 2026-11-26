// The ports of the delivery command (docs/design/orchestration-fable-5-2.md §14, « Étape 1, la commande de livraison »).
// Each method is one fact asked or one act done; none takes free text from a caller.

/** Where a run stopped. */
export type Phase = 'préalables' | "branche d'essai" | 'porte' | 'CI' | 'publication';

/** What `Progress` is told: the phases a run can stop at, and the last one, which a run never stops at. */
export type Stage = Phase | 'rangement';

/** Why a run stopped: a closed list of fixed strings, never a text read from a port. */
export type Reason =
  | "dépôt imbriqué dans l'arbre"
  | 'arbre non propre'
  | 'empreinte de commit invalide'
  | "la branche distante n'est pas un ancêtre du commit"
  | 'un fichier en ajout seul a perdu des lignes'
  | "nom de branche d'essai refusé"
  | "la destination n'accepte qu'une pull request"
  | "enregistrement d'étape absent"
  | "enregistrement d'étape refusé"
  | "push de la branche d'essai refusé"
  | 'porte rouge'
  | 'le verdict de la porte ne nomme pas ce commit'
  | 'le verdict de la porte ne nomme pas de destination'
  | 'CI rouge'
  | 'aucun runner après le nombre de tentatives permis'
  | 'CI sans réponse'
  | 'une branche distante a bougé'
  | 'push refusé'
  | PullRequestRefusal;

/** Why the forge opened no pull request: a closed list (docs/design/exigences-spec.md, §4). */
export type PullRequestRefusal =
  | 'la forge ne voit pas la branche de travail'
  | "la tête de la branche de travail n'est pas le commit livré"
  | 'une pull request en brouillon est ouverte pour cette tête'
  | 'la forge a refusé la pull request';

/** What `Forge.openPullRequest` is asked: every value comes from the descriptive file, the commit or the host. */
export interface PullRequestRequest {
  /** The branch already pushed, which holds `hash`. */
  head: string;
  /** The branch the pull request asks to change: the destination of the descriptive file. */
  base: string;
  /** The commit the head must be at; nothing is opened otherwise. */
  hash: string;
  title: string;
  body: string;
}

export type PullRequestResult =
  { ok: true; number: number; url: string; created: boolean } | { ok: false; reason: PullRequestRefusal };

export interface CiJob {
  name: string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'other' | null;
  /** Whether GitHub ever gave the job a runner. */
  hadRunner: boolean;
  failedStep: boolean;
  /** Only the first user step failed, before any subsequent user step ran. */
  firstStepFailure?: string;
}

export interface CiRun {
  id: number;
  completed: boolean;
  /** Omitted by older forge adapters. A failed-jobs rerun keeps the run id. */
  attempt?: number;
  jobs: CiJob[];
}

/** Git, in the delivery worktree. */
export interface Repository {
  /**
   * The tree holds a repository of its own: recorded by the index or by the head (an entry of mode 160000), or not
   * tracked (git lists it as a directory). Asked before anything else: git would enter it, read its configuration and
   * start the programs it names, with the identity of the delivery.
   *
   * One tree is left to `isClean`: the one whose only marker lies in a directory that a tracked ignore file ignores
   * while that file is no longer the recorded one. Its rules are not applied, so the marker is found, but what the
   * operator has to repair is the changed file: this method answers false and `isClean` must answer false, which the
   * contract holds for every adapter. The delivery asks both before any other call.
   */
  holdsNestedRepository(): boolean;
  /** The index and the bytes of the checkout are those of the commit, nothing is untracked, and no repository is nested. */
  isClean(): boolean;
  /** The full hash of the commit to deliver (40 hexadecimal characters). */
  head(): string;
  fetch(): void;
  /** The hash of the branch on the remote, as last fetched. */
  remoteHead(branch: string): string | undefined;
  isAncestor(ancestor: string, descendant: string): boolean;
  /** The lines removed from that file between the two commits. */
  deletedLines(from: string, to: string, path: string): number;
  /** Never forced: `refused` when the remote branch is not an ancestor of `hash`, and then it is left as it was. */
  push(hash: string, branch: string): 'pushed' | 'refused';
  /**
   * The text of the regular file at `path` in the tree of the commit `hash`, as that commit records it, whatever the
   * checkout holds; undefined when the commit has no regular file there.
   */
  committedFile(hash: string, path: string): string | undefined;
  deleteRemoteBranch(branch: string): void;
}

export interface Forge {
  /**
   * The run of `workflow` started by the push of `hash` to `branch`: no run of another event or of another branch, even
   * at the same commit. 'all' reads the effective jobs of every numbered attempt when a family has no fixed membership.
   */
  run(
    hash: string,
    workflow: string,
    branch: string,
    jobNames?: readonly string[] | 'all',
  ): CiRun | undefined;
  rerunFailed(id: number): void;
  /**
   * Opens a pull request from `head` to `base`, never as a draft, and never merges it. The open pull request of the same
   * head and base is given back, not doubled (`created` false). Nothing is opened when the forge does not see `head`
   * at `hash`.
   */
  openPullRequest(request: PullRequestRequest): PullRequestResult;
}

/** What the receipt of a green gate says: the commit it judged, and the destination commit it judged it against. */
export interface GateVerdict {
  hash: string;
  /** The commit of the destination the gate recorded (`- destination : <ref> à <commit>`); undefined when none. */
  destination: string | undefined;
}

export interface Gate {
  /** The verdict of the receipt of the gate; it exists only when the gate was green. */
  verdict(): GateVerdict | undefined;
  /** The exit code of the gate. */
  run(): Promise<number>;
}

export interface Clock {
  sleep(seconds: number): Promise<void>;
}

/** What a run that got past the preconditions leaves. */
export interface DeliveryEntry {
  outcome: 'delivered' | 'ready' | 'stopped';
  hash: string;
  trial: string;
  phase?: Phase;
  reason?: Reason;
  ci: { run?: number; attempts: number; polls: number };
  gate: 'reused' | 'ran' | undefined;
  /** The branches pushed by this run, in order. */
  published: string[];
  /** The destination commit the gate judged this commit against: the base of the append-only files. */
  base?: string;
  /** The pull request the run opened or found, and the SHA-256 of the body it was asked with. */
  pullRequest?: { number: number; url: string; created: boolean; body: string };
}

export interface DeliveryLog {
  append(entry: DeliveryEntry): void;
}

export interface Progress {
  /** Told when the phase starts. */
  phase(phase: Stage): void;
}
