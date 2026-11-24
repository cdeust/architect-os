import { inPerimeter, type MutationReport, type Perimeter } from '../domain/mutation.js';
import { mutationLots } from './mutation-inventory.js';
import { verifyMutationLots } from './mutation-lot-proof.js';
import { literalStrykerPattern } from './stryker-pattern.js';

export async function verifyVerdictInventory(
  root: string,
  perimeter: Perimeter,
  report: MutationReport,
  read: (file: string) => string | null,
) {
  const lots = await mutationLots(root, perimeter, undefined, read);
  const files = new Map(report.files);
  const patterns = new Map(
    lots.map(({ file }) => [
      report.gateNativeScope === undefined ? literalStrykerPattern(root, file) : file,
      file,
    ]),
  );
  const selected: MutationReport['files'] = new Map(
    lots.flatMap(({ file, mutants }) => {
      const entry = files.get(file);
      if (
        entry === undefined &&
        mutants.length === 0 &&
        report.mutate.includes(
          report.gateNativeScope === undefined ? literalStrykerPattern(root, file) : file,
        )
      ) {
        // Stryker's reporter has no file entry when there were no mutants. Keep its directives for rule 5.
        const source = read(file);
        if (source !== null) files.set(file, { source, mutants: [] });
      }
      const found = files.get(file);
      if (found === undefined) return [];
      const relevant = found.mutants.filter(
        (mutant) => perimeter.retired.includes(file) || inPerimeter(perimeter, file, mutant),
      );
      return [[file, { source: found.source, mutants: relevant }]];
    }),
  );
  let unexpected: string | undefined;
  const failure = verifyMutationLots(
    lots,
    { ...report, files: selected, mutate: report.mutate.filter((pattern) => patterns.has(pattern)) },
    (id) => {
      unexpected = 'mutant ignoré hors inventaire : ' + id;
    },
    [...patterns.keys()],
  );
  return {
    ...report,
    files,
    mutate: report.mutate.map((pattern) => patterns.get(pattern) ?? pattern),
    inventoryFailure: failure?.failure ?? unexpected,
  };
}
