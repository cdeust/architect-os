import { inPerimeter, type MutationReport, type Perimeter } from '../domain/mutation.js';
import { mutationLots } from './mutation-inventory.js';
import { verifyMutationLots } from './mutation-lot-proof.js';

/**
 * The report `check` reads is a projection, written by `inventory-project` or by the hosted collector: its `mutate`
 * names files, not the patterns given to Stryker. Its files are checked against lots discovered again from the tree.
 */
export async function verifyVerdictInventory(
  root: string,
  perimeter: Perimeter,
  report: MutationReport,
  read: (file: string) => string | null,
) {
  // Each source is read once: a file kept without mutants carries the bytes its lot was discovered from.
  const sources = new Map<string, string | null>();
  const lots = await mutationLots(root, perimeter, undefined, (file) => {
    const source = read(file);
    sources.set(file, source);
    return source;
  });
  const planned = new Set(lots.map(({ file }) => file));
  const files = new Map(report.files);
  const selected: MutationReport['files'] = new Map(
    lots.flatMap(({ file, nativeMutants }) => {
      // Stryker's reporter has no entry for a file without mutants that it was given. Keep its source: rule 5 reads its
      // directives. A file the run was not given stays absent.
      const found =
        files.get(file) ??
        (nativeMutants === 0 && report.mutate.includes(file)
          ? { source: sources.get(file) as string, mutants: [] }
          : undefined);
      if (found === undefined) return [];
      files.set(file, found);
      const relevant = found.mutants.filter(
        (mutant) => perimeter.retired.includes(file) || inPerimeter(perimeter, file, mutant),
      );
      return [[file, { source: found.source, mutants: relevant }]];
    }),
  );
  let unexpected: string | undefined;
  const failure = verifyMutationLots(
    lots,
    { ...report, files: selected, mutate: report.mutate.filter((file) => planned.has(file)) },
    (id) => {
      unexpected = 'mutant ignoré hors inventaire : ' + id;
    },
  );
  return { ...report, files, inventoryFailure: failure?.failure ?? unexpected };
}
