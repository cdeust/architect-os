// Le dossier `steps/` du worktree (docs/design/orchestration-fable-5-2.md, §14) : le seul endroit où l'hôte écrit ce
// qu'une étape laisse dans le dépôt. Le chemin est construit ici, depuis le worktree et un nom déjà validé ; aucun
// chemin ne vient d'une session.
import { lstatSync, mkdirSync, writeFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';

/** Le dossier `steps/` : un nom d'étape y a-t-il déjà son dossier, et l'y écrire une fois. */
export interface StepsFolder {
  /**
   * Crée `steps/` s'il manque, avant toute session : le refus d'écriture du profil du constructeur porte alors sur un
   * dossier qui existe, sur chaque hôte (sous Linux, srt pose un fichier vide à la place d'un chemin refusé absent).
   */
  prepare(): void;
  /** Vrai pour tout ce qui occupe `steps/<nom>`, un lien pendant compris. */
  exists(name: string): boolean;
  /** Crée `steps/<nom>/` et y écrit chaque fichier (nom de fichier -> texte), sans jamais en remplacer un. */
  publish(name: string, files: Readonly<Record<string, string>>): void;
}

/** `lstat` : ce qui est au chemin sans suivre un lien, `undefined` s'il n'y a rien. */
function entry(path: string): Stats | undefined {
  return lstatSync(path, { throwIfNoEntry: false });
}

/**
 * Le dossier `steps/` réel. `root` rend la racine du worktree à chaque opération : c'est sous cette racine, et nulle
 * part ailleurs, que le profil du constructeur refuse l'écriture de `steps/`.
 */
export function stepsFolder(root: () => string): StepsFolder {
  const path = (): string => join(root(), 'steps');
  /** `steps` est-il là ? Il doit être un dossier ordinaire du worktree : ni un lien, ni un fichier. */
  const present = (): boolean => {
    const own = entry(path());
    if (own !== undefined && !own.isDirectory())
      throw new Error("steps n'est pas un dossier ordinaire du worktree");
    return own !== undefined;
  };
  return {
    prepare() {
      if (!present()) mkdirSync(path());
    },
    exists: (name) => present() && entry(join(path(), name)) !== undefined,
    publish(name, files) {
      if (!present()) throw new Error('steps a disparu pendant l’étape');
      const folder = join(path(), name);
      // Relu au moment d'écrire : une session de construction a tourné depuis le premier contrôle.
      if (entry(folder) !== undefined) throw new Error(`steps/${name} existe déjà`);
      mkdirSync(folder);
      for (const [file, text] of Object.entries(files)) {
        // Le dossier vient d'être créé, et `mkdirSync` refuse un dossier qui existe : aucun fichier n'y est à remplacer.
        writeFileSync(join(folder, file), text, { mode: 0o644 });
      }
    },
  };
}
