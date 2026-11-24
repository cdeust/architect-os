import { matchesGlob } from 'node:path';

// The `mutate` patterns of Stryker (node_modules/@stryker-mutator/api/dist/src-generated/stryker-core.d.ts, `mutate`):
// a path or a glob, `!` for an exclusion, or a path with a mutation range `:startLine[:startColumn]-endLine[:endColumn]`
// (node_modules/@stryker-mutator/core/dist/src/fs/mutate-pattern-constants.js, MUTATION_RANGE_REGEX). Stryker
// generates only the mutants whose location lies inside a range, and unites the ranges of one file.

// No `^`: exec tries index 0 first, where the lazy path group absorbs any prefix, so a match always starts there.
const RANGE = /(.*?):(\d+)(?::\d+)?-(\d+)(?::\d+)?$/;

/** Stryker normalizes backslashes. Minimatch expands braces before parsing character classes. */
export function requireLiteralMutationPath(path: string): void {
  if (/[{}\\\r\n\u2028\u2029]/.test(path) || RANGE.test(path))
    throw new Error('GATE_MUTATION_PATH_PATTERN : ' + path);
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
