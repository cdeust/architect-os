// Où l'hôte pose les scénarios des entrées inventées (docs/design/orchestration-fable-5-2.md, §4) : un dossier du
// worktree qu'il crée lui-même après la construction, que l'exécuteur lit sous le profil `checker` (le worktree y est en
// lecture seule) et que l'hôte retire à la fin de la phase. La phase ne le commite jamais. Aucun chemin ne vient d'une
// session : les noms de fichiers sont ceux que l'hôte a donnés.
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Le nom, à la racine du worktree, du dossier que l'hôte crée pour la phase ; une fonction : un littéral au niveau du module ferait rejouer toute la suite à chacun de ses mutants (Stryker). */
export function freshStageFolder(): string {
  return '.architect-os-fresh-inputs';
}

export interface FreshStage {
  /**
   * Crée le dossier et y écrit chaque fichier (nom -> texte) ; rend le chemin de chacun, relatif à la racine du
   * worktree, dans l'ordre donné. Refuse si quoi que ce soit occupe déjà le chemin du dossier.
   */
  write(files: Readonly<Record<string, string>>): string[];
  /** Retire le dossier que `write` a créé et ce qu'il contient ; sans effet si `write` ne l'a pas créé. */
  remove(): void;
}

/** Un nom de fichier que l'hôte a donné : `fresh-<n>.feature`. */
function fileName(): RegExp {
  return /^fresh-[1-9][0-9]?\.feature$/;
}

function checkNames(files: Readonly<Record<string, string>>): void {
  for (const name of Object.keys(files)) {
    if (!fileName().test(name)) throw new Error(`nom de scénario refusé : ${JSON.stringify(name)}`);
  }
}

/** Le dossier réel, sous la racine que `root` rend. */
export function freshStage(root: () => string): FreshStage {
  const folder = (): string => join(root(), freshStageFolder());
  // Vrai entre la création du dossier par `write` et son retrait : ce que l'hôte n'a pas créé, il ne le retire pas.
  let created = false;
  return {
    write(files) {
      checkNames(files);
      // Sans `recursive` : un dossier, un fichier ou un lien déjà là fait échouer la création, et rien n'est écrit au
      // travers d'un chemin qu'une session aurait posé.
      mkdirSync(folder(), { mode: 0o700 });
      created = true;
      return Object.entries(files).map(([name, text]) => {
        // Le dossier vient d'être créé, et `mkdirSync` refuse un dossier qui existe ; les noms sont les clés d'un objet :
        // aucun fichier n'y est à remplacer.
        writeFileSync(join(folder(), name), text, { mode: 0o600 });
        return `${freshStageFolder()}/${name}`;
      });
    },
    remove() {
      if (!created) return;
      const own = lstatSync(folder(), { throwIfNoEntry: false });
      created = false;
      if (own === undefined) return;
      if (!own.isDirectory())
        throw new Error(`${freshStageFolder()} n'est pas un dossier ordinaire du worktree`);
      rmSync(folder(), { recursive: true });
    },
  };
}

/** Le dossier en mémoire, pour les scénarios : les fichiers écrits, par chemin relatif à la racine. */
export function inMemoryFreshStage(): FreshStage & { readonly files: Map<string, string> } {
  const files = new Map<string, string>();
  let staged = false;
  return {
    files,
    write(given) {
      checkNames(given);
      if (staged) throw new Error(`EEXIST: ${freshStageFolder()}`);
      staged = true;
      return Object.entries(given).map(([name, text]) => {
        const path = `${freshStageFolder()}/${name}`;
        files.set(path, text);
        return path;
      });
    },
    remove() {
      staged = false;
      files.clear();
    },
  };
}
