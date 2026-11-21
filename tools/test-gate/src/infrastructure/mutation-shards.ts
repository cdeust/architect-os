import { distributeReplayFiles } from '../domain/replay-lots.js';
import type { MutationReport } from '../domain/mutation.js';
import { parseMutationReport } from './mutation-report.js';
import { verifyMutationLots, type Lot } from './mutation-lot-proof.js';
import { verifyMutationCatalog } from './mutation-catalog.js';

type RawMutant = {
  readonly id: string;
  readonly coveredBy?: readonly string[];
  readonly killedBy?: readonly string[];
};
type RawFile = { readonly source: string; readonly mutants: readonly RawMutant[] };
type RawTestFile = { readonly tests: readonly { readonly id: string }[] };
type RawReport = {
  readonly files: Readonly<Record<string, RawFile>>;
  readonly testFiles?: Readonly<Record<string, RawTestFile>>;
  readonly config: { readonly mutate: readonly string[] };
};

export function nativeShard(lots: readonly Lot[], canary: string | undefined, shard: 1 | 2): readonly Lot[] {
  const files = distributeReplayFiles(lots.filter(({ file }) => file !== canary))[shard === 1 ? 0 : 1];
  return lots.filter(({ file }) => files.has(file) || file === canary);
}

export function nativeScope(lots: readonly Lot[]) {
  return lots.map(({ file, whole, lines }) => ({ file, whole, lines }));
}

export interface NativeProof {
  readonly raw: RawReport;
  readonly report: MutationReport;
}

/** Validate the raw native report and preserve only in-lot identities and native ignores. */
export function projectNative(text: string, lots: readonly Lot[]): NativeProof {
  const report = parseMutationReport(text);
  if ('failure' in report) throw new Error(report.failure);
  const outside = new Set<string>();
  const failure = verifyMutationLots(lots, report, (_file, mutant) => outside.add(mutant.id));
  if (failure !== null) throw new Error(failure.failure);
  const raw = JSON.parse(text) as RawReport;
  const files = Object.fromEntries(
    Object.entries(raw.files).map(([name, file]) => [
      name,
      { ...file, mutants: file.mutants.filter(({ id }) => !outside.has(id)) },
    ]),
  );
  return { raw: { ...raw, files }, report };
}

/** No IDs are shared by separate Stryker invocations. Namespace mutant IDs and canonicalize test IDs by location. */
export async function combineNative(
  root: string,
  proofs: readonly NativeProof[],
  lots: readonly Lot[],
  canary: string | undefined,
) {
  const files = new Map<string, RawFile>();
  const first = proofs[0];
  if (first === undefined) throw new Error('aucun producteur de mutation');
  for (const [lane, { raw, report }] of proofs.entries()) {
    await verifyMutationCatalog(root, report.tests);
    const canonical = (ids: readonly string[] | undefined) =>
      (ids ?? []).map((id) => {
        const location = report.tests.get(id);
        if (location === undefined) throw new Error('scénario de mutant absent du catalogue : ' + id);
        return location;
      });
    for (const [name, file] of Object.entries(raw.files).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const previous = files.get(name);
      if (previous !== undefined && (name !== canary || previous.source !== file.source))
        throw new Error('fichier de mutation répété entre lots : ' + name);
      const own = file.mutants.map((m) => ({
        ...m,
        id: String(lane + 1) + '/' + m.id,
        coveredBy: canonical(m.coveredBy),
        killedBy: canonical(m.killedBy),
      }));
      files.set(name, { ...file, mutants: [...(previous?.mutants ?? []), ...own] });
    }
  }
  const testFiles = Object.fromEntries(
    Object.entries(first.raw.testFiles ?? {}).map(([name, file]) => [
      name,
      { ...file, tests: file.tests.map((test) => ({ ...test, id: first.report.tests.get(test.id) })) },
    ]),
  );
  return {
    ...first.raw,
    config: { ...first.raw.config, mutate: lots.map(({ file }) => file) },
    gateNativeScope: nativeScope(lots),
    files: Object.fromEntries(files),
    testFiles,
  };
}
