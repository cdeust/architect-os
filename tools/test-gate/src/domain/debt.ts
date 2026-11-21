import { mutatedAt } from './mutate-pattern.js';
import type { ReadFailure, Violation } from './violation.js';

/** A position of the Stryker report: line and column both start at one, the end column is exclusive. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** One known surviving mutant of the code that predates brick 1a. Its identity is text, never the mutant `id`. */
export interface DebtEntry {
  readonly file: string;
  readonly start: Position;
  readonly end: Position;
  readonly mutator: string;
  /** The code the mutant replaces: the slice of the file between start and end. */
  readonly original: string;
  readonly replacement: string;
}

/** The mutation debt registry (gate.json `debt`): it can only shrink. */
export interface DebtRegistry {
  readonly survivors: readonly DebtEntry[];
}

/** What the debt needs of a mutant of the Stryker report. */
export interface DebtMutant {
  readonly mutatorName: string;
  readonly status: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly replacement: string;
}

/** What the debt needs of the Stryker report (MutationReport satisfies it). */
export interface DebtReport {
  readonly files: ReadonlyMap<string, { readonly source: string; readonly mutants: readonly DebtMutant[] }>;
  readonly mutate: readonly string[];
}

/** The registries and the tree rule 6 reads. */
export interface DebtInput {
  /** Path of the registry, as in gate.json. */
  readonly path: string;
  /** The registry of the working tree; a ReadFailure when it is absent or malformed. */
  readonly current: DebtRegistry | ReadFailure;
  /** The registry of the first parent; null when the first parent has no such file or there is no first parent. */
  readonly parent: DebtRegistry | ReadFailure | null;
  /** The files of the entries of both registries that exist in the working tree. */
  readonly present: ReadonlySet<string>;
  /** The text of the files of the entries of both registries that exist in the working tree. */
  readonly sources: ReadonlyMap<string, string>;
}

/** What the report prints of the debt. */
export interface DebtSummary {
  readonly path: string;
  /** Entries of the current registry. */
  readonly survivors: number;
  /** Mutants of the rule 5 perimeter accepted because they are in the registry. */
  readonly accepted: number;
  /** Entries whose mutant is in the report of this run but did not survive it (Killed, Timeout, ...). */
  readonly notSurvived: number;
  /** Entries the current registry holds and the first parent's does not (all of them for a creation). */
  readonly added: number;
  readonly removed: number;
  /** The first parent has no registry: this diff creates it. */
  readonly created: boolean;
}

export interface DebtJudgement {
  readonly summary: DebtSummary;
  readonly violations: readonly Violation[];
}

const DEBT_STATUSES = new Set(['Survived', 'NoCoverage']);
const NOT_KILLED = new Set(['Survived', 'NoCoverage', 'Pending']);

/** The readable identity of an entry: `file:l:c-l:c mutator original -> replacement`. */
export function debtIdentity(entry: DebtEntry): string {
  const { file, start, end } = entry;
  const where = `${file}:${start.line}:${start.column}-${end.line}:${end.column}`;
  return `${where} ${entry.mutator} ${JSON.stringify(entry.original)} -> ${JSON.stringify(entry.replacement)}`;
}

// Every position is inside the lines: parseMutationReport refuses a report whose mutant reaches past the last line.
function sliceOf(lines: readonly string[], start: Position, end: Position): string {
  const line = (position: Position) => lines[position.line - 1] as string;
  if (start.line === end.line) return line(start).slice(start.column - 1, end.column - 1);
  return [
    line(start).slice(start.column - 1),
    ...lines.slice(start.line, end.line - 1),
    line(end).slice(0, end.column - 1),
  ].join('\n');
}

/** The text between two positions of a file in the working tree; null when they reach past its last line. */
function textAt(lines: readonly string[], start: Position, end: Position): string | null {
  return lines[Math.max(start.line, end.line) - 1] === undefined ? null : sliceOf(lines, start, end);
}

/** The entry that stands for a mutant of `file`, `source` being the file as the report carries it. */
export function entryOf(file: string, mutant: DebtMutant, source: string): DebtEntry {
  const start = { line: mutant.startLine, column: mutant.startColumn };
  const end = { line: mutant.endLine, column: mutant.endColumn };
  return {
    file,
    start,
    end,
    mutator: mutant.mutatorName,
    original: sliceOf(source.split('\n'), start, end),
    replacement: mutant.replacement,
  };
}

