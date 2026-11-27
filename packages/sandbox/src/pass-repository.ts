// L'adaptateur git du port `PassRepository` (pass-commit.ts). Chaque appel passe par `hostGit` (tree-fingerprint.ts),
// le lanceur de l'empreinte : un argv, jamais un shell ; les options fermées de git-closed.json devant la sous-commande
// (aucun moniteur de fichiers, aucun hook, les attributs de l'arbre vide, aucune descente dans un dépôt imbriqué) ; un
// environnement qui ne lit aucune configuration de la machine, auquel le commit ajoute l'identité et la date qu'il pose
// lui-même. Aucun chemin ni nom ne vient d'une session : la branche est celle que `HEAD` nomme, et `isWorkBranch` l'a
// admise avant qu'elle entre dans un argv.
import { machineIndependentGitEnvironment } from './git-closed.js';
import { PASS_IDENTITY, type PassCommitRequest, type PassHead, type PassRepository } from './pass-commit.js';
import { hostGit } from './tree-fingerprint.js';

const WHAT = 'le commit de la passe';

function hash(): RegExp {
  return /^[0-9a-f]{40}$/;
}

/** Le dépôt du worktree que `root` rend ; chaque appel git est borné à `timeoutMs`. */
export function gitPassRepository(root: () => string, timeoutMs = 60_000): PassRepository {
  const git = (call: readonly string[], own: Readonly<Record<string, string>> = {}): string =>
    hostGit(WHAT, root(), call, machineIndependentGitEnvironment(own), timeoutMs).toString('utf8');
  /** Une empreinte de 40 chiffres hexadécimaux, ou l'échec de l'appel. */
  const hashOf = (call: readonly string[], own?: Readonly<Record<string, string>>): string => {
    const printed = git(call, own).trim();
    if (!hash().test(printed)) throw new Error(`${WHAT} a échoué : git ${call.join(' ')}`);
    return printed;
  };
  return {
    head(): PassHead {
      // `HEAD` détaché s'imprime `HEAD` ; une branche, son nom complet.
      const name = git(['rev-parse', '--symbolic-full-name', 'HEAD']).trim();
      const commit = hashOf(['rev-parse', '--verify', 'HEAD^{commit}']);
      return {
        branch: name.startsWith('refs/heads/') ? name.slice('refs/heads/'.length) : undefined,
        commit,
      };
    },
    changedPaths(commit, tree) {
      // Des noms séparés par NUL, tels que git les écrit : aucun n'est cité ni échappé.
      const listed = git(['diff-tree', '-r', '-z', '--name-only', '--no-renames', commit, tree]);
      return listed.split('\0').filter((path) => path !== '');
    },
    writeCommit({ tree, parent, subject, body, seconds }: PassCommitRequest) {
      const date = `${seconds} +0000`;
      return hashOf(['commit-tree', '--no-gpg-sign', '-p', parent, '-m', subject, '-m', body, tree], {
        GIT_AUTHOR_NAME: PASS_IDENTITY.name,
        GIT_AUTHOR_EMAIL: PASS_IDENTITY.email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: PASS_IDENTITY.name,
        GIT_COMMITTER_EMAIL: PASS_IDENTITY.email,
        GIT_COMMITTER_DATE: date,
      });
    },
    advance(branch, expected, commit) {
      const ref = `refs/heads/${branch}`;
      try {
        // L'ancienne valeur donnée à `update-ref` en fait une comparaison puis un échange, sous le verrou de la référence.
        git(['update-ref', ref, commit, expected]);
        return true;
      } catch (error) {
        // Refusé : la branche a bougé (ou n'existe plus : `for-each-ref` n'imprime alors rien), ou l'appel a échoué pour
        // une autre raison, qui reste un échec.
        if (git(['for-each-ref', '--format=%(objectname)', ref]).trim() !== expected) return false;
        throw error;
      }
    },
    settleIndex(commit) {
      git(['read-tree', '--reset', commit]);
    },
  };
}
