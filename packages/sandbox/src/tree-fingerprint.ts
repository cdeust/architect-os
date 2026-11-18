// L'empreinte de l'arbre d'un worktree (docs/design/orchestration-fable-5-2.md, §14, « L'empreinte de l'arbre ») :
// le commit de `HEAD`, l'arbre git du répertoire de travail entier, et si cet arbre est celui du commit. Git est lancé
// par un argv, jamais par un shell ; l'index du worktree n'est jamais touché : l'arbre se calcule dans un index
// temporaire.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TreeFingerprint {
  /** `git rev-parse HEAD`. */
  commit: string;
  /**
   * L'arbre git de tout le répertoire de travail : les fichiers suivis, même ceux qu'une règle d'exclusion nomme, et
   * les fichiers non suivis que les règles du dépôt n'écartent pas. Le fichier d'exclusion global de l'hôte n'est pas
   * lu : l'empreinte ne dépend que du dépôt.
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
 * imprimé) s'il sort autrement que par 0 (ne pas démarrer ou dépasser sa borne n'est pas sortir par 0) ; `hashed` demande en plus une empreinte.
 */
function git(
  worktree: string,
  call: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  hashed: boolean,
): string {
  const options = ['core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.excludesFile=/dev/null'];
  const result = spawnSync('git', [...options.flatMap((option) => ['-c', option]), ...call], {
    cwd: worktree,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  const failure = new Error(`l'empreinte de l'arbre a échoué : git ${call.join(' ')}`);
  // Un appel qui ne démarre pas ou dépasse sa borne n'a pas de code de sortie : `status` vaut `null`.
  if (result.status !== 0) throw failure;
  const printed = result.stdout.trim();
  if (hashed && !hash().test(printed)) throw failure;
  return printed;
}

/** L'empreinte de l'arbre de `worktree` ; chaque appel git est borné à `timeoutMs`. */
export function fingerprintTree(worktree: string, timeoutMs = 60_000): TreeFingerprint {
  const commit = git(worktree, ['rev-parse', 'HEAD'], process.env, timeoutMs, true);
  const folder = mkdtempSync(join(tmpdir(), 'aos-tree-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(folder, 'index') };
    // L'index temporaire part de celui du commit : dans un index vide, `add -A` écarterait un fichier suivi qu'une
    // règle d'exclusion nomme, et un arbre propre ne serait pas celui de son commit.
    git(worktree, ['read-tree', 'HEAD'], env, timeoutMs, false);
    git(worktree, ['add', '-A'], env, timeoutMs, false);
    const tree = git(worktree, ['write-tree'], env, timeoutMs, true);
    const committed = git(worktree, ['rev-parse', 'HEAD^{tree}'], process.env, timeoutMs, true);
    return { commit, tree, clean: tree === committed };
  } finally {
    rmSync(folder, { recursive: true });
  }
}
