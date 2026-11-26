// L'empreinte de l'arbre d'un worktree (docs/design/orchestration-fable-5-2.md, §14, « L'empreinte de l'arbre ») :
// le commit de `HEAD`, l'arbre git du répertoire de travail entier, et si cet arbre est celui du commit. Git est lancé
// par un argv, jamais par un shell ; l'index du worktree n'est jamais touché : l'arbre se calcule dans un index
// temporaire.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closedGitOptions, machineIndependentGitEnvironment } from './git-closed.js';
import { containsGitlink, visibleNestedMarker } from './git-worktree.js';

export interface TreeFingerprint {
  /** `git rev-parse HEAD`. */
  commit: string;
  /**
   * L'arbre git de tout le répertoire de travail : les fichiers suivis, même ceux qu'une règle d'exclusion nomme, et
   * les fichiers non suivis que les règles du dépôt n'écartent pas. Aucune configuration globale ni système de git
   * n'est lue : l'empreinte ne dépend que du dépôt.
   */
  tree: string;
  /** `tree` est l'arbre du commit. */
  clean: boolean;
}

function hash(): RegExp {
  return /^[0-9a-f]{40}$/;
}

/**
 * Un appel git, borné dans le temps. Il échoue (message fixe, qui nomme l'appel et ne porte rien de ce que git a
 * imprimé) s'il sort autrement que par 0 (ne pas démarrer ou dépasser sa borne n'est pas sortir par 0).
 */
function git(
  worktree: string,
  call: readonly string[],
  environment: Readonly<Record<string, string>>,
  timeoutMs: number,
): Buffer {
  // Les options et l'environnement de chaque git que l'hôte lance viennent d'un seul module (git-closed.ts) : aucune
  // variable de l'hôte hors de sa liste, aucune configuration de la machine.
  const result = spawnSync('git', [...closedGitOptions(), ...call], {
    cwd: worktree,
    env: environment,
    timeout: timeoutMs,
    // Les deux listes d'un arbre entier passent ici : la borne par défaut (1 Mio) arrêterait git avant sa fin.
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) throw new Error(`l'empreinte de l'arbre a échoué : git ${call.join(' ')}`);
  return result.stdout;
}

function gitHash(
  worktree: string,
  call: readonly string[],
  environment: Readonly<Record<string, string>>,
  timeoutMs: number,
): string {
  const printed = git(worktree, call, environment, timeoutMs).toString().trim();
  if (!hash().test(printed)) throw new Error(`l'empreinte de l'arbre a échoué : git ${call.join(' ')}`);
  return printed;
}

/** L'empreinte de l'arbre de `worktree` ; chaque appel git est borné à `timeoutMs`. */
export function fingerprintTree(worktree: string, timeoutMs = 60_000): TreeFingerprint {
  const host = machineIndependentGitEnvironment();
  const commit = gitHash(worktree, ['rev-parse', 'HEAD'], host, timeoutMs);
  const folder = mkdtempSync(join(tmpdir(), 'aos-tree-'));
  try {
    const env = machineIndependentGitEnvironment({ GIT_INDEX_FILE: join(folder, 'index') });
    // L'index temporaire part de celui du commit : dans un index vide, `add -A` écarterait un fichier suivi qu'une
    // règle d'exclusion nomme, et un arbre propre ne serait pas celui de son commit.
    git(worktree, ['read-tree', 'HEAD'], env, timeoutMs);
    // The private index is seeded from HEAD. Check it and discover visible markers before Git walks the checkout.
    const recorded = git(worktree, ['ls-files', '-s', '-z'], env, timeoutMs);
    if (containsGitlink(recorded))
      throw new Error("l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre");
    const marker = visibleNestedMarker(worktree, recorded, timeoutMs);
    // Un fichier d'exclusion suivi qui n'est plus celui enregistré n'écarte rien, qu'une session y ait ajouté une
    // règle ou non : le refus le dit, sans quoi un dossier que le dépôt écartait (dépendances, autres worktrees)
    // paraîtrait un dépôt imbriqué sans raison.
    if (marker !== undefined)
      throw new Error(
        marker.changedIgnoreFile === undefined
          ? "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre"
          : "l'empreinte de l'arbre a échoué : dépôt imbriqué dans l'arbre, sous un dossier qu'écarte un fichier d'exclusion suivi qui n'est plus celui enregistré : ses règles ne sont pas appliquées",
      );
    git(worktree, ['add', '-A'], env, timeoutMs);
    const tree = gitHash(worktree, ['write-tree'], env, timeoutMs);
    const committed = gitHash(worktree, ['rev-parse', 'HEAD^{tree}'], host, timeoutMs);
    return { commit, tree, clean: tree === committed };
  } finally {
    rmSync(folder, { recursive: true });
  }
}
