// Un commit par passe (docs/design/orchestration-fable-5-2.md, §14, « Un commit par passe ») : à la fin de chaque passe
// de `npm run step`, l'hôte, et jamais la session de construction, commite le travail de la passe et son dossier
// `steps/<nom>/` sur la branche de travail que le worktree a en tête. La passe suivante part de ce commit : son empreinte
// est propre, et elle se rejoue depuis le dépôt seul. La construction ne peut écrire ni `.git` ni `steps/` : sous srt,
// le `denyWrite` du profil `builder` ; dans la VM SBX, la liste réservée de l'invité, montée en lecture seule par bwrap
// (`sbx/codex-guest.py`). Ce module ne s'en remet pas à elles : un dossier d'une passe précédente réécrit est refusé
// ici, un pointeur `.git` réécrit par la résolution du worktree.
//
// Ce module tient les règles et les deux cas d'emploi ; le port `PassRepository` est ce qu'ils demandent à git. Ses deux
// adaptateurs : `gitPassRepository` (pass-repository.ts), par les aides de git fermé de ce paquet, et
// `InMemoryPassRepository` (in-memory-pass-repository.ts). Un même contrat les joue (pass-repository.feature).
import { sha256 } from './step-record.js';
import type { TreeFingerprint } from './tree-fingerprint.js';

/** Ce que le worktree a en tête : la branche que `HEAD` nomme (aucune s'il est détaché) et son commit. */
export interface PassHead {
  readonly branch: string | undefined;
  readonly commit: string;
}

/** Un commit à écrire : un arbre, son unique parent, le message, et sa date en secondes depuis l'époque. */
export interface PassCommitRequest {
  readonly tree: string;
  readonly parent: string;
  readonly subject: string;
  readonly body: string;
  readonly seconds: number;
}

/** Ce que le commit d'une passe demande au dépôt du worktree. */
export interface PassRepository {
  /** La branche que `HEAD` nomme et le commit où elle est. */
  head(): PassHead;
  /** Les chemins qui diffèrent entre l'arbre du commit `commit` et l'arbre `tree`, dans l'ordre de git. */
  changedPaths(commit: string, tree: string): string[];
  /** Écrit le commit, sous l'identité fixe de l'hôte (`PASS_IDENTITY`), sans signature ; rend son empreinte. */
  writeCommit(request: PassCommitRequest): string;
  /** Avance `branch` de `expected` à `commit` d'un seul geste ; faux, et la branche laissée, si elle n'est pas à `expected`. */
  advance(branch: string, expected: string, commit: string): boolean;
  /** L'index du worktree devient l'arbre de `commit` ; le répertoire de travail n'est pas touché. */
  settleIndex(commit: string): void;
  /** Les fichiers dont une règle écarte un chemin non suivi du worktree, tels que git les nomme. */
  ignoringFiles(): string[];
  /** L'arbre du commit `commit` a-t-il le chemin `path` ? */
  holds(commit: string, path: string): boolean;
}

/** L'identité fixe de chaque commit de passe : celle de l'hôte, jamais celle d'une session ni du poste. */
export const PASS_IDENTITY = { name: 'architect-os host', email: 'host@architect-os.invalid' } as const;

/** Les refus du commit d'une passe ; le code est la ligne que l'étape écrit. */
export type PassRefusalCode =
  | 'PASS_DETACHED_HEAD'
  | 'PASS_BRANCH_REFUSED'
  | 'PASS_START_DIRTY'
  | 'PASS_BRANCH_MOVED'
  | 'PASS_OUTSIDE_CHANGE'
  | 'PASS_UNRECORDED_IGNORE';

export class PassRefusal extends Error {
  constructor(readonly code: PassRefusalCode) {
    super(code);
  }
}

// L'expression est construite dans une fonction : un littéral au niveau du module ferait rejouer toute la suite pour
// chacun de ses mutants (Stryker).
function workBranch(): RegExp {
  return /^step\/[a-z][a-z0-9-]{0,31}$/;
}

/**
 * Le nom d'une branche de travail : `step/<série>`, la série suivant l'expression d'un nom d'étape. Une liste
 * d'admission, et non une liste de refus : aucune branche de livraison (`main`, `feat/gate-1a`), d'essai
 * (`sentinel/…`) ni de travail à la main (`feat/…`) ne la passe, ni rien qu'une option ou une référence ambiguë
 * (`heads/main`, `origin/main`) pourrait lire autrement.
 */
export function isWorkBranch(name: string): boolean {
  return workBranch().test(name);
}