function earlier(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every Survived and NoCoverage mutant of every file of the report, by file, line, column, mutator, replacement. */
export function debtEntries(report: DebtReport): DebtEntry[] {
  return [...report.files]
    .flatMap(([file, result]) =>
      result.mutants
        .filter((mutant) => DEBT_STATUSES.has(mutant.status))
        .map((mutant) => entryOf(file, mutant, result.source)),
    )
    .sort(
      (a, b) =>
        earlier(a.file, b.file) ||
        a.start.line - b.start.line ||
        a.start.column - b.start.column ||
        earlier(a.mutator, b.mutator) ||
        earlier(a.replacement, b.replacement),
    );
}

/**
 * What `test-gate debt` prints: entries by first directory of their file, then the total. `entries` come sorted by
 * file (debtEntries), so the Map, which keeps insertion order, meets the directories in that order: sorting them
 * again would change nothing.
 */
export function renderGenerated(path: string, entries: readonly DebtEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const directory = entry.file.split('/')[0] as string;
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  const lines = [...counts].map(([directory, n]) => `- ${directory} : ${n}`);
  return [`registre de dette écrit : ${path}`, ...lines, `- total : ${entries.length}`, ''].join('\n');
}

/** The entries of a registry; none when it is unreadable. */
function entriesOf(registry: DebtRegistry | ReadFailure): readonly DebtEntry[] {
  return 'failure' in registry ? [] : registry.survivors;
}

/** The identities of the current registry, for rule 5; empty when it is unreadable. */
export function acceptedIdentities(input: DebtInput): ReadonlySet<string> {
  return new Set(entriesOf(input.current).map(debtIdentity));
}

/** The (file, mutator, original, replacement) of an entry: what it is, wherever it stands. */
function kindOf(entry: DebtEntry): string {
  return JSON.stringify([entry.file, entry.mutator, entry.original, entry.replacement]);
}

/**
 * The entries of `from` that `against` holds fewer times, counted by kind and not by position: for each kind, as
 * many entries as `from` holds more of it, the ones `against` does not hold at the same place first.
 */
function surplus(from: readonly DebtEntry[], against: readonly DebtEntry[]): DebtEntry[] {
  const counts = new Map<string, number>();
  for (const entry of from) counts.set(kindOf(entry), (counts.get(kindOf(entry)) ?? 0) + 1);
  for (const entry of against) counts.set(kindOf(entry), (counts.get(kindOf(entry)) ?? 0) - 1);
  const held = new Set(against.map(debtIdentity));
  return from.filter((entry) => {
    const left = counts.get(kindOf(entry)) as number;
    if (held.has(debtIdentity(entry)) || left <= 0) return false;
    counts.set(kindOf(entry), left - 1);
    return true;
  });
}

/** Entries of the first parent's registry that the current one no longer holds; none when either is unreadable. */
function removedEntries(input: DebtInput): DebtEntry[] {
  const { current, parent } = input;
  if (parent === null || 'failure' in parent || 'failure' in current) return [];
  return surplus(parent.survivors, current.survivors);
}

/**
 * Production files of removed entries: Stryker must mutate them so that the removal is proved (rule 6). A removed
 * entry whose file is gone from the tree is allowed without proof.
 */
export function retiredFiles(input: DebtInput, production: readonly string[]): string[] {
  const files = new Set(removedEntries(input).map((entry) => entry.file));
  return production.filter((file) => files.has(file) && input.present.has(file));
}

/** Rule 6: the registry is readable, only shrinks, and tells the truth about the files and the report. */
export function judgeDebt(
  input: DebtInput,
  report: DebtReport | ReadFailure,
  accepted: number,
  nativeCoverage?: (entry: DebtEntry) => boolean,
): DebtJudgement {
  const violations: Violation[] = [];
  const add = (text: string) => violations.push({ rule: 6, text });
  const { current, parent, present } = input;
  if ('failure' in current) add(`registre de dette illisible : ${current.failure}`);
  if (parent !== null && 'failure' in parent) {
    add(`registre de dette illisible au premier parent : ${parent.failure}`);
  }
  const entries = entriesOf(current);
  // An entry whose file is in the working tree and does not hold its `original` between its start and its end.
  const lines = new Map([...input.sources].map(([file, source]) => [file, source.split('\n')]));
  const misaligned = (entry: DebtEntry) => {
    const own = lines.get(entry.file);
    return own !== undefined && textAt(own, entry.start, entry.end) !== entry.original;
  };
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = debtIdentity(entry);
    if (misaligned(entry)) add(`${id} : désalignée (le code a bougé), lancer « test-gate debt realign »`);
    else if (ids.has(id)) add(`${id} : identité en double dans le registre`);
    ids.add(id);
  }
  // A misaligned entry is reported as such, and not as an entry added.
  const added = (parent === null || 'failure' in parent ? [] : surplus(entries, parent.survivors)).filter(
    (candidate) => !misaligned(candidate),
  );
  for (const entry of added) {
    add(`${debtIdentity(entry)} : entrée ajoutée au registre, le registre ne peut que rétrécir`);
  }
  const removed = removedEntries(input);
  // The report as the checks below read it; none when it is unreadable (rule 5 says so, nothing is judged on it).
  const readable = 'failure' in report ? null : report;
  // An entry the run mutated: its lines lie in a pattern of config.mutate (a whole file, a glob, or a range).
  const covered = (found: DebtReport, entry: DebtEntry) =>
    mutatedAt(found.mutate, entry.file, entry.start.line, entry.end.line) &&
    (nativeCoverage?.(entry) ?? true);
  // The identities of the mutants of one file of the report whose status passes `keep`.
  const identitiesOf = (found: DebtReport, file: string, keep: (status: string) => boolean): Set<string> => {
    const result = found.files.get(file);
    if (result === undefined) return new Set();
    return new Set(
      result.mutants
        .filter((mutant) => keep(mutant.status))
        .map((mutant) => debtIdentity(entryOf(file, mutant, result.source))),
    );
  };
  for (const entry of removed) {
    if (!present.has(entry.file) || readable === null) continue;
    const id = debtIdentity(entry);
    if (!covered(readable, entry))
      add(`${id} : retrait non prouvé, le fichier n'est pas dans le rapport de mutation`);
    else if (identitiesOf(readable, entry.file, (status) => NOT_KILLED.has(status)).has(id)) {
      add(`${id} : retrait refusé, le survivant existe toujours`);
    }
  }
  let notSurvived = 0;
  for (const entry of entries) {
    const id = debtIdentity(entry);
    if (misaligned(entry)) continue;
    if (!present.has(entry.file)) add(`${id} : fichier absent, entrée à retirer dans la même PR`);
    else if (readable !== null && covered(readable, entry)) {
      if (!identitiesOf(readable, entry.file, () => true).has(id)) {
        add(`${id} : introuvable (code supprimé ou déplacé), à retirer dans la même PR`);
      } else if (!identitiesOf(readable, entry.file, (status) => NOT_KILLED.has(status)).has(id)) {
        notSurvived++;
      }
    }
  }
  const summary: DebtSummary = {
    path: input.path,
    survivors: entries.length,
    accepted,
    notSurvived,
    added: parent === null ? ids.size : added.length,
    removed: removed.length,
    created: parent === null,
  };
  return { summary, violations };
}

