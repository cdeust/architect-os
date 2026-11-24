/** A file of the diff against the first parent, with the line numbers it has in the working tree. */
export interface ChangedFile {
  readonly path: string;
  readonly deleted: boolean;
  /** Added or modified lines, numbered in the working tree version. Empty for a deleted file. */
  readonly lines: readonly number[];
}

/** A file the first parent does not have (untracked, or every file of a root commit): all its lines are changed. */
export function wholeFile(path: string, text: string): ChangedFile {
  return { path, deleted: false, lines: text.split('\n').map((_, index) => index + 1) };
}

/**
 * The text of what git printed, when it is UTF-8 and nothing else: a name that is not would be read under another
 * spelling than the one git knows.
 */
export function decodeExactly(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("un chemin de git n'est pas de l'UTF-8");
  }
}

/** A path that differs between the first parent and the working tree. */
export interface ChangedPath {
  readonly path: string;
  readonly deleted: boolean;
}

/**
 * Parses `git diff --raw -z --no-renames --no-abbrev`: for each path, a record `:<mode> <mode> <id> <id> <status>`,
 * then the path, each ended by a NUL. Anything else is refused: the gate reads no list it does not understand. So is a
 * repository nested in the tree (mode 160000): the gate judges files, and git would read the configuration of that
 * repository.
 */
export function parseRawDiff(text: string): ChangedPath[] {
  // Built here, not at module level: a module-level regex is a static mutant; built per call, its mutants are covered by test.
  const RECORD = /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]{40} [0-9a-f]{40} ([ADMT])$/;
  const fields = text.split('\0');
  if (fields.pop() !== '') throw new Error('liste des chemins changés illisible');
  if (fields.length % 2 !== 0) throw new Error('liste des chemins changés illisible');
  const paths: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const record = RECORD.exec(fields[index] as string);
    const path = fields[index + 1] as string;
    if (record === null || path === '') throw new Error('liste des chemins changés illisible');
    if (record[1] === '160000' || record[2] === '160000')
      throw new Error(`dépôt imbriqué dans l'arbre : ${path}`);
    paths.push({ path, deleted: record[3] === 'D' });
  }
  return paths;
}

/**
 * The lines of a path git lists as changed and not deleted. Such a path has a patch (a change of mode alone has its
 * two lines): an empty one means that the path given back to git named nothing, and the gate would take a changed
 * file for a file without changed lines.
 */
export function changedLines(path: string, patch: string): number[] {
  if (patch === '') throw new Error(`chemin changé sans diff : ${path}`);
  return hunkLines(patch);
}

/**
 * The added or modified lines of one path, numbered in the working tree, from its `git diff --unified=0`. Only the
 * hunk lines are read: content lines of a hunk always start with ' ', '+', '-' or '\', so a line that starts with
 * `@@` can only be a hunk line.
 */
export function hunkLines(patch: string): number[] {
  const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  const lines: number[] = [];
  for (const line of patch.split('\n')) {
    const hunk = HUNK.exec(line);
    if (hunk === null) continue;
    const start = Number(hunk[1]);
    const count = Number(hunk[2] ?? 1);
    for (let offset = 0; offset < count; offset++) lines.push(start + offset);
  }
  return lines;
}