/**
 * Une règle d'exclusion que le commit de départ n'enregistre pas écarte-t-elle un chemin non suivi ? Une règle d'un
 * fichier que ce commit n'a pas (un `.gitignore` nouveau, même écarté par lui-même, `info/exclude`, un `excludesFile`),
 * ou d'un fichier que la passe a changé, cacherait au commit un fichier que les contrôles et les revues ont jugé.
 */
function unrecordedIgnore(repository: PassRepository, commit: string, changed: readonly string[]): boolean {
  return repository.ignoringFiles().some((file) => changed.includes(file) || !repository.holds(commit, file));
}

/** Le message du commit d'une passe : son sujet nomme la passe, son corps l'empreinte de son enregistrement. */
export function passMessage(name: string, record: string): { subject: string; body: string } {
  return { subject: `Record the pass ${name} of the loop`, body: `record.json sha256 ${sha256(record)}` };
}

/**
 * Avant toute session : la branche de travail que la passe avancera. Le worktree a une branche en tête, de nom admis,
 * à son commit de départ, et son arbre est celui de ce commit : un travail non commité d'avant la passe serait hors de
 * son changement, et la passe ne se rejouerait pas depuis le dépôt seul.
 */
export function admitPass(repository: PassRepository, start: TreeFingerprint): string {
  const { branch, commit } = repository.head();
  if (branch === undefined) throw new PassRefusal('PASS_DETACHED_HEAD');
  if (!isWorkBranch(branch)) throw new PassRefusal('PASS_BRANCH_REFUSED');
  if (!start.clean) throw new PassRefusal('PASS_START_DIRTY');
  if (commit !== start.commit) throw new PassRefusal('PASS_BRANCH_MOVED');
  // Ce que la passe aurait changé : rien pour un arbre propre, mais lu du dépôt plutôt que supposé.
  if (unrecordedIgnore(repository, commit, repository.changedPaths(commit, start.tree)))
    throw new PassRefusal('PASS_UNRECORDED_IGNORE');
  return branch;
}

/** Ce que l'hôte commite à la fin d'une passe. */
export interface PassToCommit {
  /** Le nom de la passe, celui de son dossier `steps/<nom>/`. */
  readonly name: string;
  /** La branche qu'`admitPass` a rendue. */
  readonly branch: string;
  /** L'empreinte prise avant toute session, et celle prise après la publication du dossier. */
  readonly start: TreeFingerprint;
  readonly end: TreeFingerprint;
  /** Les noms des fichiers publiés sous `steps/<nom>/`, et le texte de `record.json`. */
  readonly published: readonly string[];
  readonly record: string;
  /** La date du commit, en secondes : celle du départ de la passe, que l'enregistrement donne aussi. */
  readonly seconds: number;
}

/**
 * Le commit d'une passe : l'arbre de son empreinte de fin, le commit de départ pour seul parent, sur la branche de
 * travail. Refusé si la branche a bougé, ou si ce qui change sous `steps/` n'est pas exactement le dossier publié de la
 * passe. Rend l'empreinte du commit, que l'index du worktree a désormais pour arbre.
 */
export function commitPass(repository: PassRepository, pass: PassToCommit): string {
  const { name, branch, start, end } = pass;
  // Une branche qui a bougé est refusée par l'avance, comparaison puis échange ; ici, un `HEAD` qui nomme une autre
  // branche, ou une empreinte de fin prise sur un autre commit.
  if (repository.head().branch !== branch || end.commit !== start.commit)
    throw new PassRefusal('PASS_BRANCH_MOVED');
  const folder = `steps/${name}/`;
  const all = repository.changedPaths(start.commit, end.tree);
  const changed = all.filter((path) => path.startsWith('steps/'));
  const expected = pass.published.map((file) => folder + file);
  // Un chemin de `steps/` hors du dossier de la passe, ou un fichier publié qui n'entre pas dans l'arbre (qu'un fichier
  // d'exclusion écrit par la session écarterait), est hors du changement de la passe.
  if (changed.length !== expected.length || !expected.every((path) => changed.includes(path)))
    throw new PassRefusal('PASS_OUTSIDE_CHANGE');
  if (unrecordedIgnore(repository, start.commit, all)) throw new PassRefusal('PASS_UNRECORDED_IGNORE');
  const commit = repository.writeCommit({
    tree: end.tree,
    parent: start.commit,
    ...passMessage(name, pass.record),
    seconds: pass.seconds,
  });
  if (!repository.advance(branch, start.commit, commit)) throw new PassRefusal('PASS_BRANCH_MOVED');
  repository.settleIndex(commit);
  return commit;
}
