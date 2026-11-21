import { noopLogger } from '@stryker-mutator/util';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Perimeter } from '../domain/mutation.js';

const instrumenter = new Instrumenter(noopLogger);

function sourceDigest(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/** Discover before projecting: Stryker range containment would omit enclosing, multiline AST nodes. */
export async function mutationLots(
  root: string,
  perimeter: Perimeter,
  canary: string | undefined,
  read: (file: string) => string | null,
) {
  const wholeFiles = new Set(perimeter.retired);
  if (canary !== undefined) wholeFiles.add(canary);
  const candidates = [...new Set([...perimeter.files, ...wholeFiles])].sort();
  const lots = [];
  for (const file of candidates) {
    const source = read(file);
    if (source === null) throw new Error(file + ' : source de mutation absente');
    const lines = [...(perimeter.changedLines.get(file) ?? [])].sort((a, b) => a - b);
    const whole = wholeFiles.has(file);
    if (!whole && lines.length === 0) throw new Error(file + ' : périmètre de mutation vide');
    const { mutants } = await instrumenter.instrument(
      [{ name: resolve(root, file), content: source, mutate: true }],
      // Matches the pinned gate config's defaults for the mutator and ignorer options.
      { plugins: null, excludedMutations: [], ignorers: [] },
    );
    lots.push({
      file,
      sourceSha256: sourceDigest(source),
      whole,
      nativeMutants: mutants.length,
      lines,
      mutants: mutants.flatMap(({ location, mutatorName, replacement, status, statusReason }) => {
        // Instrumenter API uses zero-based positions. The gate consumes one-based reporter positions.
        const start = { line: location.start.line + 1, column: location.start.column + 1 };
        const end = { line: location.end.line + 1, column: location.end.column + 1 };
        if (!whole && !lines.some((line) => line >= start.line && line <= end.line)) return [];
        return [
          {
            start,
            end,
            mutatorName,
            replacement,
            ignored: status === 'Ignored' ? (statusReason ?? '') : null,
          },
        ];
      }),
    });
  }
  return lots;
}
