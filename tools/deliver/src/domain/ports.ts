// The ports of the delivery command (docs/design/orchestration-fable-5-2.md §14, « Étape 1, la commande de livraison »).
// Each method is one fact asked or one act done; none takes free text from a caller.

/** Where a run stopped. */
export type Phase = 'préalables' | "branche d'essai" | 'porte' | 'CI' | 'publication';

/** What `Progress` is told: the phases a run can stop at, and the last one, which a run never stops at. */
export type Stage = Phase | 'rangement';

/** Why a run stopped: a closed list of fixed strings, never a text read from a port. */
export type Reason =
  | 'arbre non propre'
  | 'empreinte de commit invalide'
  | 'branche distante absente'
  | "la branche distante n'est pas un ancêtre du commit"
  | 'les branches distantes diffèrent'
  | 'rien à livrer'
  | 'un fichier en ajout seul a perdu des lignes'
  | "nom de branche d'essai refusé"
  | "push de la branche d'essai refusé"
  | 'porte rouge'
  | 'le verdict de la porte ne nomme pas ce commit'
  | 'CI rouge'
  | 'aucun runner après le nombre de tentatives permis'
  | 'CI sans réponse'
  | 'une branche distante a bougé'
  | 'push refusé'
  | "le ruleset n'a pas rendu pass"
  | 'évaluation du ruleset introuvable';

export type RuleSuite = 'pass' | 'fail' | 'bypass';

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
  deleteRemoteBranch(branch: string): void;
}

export interface Forge {
  run(hash: string, workflow: string, jobNames?: readonly string[]): CiRun | undefined;
  rerunFailed(id: number): void;
  /** The evaluation of the push that brought `hash` to `branch`; undefined while there is none (or nobody pushed). */
  ruleSuite(branch: string, hash: string): RuleSuite | undefined;
}

export interface Gate {
  /** The hash the verdict file of the gate names; the file exists only when the gate was green. */
  verdictHash(): string | undefined;
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
  parent: string;
  phase?: Phase;
  reason?: Reason;
  ci: { run?: number; attempts: number; polls: number };
  gate: 'reused' | 'ran' | undefined;
  /** The branches pushed by this run, in order. */
  published: string[];
  /** The evaluation read for each branch of the file, pushed by this run or already at the hash. */
  ruleSuites: Map<string, RuleSuite>;
}

export interface DeliveryLog {
  append(entry: DeliveryEntry): void;
}

export interface Progress {
  /** Told when the phase starts. */
  phase(phase: Stage): void;
}
