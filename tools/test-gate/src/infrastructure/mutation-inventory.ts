import { strykerCoreSchema } from '@stryker-mutator/api/core';
import { noopLogger } from '@stryker-mutator/util';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Perimeter } from '../domain/mutation.js';

const instrumenter = new Instrumenter(noopLogger);

type InstrumenterOptions = Parameters<Instrumenter['instrument']>[1];
type PublishedMutatorDefaults = {
  definitions: {
    mutatorDescriptor: {
      properties: {
        plugins: { default: InstrumenterOptions['plugins'] };
        excludedMutations: { default: InstrumenterOptions['excludedMutations'] };
      };
    };
  };
};

const { plugins, excludedMutations } = (strykerCoreSchema as PublishedMutatorDefaults).definitions
  .mutatorDescriptor.properties;
const inventoryOptions: InstrumenterOptions = {
  plugins: plugins.default,
  excludedMutations: excludedMutations.default,
  ignorers: [],
};

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
    // The perimeter keeps the changed line order from Git.
    const lines = [...(perimeter.changedLines.get(file) ?? [])];
    const whole = wholeFiles.has(file);
    const { mutants } = await instrumenter.instrument(
      [{ name: resolve(root, file), content: source, mutate: true }],
      inventoryOptions,
    );
    lots.push({
      file,
      sourceSha256: sourceDigest(source),
      whole,
      nativeMutants: mutants.length,
      lines,
      mutants: mutants.flatMap(({ location, mutatorName, replacement, statusReason }) => {
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
            ignored: statusReason || null,
          },
        ];
      }),
    });
  }
  return lots;
}
