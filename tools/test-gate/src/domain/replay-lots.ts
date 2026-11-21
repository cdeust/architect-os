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

export function replayLotFor(
  file: string,
  [first, second]: readonly [ReadonlySet<string>, ReadonlySet<string>],
): 1 | 2 {
  const inFirst = first.has(file);
  const inSecond = second.has(file);
  if (inFirst === inSecond)
    throw new Error(inFirst ? 'mutant à rejouer dans deux lots' : 'mutant à rejouer sans lot');
  return inFirst ? 1 : 2;
}