/** What `test-gate debt realign` did: the registry as it stands afterwards, the entries moved, those that still do not point at their text. */
export interface Realignment {
  readonly survivors: readonly DebtEntry[];
  readonly moved: number;
  readonly stuck: readonly DebtEntry[];
}

/** The places of a file where the text of `entry` stands at the columns of `entry`, first line first. */
function placesOf(lines: readonly string[], entry: DebtEntry): DebtEntry[] {
  const span = entry.end.line - entry.start.line;
  return lines
    .map((_, index) => ({
      ...entry,
      start: { line: index + 1, column: entry.start.column },
      end: { line: index + 1 + span, column: entry.end.column },
    }))
    .filter((place) => textAt(lines, place.start, place.end) === entry.original);
}

/** An entry that stands in its file, and how far its block moved (0 when it did not). */
interface Neighbour {
  readonly file: string;
  readonly line: number;
  readonly offset: number;
}

/** Of the neighbours, the one whose line is the nearest to `line`. */
function nearest(neighbours: readonly Neighbour[], line: number): Neighbour | undefined {
  const gap = Math.min(...neighbours.map((neighbour) => Math.abs(neighbour.line - line)));
  return neighbours.find((neighbour) => Math.abs(neighbour.line - line) === gap);
}

/**
 * Puts the entries back on their text, file by file. A candidate of a misaligned entry is a place where its text
 * stands at its columns and that no aligned entry of the same mutator, original and replacement holds. With one
 * candidate the entry moves there, unless another entry of the same kind has the same only candidate: neither
 * moves. With several candidates it moves only to the one that lies at the offset of its nearest neighbour above
 * or below (an entry aligned, offset 0, or moved by the first step); two candidates named, or none, no move; and a
 * candidate so named for two entries is given to neither.
 * Each step is applied once. An entry is never added or removed, and an aligned one never moves. `sources` holds
 * the files that exist in the working tree.
 */
