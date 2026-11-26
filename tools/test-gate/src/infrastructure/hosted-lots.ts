import { createHash } from 'node:crypto';
import { z } from 'zod';
import { lanesWorth, type LanePolicy } from '../domain/hosted-lanes.js';
import type { ReadFailure } from '../domain/violation.js';
import { parseJson } from './json.js';
import { literalStrykerPattern } from './stryker-pattern.js';
import type { Lot } from './mutation-lot-proof.js';

/** What each mutant was measured to cost on the hosted runners, by file and by fingerprint. */
export const HOSTED_COSTS = 'tools/test-gate/hosted-mutation-cost.json';
/** What a lane is worth and how many may open (domain/hosted-lanes.ts), with the runs the numbers come from. */
export const HOSTED_LANES = 'tools/test-gate/hosted-lanes.json';

export interface MutationCosts {
  readonly fallback: number;
  readonly files: Readonly<
    Record<string, { readonly fallback: number; readonly samples: Readonly<Record<string, number>> }>
  >;
}

// The schemas are built when a file is read, inside functions: a schema at module level is evaluated once, when the
// file is loaded, and the mutation run would replay the whole suite for each of its mutants.

/** Schema of tools/test-gate/hosted-mutation-cost.json: a cost is a duration, never negative. */
export function parseMutationCosts(text: string): MutationCosts | ReadFailure {
  const cost = z.number().nonnegative();
  const note = z.string().optional();
  return parseJson(
    z.strictObject({
      reference: note,
      checkout: note,
      earlierNativeReference: note,
      previousReference: note,
      unit: note,
      observations: note,
      fallback: cost,
      files: z.record(z.string(), z.strictObject({ fallback: cost, samples: z.record(z.string(), cost) })),
    }),
    text,
  );
}

/** Schema of tools/test-gate/hosted-lanes.json. GitHub Actions limits a job matrix to 256 jobs. */
export function parseLanePolicy(text: string): LanePolicy | ReadFailure {
  const said = z.string().min(1);
  const duration = z.number().int().positive();
  return parseJson(
    z.strictObject({
      description: said,
      unit: z.literal('milliseconds'),
      loadTimeMutantMs: duration,
      laneTargetMs: duration,
      maxLanes: z.number().int().min(1).max(256),
      provenance: z.strictObject({
        runs: z.array(z.string().startsWith('https://github.com/')).min(1),
        dryRun: said,
        loadTime: said,
        rule: said,
        bound: said,
      }),
    }),
    text,
  );
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

/**
 * A measured sample first. Without one, a mutant that no function body of its lot encloses is taken to run when the
 * module loads: Stryker then replays the suite for it (`static`) until a scenario fails, which the fallback of a file
 * does not say; `loadTimeMutantMs` is what such a mutant was measured to cost on average, and one that survives costs
 * a whole run of the suite. An estimate either way: it decides which lane holds the mutant, never whether the mutant
 * is judged.
 */
function estimate(lot: Lot, source: string, costs: MutationCosts, policy: LanePolicy) {
  const observed = costs.files[lot.file];
  const offsets = [0];
  let offset = 0;
  for (const line of source.split('\n')) {
    offset += line.length + 1;
    offsets.push(offset);
  }
  const index = ({ line, column }: Point) => (offsets[line - 1] as number) + column - 1;
  // The mutants that span the body of a function: nothing inside one runs when the module loads.
  const bodies = lot.mutants.filter(
    ({ mutatorName }) => mutatorName === 'BlockStatement' || mutatorName === 'ArrowFunction',
  );
  return (mutant: Mutant) => {
    if (mutant.ignored !== null) return 0;
    const fragment = source.slice(index(mutant.start), index(mutant.end));
    const key = createHash('sha256')
      .update(JSON.stringify([fragment, mutant.mutatorName, mutant.replacement]))
      .digest('hex')
      .slice(0, 16);
    const measured = observed?.samples[key];
    if (measured !== undefined) return measured;
    if (!bodies.some((body) => contains(body, mutant))) return policy.loadTimeMutantMs;
    return observed?.fallback ?? costs.fallback;
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
 * The slices of the hosted lanes, the heaviest first: as many as the estimated cost of the inventory is worth
 * (`lanesWorth`), fewer when a lane would hold no production mutant, one for an inventory that is the canary alone.
 * Every slice mutates the canary: rule 7 proves each run of the mutation tool. The same lots, sources, costs and
 * policy give the same slices: the lots come in the lexical order of their files, the sorts are stable, and nothing
 * here reads a clock or the environment.
 *
 * Each slice is an antichain of spans per file. Stryker's ranges restrict the node being mutated, while its
 * ignorer keeps ancestors traversable. If a whole selected ancestor and one of its children sat in the same
 * slice, an intermediate node could become active even though that identity belongs to another slice.
 */
export function planHostedSlices(
  lots: readonly Lot[],
  canary: string,
  read: (file: string) => string,
  costs: MutationCosts,
  policy: LanePolicy,
  root = process.cwd(),
): HostedSlice[] {
  const proof = lots.find(({ file }) => file === canary);
  if (proof === undefined) throw new Error('canari absent de l’inventaire natif');
  const costOf = (own: readonly Group[]) => own.reduce((sum, group) => sum + group.cost, 0);
  const production = lots
    .filter((lot) => lot !== proof)
    .map((lot) => ({ lot, own: groupsOf(lot, estimate(lot, read(lot.file), costs, policy)) }));
  const count = lanesWorth(
    production.reduce((sum, { own }) => sum + costOf(own), 0),
    policy,
  );
  const buckets: Bucket[] = Array.from({ length: count }, () => ({ groups: [], cost: 0, whole: [] }));
  const groups: Group[] = [];
  const lightest = (pool: readonly Bucket[]) =>
    pool.reduce((best, item) => (item.cost < best.cost ? item : best));
  for (const { lot, own } of production) {
    if (own.length === 0 || own.some(({ depth }) => depth >= count)) {
      // A file nested deeper than the lanes that open still receives its complete existing scope.
      const bucket = lightest(buckets);
      bucket.whole.push(lot);
      bucket.cost += costOf(own);
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
  // A lane that received nothing would only replay the suite for the canary another lane already proves.
  const held = buckets.filter(({ groups: assigned, whole }) => assigned.length + whole.length > 0);
  // With nothing assigned there were no production lots, so their cost was zero and lanesWorth opened one bucket.
  const open = held.length === 0 ? buckets : held;
  // Number the heaviest planned lots first. GitHub controls the order in which its runners start them.
  return open
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
