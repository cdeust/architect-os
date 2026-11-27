// Où l'hôte pose les scénarios des entrées inventées (docs/design/orchestration-fable-5-2.md, §4) : hors du worktree,
// dans le temporaire privé du run admis, `$ARCHITECT_OS_RUN_DIR/tmp/fresh/<étape>/`, que le profil `checker` lit par sa
// variable `${inputs}`. L'hôte crée le dossier, le vérifie comme les sorties d'une étape (`step-outputs.ts`), y crée
// chaque fichier sans suivre de lien et sans en remplacer un, et le retire à la fin de la phase. Rien n'est écrit dans
// le worktree ; aucun chemin ne vient d'une session : les noms de fichiers sont ceux que l'hôte a donnés.
import { closeSync, constants, lstatSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { hasAdmittedRun } from './runtime-context.js';
import { checkPrivateDirectory } from './state-journal.js';

export interface FreshStage {
  /** Le dossier de la pose, chemin absolu : la variable `${inputs}` du profil `checker` pour les entrées. */
  readonly folder: string;
  /**
   * Crée le dossier et y écrit chaque fichier (nom -> texte) ; rend le chemin absolu de chacun, dans l'ordre donné.
   * Refuse si quoi que ce soit occupe déjà le chemin du dossier, ou un fichier.
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

/**
 * La pose réelle d'une étape, dans le run admis de `env`. Le nom de l'étape est déjà validé. Le dossier `tmp/fresh` est
 * créé s'il manque, puis chaque dossier est vérifié privé (0700, à l'utilisateur, sur le volume de la racine, sans
 * lien) avant qu'on y écrive.
 */
export function freshStage(env: NodeJS.ProcessEnv, step: string): FreshStage {
  const tmp = join(env.ARCHITECT_OS_RUN_DIR!, 'tmp');
  const parent = join(tmp, 'fresh');
  const folder = join(parent, step);
  // Vrai entre la création du dossier par `write` et son retrait : ce que l'hôte n'a pas créé, il ne le retire pas.
  let created = false;
  return {
    folder,
    write(files) {
      checkNames(files);
      if (!hasAdmittedRun(env)) throw new Error('RUNTIME_ENTRY_REQUIRED');
      const device = lstatSync(env.ARCHITECT_OS_RUNTIME_ROOT!, { bigint: true }).dev;
      checkPrivateDirectory(tmp, device);
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      checkPrivateDirectory(parent, device);
      // Sans `recursive` : un dossier, un fichier ou un lien déjà là fait échouer la création.
      mkdirSync(folder, { mode: 0o700 });
      // Créé 0700 sous un parent privé : un masque ne peut qu'ôter des droits, jamais en donner.
      created = true;
      return Object.entries(files).map(([name, text]) => {
        const path = join(folder, name);
        // Créé ici ou refusé : jamais un fichier déjà là, jamais au travers d'un lien.
        const descriptor = openSync(
          path,
          constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
          0o600,
        );
        try {
          writeSync(descriptor, text);
        } finally {
          closeSync(descriptor);
        }
        return path;
      });
    },
    remove() {
      if (!created) return;
      created = false;
      const own = lstatSync(folder, { throwIfNoEntry: false });
      if (own === undefined) return;
      if (!own.isDirectory()) throw new Error(`${folder} n'est pas un dossier ordinaire`);
      rmSync(folder, { recursive: true });
    },
  };
}

/** La pose en mémoire, pour les scénarios : les fichiers écrits, par chemin absolu sous `folder`. */
export function inMemoryFreshStage(folder: string): FreshStage & { readonly files: Map<string, string> } {
  const files = new Map<string, string>();
  let staged = false;
  return {
    folder,
    files,
    write(given) {
      checkNames(given);
      if (staged) throw new Error(`EEXIST: ${folder}`);
      staged = true;
      return Object.entries(given).map(([name, text]) => {
        const path = join(folder, name);
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