export function realign(entries: readonly DebtEntry[], sources: ReadonlyMap<string, string>): Realignment {
  const lines = new Map([...sources].map(([file, source]) => [file, source.split('\n')]));
  const pointing = (entry: DebtEntry) => {
    const own = lines.get(entry.file);
    return own !== undefined && textAt(own, entry.start, entry.end) === entry.original;
  };
  // A place that carries the identity of an entry holds its text, so that entry is aligned: it holds the place.
  const held = new Set(entries.map(debtIdentity));
  const candidates = new Map<number, DebtEntry[]>();
  entries.forEach((entry, index) => {
    const own = lines.get(entry.file);
    if (own === undefined || pointing(entry)) return;
    candidates.set(
      index,
      placesOf(own, entry).filter((place) => !held.has(debtIdentity(place))),
    );
  });
  const single = [...candidates].filter(([, places]) => places.length === 1);
  const claims = new Map<string, number>();
  for (const [, places] of single) {
    const id = debtIdentity(places[0] as DebtEntry);
    claims.set(id, (claims.get(id) ?? 0) + 1);
  }
  const moves = new Map<number, DebtEntry>();
  for (const [index, places] of single) {
    if (claims.get(debtIdentity(places[0] as DebtEntry)) === 1) moves.set(index, places[0] as DebtEntry);
  }
  const neighbours = entries
    .map((entry, index) => ({ entry, to: moves.get(index) ?? entry }))
    .filter(({ to }) => pointing(to))
    .map(({ entry, to }): Neighbour => {
      return { file: entry.file, line: entry.start.line, offset: to.start.line - entry.start.line };
    });
  const evidence = new Map<number, DebtEntry>();
  for (const [index, places] of candidates) {
    const entry = entries[index] as DebtEntry;
    if (places.length < 2) continue;
    const own = neighbours.filter((neighbour) => neighbour.file === entry.file);
    const line = entry.start.line;
    const above = nearest(
      own.filter((neighbour) => neighbour.line < line),
      line,
    );
    const below = nearest(
      own.filter((neighbour) => neighbour.line > line),
      line,
    );
    const named = places.filter((place) => {
      const offset = place.start.line - line;
      return offset === above?.offset || offset === below?.offset;
    });
    if (named.length === 1) evidence.set(index, named[0] as DebtEntry);
  }
  // Two entries cannot take the same place: a place the neighbours name for several entries is given to none.
  const named = new Map<string, number>();
  for (const place of evidence.values()) {
    const id = debtIdentity(place);
    named.set(id, (named.get(id) ?? 0) + 1);
  }
  for (const [index, place] of evidence) if (named.get(debtIdentity(place)) === 1) moves.set(index, place);
  const survivors = entries.map((entry, index) => moves.get(index) ?? entry);
  return { survivors, moved: moves.size, stuck: survivors.filter((entry) => !pointing(entry)) };
}

/** What `test-gate debt realign` prints: how many entries it moved, then each one it could not, with its identity. */
export function renderRealigned(path: string, moved: number, stuck: readonly DebtEntry[]): string {
  const lines = stuck.map((entry) => `- non déplacée : ${debtIdentity(entry)}`);
  return [`registre de dette réaligné : ${path}`, `- entrées déplacées : ${moved}`, ...lines, ''].join('\n');
}
