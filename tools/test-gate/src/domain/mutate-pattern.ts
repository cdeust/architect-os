import { matchesGlob } from 'node:path';

// The `mutate` patterns of Stryker (node_modules/@stryker-mutator/api/dist/src-generated/stryker-core.d.ts, `mutate`):
// a path or a glob, `!` for an exclusion, or a path with a mutation range `:startLine[:startColumn]-endLine[:endColumn]`
// (node_modules/@stryker-mutator/core/dist/src/fs/mutate-pattern-constants.js, MUTATION_RANGE_REGEX). Stryker
// generates only the mutants whose location lies inside a range, and unites the ranges of one file.

// No `^`: exec tries index 0 first, where the lazy path group absorbs any prefix, so a match always starts there.
const RANGE = /(.*?):(\d+)(?::\d+)?-(\d+)(?::\d+)?$/;

/** Stryker's dist/src/config/file-matcher.js passes the normalized path to minimatch. */
export function requireLiteralMutationPath(path: string): void {
  // The range parser also uses a dot that cannot span a line terminator.
  if (/[\[\]{}*?!()\\\r\n\u2028\u2029]/.test(path)) throw new Error('GATE_MUTATION_PATH_PATTERN : ' + path);
}

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
 * range of the file contains them. An exclusion `!…` names no file: path.matchesGlob does not negate.
 */
export function mutatedAt(mutate: readonly string[], file: string, start: number, end: number): boolean {
  return mutate.some((pattern) => {
    const range = RANGE.exec(pattern);
    if (range === null) return pattern === file || matchesGlob(file, pattern);
    return range[1] === file && Number(range[2]) <= start && end <= Number(range[3]);
  });
}

/** Whether a requested pattern names the file. Evidence of selection must come from instrumentation. */
export function mentioned(mutate: readonly string[], file: string): boolean {
  return mutate.some((pattern) => {
    const path = RANGE.exec(pattern)?.[1] ?? pattern;
    return path === file || matchesGlob(file, path);
  });
}
