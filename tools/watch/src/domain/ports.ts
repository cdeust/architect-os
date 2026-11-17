// The ports of the watch (docs/design/anthropic-watch.md §3 and §5).

/** Why a source cannot be read: a closed list of fixed strings, never an error text nor anything read from a source. */
export type Reason =
  | 'hôte hors liste'
  | 'protocole refusé'
  | 'redirection refusée'
  | 'délai dépassé'
  | 'trop volumineux'
  | 'réseau'
  | 'contenu refusé'
  | `statut ${number}`;

export type Reading = { kind: 'text'; text: string } | { kind: 'unreadable'; reason: Reason };

/** Reads the text at an address: the only way the tool reaches a source. */
export interface Sources {
  fetch(url: string): Promise<Reading>;
}

/** A folder of text files, named by relative paths (the repository, or the folder given to `--keep`). */
export interface Files {
  /** The text of the file, or undefined when there is none. */
  read(path: string): string | undefined;
  exists(path: string): boolean;
  /** Writes the file, creating the folders above it. */
  write(path: string, text: string): void;
}
