import { createHash } from 'node:crypto';
import { literalStrykerPattern } from './stryker-pattern.js';
import type { Lot } from './mutation-lot-proof.js';

// The hosted run 44905674009 used about sixteen Linux runners and spent nearly an hour of runner time on 20 dry-runs.
export const HOSTED_LANES = 16;
export const HOSTED_COSTS = 'tools/test-gate/hosted-mutation-cost.json';

export interface MutationCosts {
  readonly fallback: number;
  readonly files: Readonly<
    Record<string, { readonly fallback: number; readonly samples: Readonly<Record<string, number>> }>
  >;
}

type Mutant = Lot['mutants'][number];
type Point = Mutant['start'];
type Group = {
  readonly lot: Lot;
  readonly mutants: readonly Mutant[];
  readonly cost: number;
  readonly depth: number;
};
type Bucket = { groups: Group[]; cost: number; whole: Lot[] };

export interface HostedSlice {
  readonly lots: readonly Lot[];
  readonly patterns: readonly string[];
}

const compare = (a: Point, b: Point) => a.line - b.line || a.column - b.column;
const span = (m: Mutant) => JSON.stringify([m.start.line, m.start.column, m.end.line, m.end.column]);
const contains = (outer: Mutant, inner: Mutant) =>
  compare(outer.start, inner.start) <= 0 && compare(inner.end, outer.end) <= 0;

function estimate(lot: Lot, source: string, costs: MutationCosts) {
  const observed = costs.files[lot.file];
  const offsets = [0];
  let offset = 0;
  for (const line of source.split('\n')) {
    offset += line.length + 1;
    offsets.push(offset);
  }
  const index = ({ line, column }: Point) => (offsets[line - 1] as number) + column - 1;
  return (mutant: Mutant) => {
    if (mutant.ignored !== null) return 0;
    const fragment = source.slice(index(mutant.start), index(mutant.end));
    const key = createHash('sha256')
      .update(JSON.stringify([fragment, mutant.mutatorName, mutant.replacement]))
      .digest('hex')
      .slice(0, 16);
    return observed?.samples[key] ?? observed?.fallback ?? costs.fallback;
  };
}

function groupsOf(lot: Lot, costOf: (mutant: Mutant) => number): Group[] {
  const sameSpan = new Map<string, Mutant[]>();
  for (const mutant of lot.mutants) {
    const key = span(mutant);
    const peers = sameSpan.get(key) ?? [];
    peers.push(mutant);
    sameSpan.set(key, peers);
  }
  const sorted = [...sameSpan.values()].sort(([left], [right]) => {
    const a = left as Mutant;
    const b = right as Mutant;
    return compare(a.start, b.start) || compare(b.end, a.end);
  });
  const groups: Group[] = [];
  for (const mutants of sorted) {
    const representative = mutants[0] as Mutant;
    const depth = groups.reduce(
      (level, group) =>
        contains(group.mutants[0] as Mutant, representative) ? Math.max(level, group.depth + 1) : level,
      0,
    );
    groups.push({ lot, mutants, depth, cost: mutants.reduce((sum, m) => sum + costOf(m), 0) });
  }
  return groups;
}

function range(file: string, { start, end }: Mutant): string {
  // Stryker's config takes one-based lines and zero-based columns.
  return `${file}:${start.line}:${start.column - 1}-${end.line}:${end.column - 1}`;
}

/**
 * Each slice is an antichain of spans per file. Stryker's ranges restrict the node being mutated, while its
 * ignorer keeps ancestors traversable. If a whole selected ancestor and one of its children sat in the same
 * slice, an intermediate node could become active even though that identity belongs to another slice.
 */
export function planHostedSlices(
  lots: readonly Lot[],
  canary: string,
  read: (file: string) => string,
  costs: MutationCosts,
  count = HOSTED_LANES,
  root = process.cwd(),
): HostedSlice[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('nombre de lots natifs invalide');
  const proof = lots.find(({ file }) => file === canary);
  if (proof === undefined) throw new Error('canari absent de l’inventaire natif');
  const buckets: Bucket[] = Array.from({ length: count }, () => ({ groups: [], cost: 0, whole: [] }));
  const groups: Group[] = [];
  const lightest = (pool: readonly Bucket[]) =>
    pool.reduce((best, item) => (item.cost < best.cost ? item : best));
  for (const lot of lots) {
    if (lot === proof) continue;
    const costOf = estimate(lot, read(lot.file), costs);
    const own = groupsOf(lot, costOf);
    if (own.length === 0 || own.some(({ depth }) => depth >= count)) {
      // A deep future syntax tree still receives its complete existing scope.
      const bucket = lightest(buckets);
      bucket.whole.push(lot);
      bucket.cost += own.reduce((sum, group) => sum + group.cost, 0);
    } else groups.push(...own);
  }
  for (const group of groups.sort((a, b) => a.depth - b.depth || b.cost - a.cost)) {
    const eligible = buckets.filter(({ groups: assigned }) =>
      assigned.every(
        (other) =>
          other.lot !== group.lot || !contains(other.mutants[0] as Mutant, group.mutants[0] as Mutant),
      ),
    );
    const bucket = lightest(eligible);
    bucket.groups.push(group);
    bucket.cost += group.cost;
  }
  // Number the heaviest planned lots first. GitHub controls the order in which its runners start them.
  return buckets
    .sort((a, b) => b.cost - a.cost)
    .map(({ groups: assigned, whole }) => {
      const scoped = new Map<Lot, Mutant[]>();
      for (const group of assigned) {
        const seen = scoped.get(group.lot) ?? [];
        seen.push(...group.mutants);
        scoped.set(group.lot, seen);
      }
      return {
        lots: [...whole, proof, ...[...scoped].map(([lot, mutants]) => ({ ...lot, whole: false, mutants }))],
        patterns: [...whole, proof]
          .map(({ file }) => literalStrykerPattern(root, file))
          .concat(
            assigned.map(({ lot, mutants }) =>
              range(literalStrykerPattern(root, lot.file), mutants[0] as Mutant),
            ),
          ),
      };
    });
}
