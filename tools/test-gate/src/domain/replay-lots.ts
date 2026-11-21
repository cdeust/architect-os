/** The native inventory supplies unique paths in lexical order. A stable sort preserves ties. */
export function distributeReplayFiles<T extends { file: string; mutants: readonly unknown[] }>(
  lots: readonly T[],
) {
  const batches = [new Set<string>(), new Set<string>()] as const;
  const totals: [number, number] = [0, 0];
  const sorted = lots.toSorted((a, b) => b.mutants.length - a.mutants.length);
  for (const lot of sorted) {
    const slot = totals[0] <= totals[1] ? 0 : 1;
    batches[slot].add(lot.file);
    totals[slot] += lot.mutants.length;
  }
  return batches;
}
