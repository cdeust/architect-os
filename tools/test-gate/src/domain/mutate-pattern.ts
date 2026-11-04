import { matchesGlob } from 'node:path';

// The `mutate` patterns of Stryker (node_modules/@stryker-mutator/api/dist/src-generated/stryker-core.d.ts, `mutate`):
// a path or a glob, `!` for an exclusion, or a path with a mutation range `:startLine[:startColumn]-endLine[:endColumn]`
// (node_modules/@stryker-mutator/core/dist/src/fs/mutate-pattern-constants.js, MUTATION_RANGE_REGEX). Stryker
// generates only the mutants whose location lies inside a range, and unites the ranges of one file.

const RANGE = /^(.*?):(\d+)(?::\d+)?-(\d+)(?::\d+)?$/;

/** One pattern per run of consecutive lines: `file:first-last`, whole lines. */
export function rangePatterns(file: string, lines: ReadonlySet<number>): string[] {
  const sorted = [...lines].sort((a, b) => a - b);
  const patterns: string[] = [];
  let first = sorted[0] as number;
  sorted.forEach((line, index) => {
    const next = sorted[index + 1];
    if (next === line + 1) return;
    patterns.push(`${file}:${first}-${line}`);
    first = next as number;
  });
  return patterns;
}

/**
 * Whether the run mutated lines `start` to `end` of `file`: a pattern names the whole file (its path or a glob), or a
 * range of the file contains them. Exclusions are not read: the gate never mutates what it excludes.
 */
export function mutatedAt(mutate: readonly string[], file: string, start: number, end: number): boolean {
  return mutate.some((pattern) => {
    const range = RANGE.exec(pattern);
    if (range === null) return !pattern.startsWith('!') && (pattern === file || matchesGlob(file, pattern));
    return range[1] === file && Number(range[2]) <= start && end <= Number(range[3]);
  });
}

/** Whether a pattern of the run names `file`, whole or by a range: a file so named and absent had no mutant. */
export function mentioned(mutate: readonly string[], file: string): boolean {
  return mutate.some((pattern) => {
    const path = RANGE.exec(pattern)?.[1] ?? pattern;
    return !pattern.startsWith('!') && (path === file || matchesGlob(file, path));
  });
}
