// L'adaptateur en mémoire du port `PassRepository` (pass-commit.ts) : un répertoire de travail, des arbres, des commits,
// des branches, un `HEAD` et un index, sans git. Le contrat du port (pass-repository.feature) le joue à côté de
// l'adaptateur git ; les scénarios de l'étape s'en servent comme dépôt de leur worktree.
import { createHash } from 'node:crypto';
import type { PassCommitRequest, PassHead, PassRepository } from './pass-commit.js';
import type { TreeFingerprint } from './tree-fingerprint.js';

type Files = ReadonlyMap<string, string>;

/** Un commit écrit : son arbre, son parent, son message et sa date. */
export interface InMemoryCommit {
  readonly tree: string;
  readonly parent: string | undefined;
  readonly message: string;
  readonly seconds: number;
}

/** Le premier commit du dépôt : son empreinte et celle de son arbre peuvent être données, pour des scénarios lisibles. */
export interface InMemoryStart {
  readonly branch: string;
  readonly commit?: string;
  readonly tree?: string;
  readonly files?: Readonly<Record<string, string>>;
}

// Le tri par défaut d'un même ensemble d'entrées donne toujours le même ordre : un contenu, une clé.
const key = (files: Files): string => JSON.stringify([...files].sort());

export class InMemoryPassRepository implements PassRepository {
  /** Le répertoire de travail : chemin -> texte. */
  readonly files = new Map<string, string>();
  readonly commits = new Map<string, InMemoryCommit>();
  readonly branches = new Map<string, string>();
  /** La branche que `HEAD` nomme, ou le commit d'un `HEAD` détaché. */
  private headAt: { branch: string } | { commit: string };
  /** L'arbre de l'index du worktree. */
  index: string;
  private readonly trees = new Map<string, Files>();
  private readonly byContent = new Map<string, string>();
  private written = 0;

  constructor(start: InMemoryStart) {
    for (const [path, text] of Object.entries(start.files ?? {})) this.files.set(path, text);
    const tree = this.treeOf(new Map(this.files), start.tree);
    const commit = start.commit ?? this.nextCommit();
    this.commits.set(commit, { tree, parent: undefined, message: 'first\n', seconds: 0 });
    this.branches.set(start.branch, commit);
    this.headAt = { branch: start.branch };
    this.index = tree;
  }

  /** Le commit que `HEAD` désigne. */
  private headCommit(): string {
    return 'branch' in this.headAt ? (this.branches.get(this.headAt.branch) as string) : this.headAt.commit;
  }

  /** L'arbre d'un contenu : le même contenu a toujours la même empreinte, `given` pour le premier qui l'enregistre. */
  private treeOf(files: Files, given?: string): string {
    const content = key(files);
    const known = this.byContent.get(content);
    if (known !== undefined) return known;
    const tree = given ?? createHash('sha1').update(content).digest('hex');
    this.byContent.set(content, tree);
    this.trees.set(tree, files);
    return tree;
  }

  /** Les commits écrits par l'adaptateur portent un numéro : 0…01, 0…02, dans l'ordre. */
  private nextCommit(): string {
    this.written++;
    return this.written.toString(16).padStart(40, '0');
  }

  private filesOfCommit(commit: string): Files {
    return this.trees.get((this.commits.get(commit) as InMemoryCommit).tree) as Files;
  }

  /** L'empreinte du répertoire de travail, comme `fingerprintTree` la donne pour un dépôt git. */
  snapshot(): TreeFingerprint {
    const commit = this.headCommit();
    const tree = this.treeOf(new Map(this.files));
    return { commit, tree, clean: tree === (this.commits.get(commit) as InMemoryCommit).tree };
  }

  /** `HEAD` détaché sur son commit. */
  detach(): void {
    this.headAt = { commit: this.headCommit() };
  }

  /** `HEAD` nomme une autre branche, créée au commit de tête. */
  switchTo(branch: string): void {
    this.branches.set(branch, this.headCommit());
    this.headAt = { branch };
  }

  head(): PassHead {
    return { branch: 'branch' in this.headAt ? this.headAt.branch : undefined, commit: this.headCommit() };
  }

  changedPaths(commit: string, tree: string): string[] {
    const before = this.filesOfCommit(commit);
    const after = this.trees.get(tree) as Files;
    const paths = new Set([...before.keys(), ...after.keys()]);
    return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
  }

  writeCommit({ tree, parent, subject, body, seconds }: PassCommitRequest): string {
    const commit = this.nextCommit();
    this.commits.set(commit, { tree, parent, message: `${subject}\n\n${body}\n`, seconds });
    return commit;
  }

  advance(branch: string, expected: string, commit: string): boolean {
    if (this.branches.get(branch) !== expected) return false;
    this.branches.set(branch, commit);
    return true;
  }

  settleIndex(commit: string): void {
    this.index = (this.commits.get(commit) as InMemoryCommit).tree;
  }
}
