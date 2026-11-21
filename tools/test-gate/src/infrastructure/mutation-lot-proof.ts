import { createHash } from 'node:crypto';
import type { MutationReport } from '../domain/mutation.js';
import type { ReadFailure } from '../domain/violation.js';
import type { mutationLots } from './mutation-inventory.js';

export type Lot = Awaited<ReturnType<typeof mutationLots>>[number];

function identity(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  operator: string,
  replacement: string,
): string {
  return JSON.stringify([startLine, startColumn, endLine, endColumn, operator, replacement]);
}

/**
 * Verify the mutant multiset against independently discovered lots. Only ignored extra rows can be bookkeeping.
 * Source hashes and native ignore reasons are retained. Scenario selection is a separate proof.
 */
export function verifyMutationLots(
  lots: readonly Lot[],
  report: MutationReport,
  recordBookkeeping: (id: string) => void,
  patterns: readonly string[] = lots.map(({ file }) => file),
): ReadFailure | null {
  const files = new Set(lots.map(({ file }) => file));
  for (const file of report.files.keys()) {
    if (!files.has(file)) return { failure: file + ' : fichier de mutation hors inventaire' };
  }
  const configured = new Set(report.mutate);
  if (report.mutate.length !== patterns.length || patterns.some((pattern) => !configured.has(pattern)))
    return { failure: 'fichiers du rapport différents des lots prévus' };
  const ids = new Set<string>();
  for (const lot of lots) {
    const found = report.files.get(lot.file);
    if (found === undefined) {
      if (lot.nativeMutants === 0) continue;
      return { failure: lot.file + ' : lot absent du rapport de mutation' };
    }
    const sourceBytes = Buffer.from(found.source);
    if (
      sourceBytes.toString('utf8') !== found.source ||
      createHash('sha256').update(sourceBytes).digest('hex') !== lot.sourceSha256
    )
      return { failure: lot.file + ' : source du rapport différente de celle de l’inventaire' };
    const pending = new Map<string, number>();
    const selected = new Set<string>();
    for (const m of lot.mutants) {
      const span = identity(
        m.start.line,
        m.start.column,
        m.end.line,
        m.end.column,
        m.mutatorName,
        m.replacement,
      );
      selected.add(span);
      const key = JSON.stringify([span, m.ignored !== null, m.ignored]);
      pending.set(key, (pending.get(key) ?? 0) + 1);
    }
    for (const m of found.mutants) {
      if (ids.has(m.id)) return { failure: lot.file + ' : identifiant de mutant en double : ' + m.id };
      ids.add(m.id);
      const span = identity(m.startLine, m.startColumn, m.endLine, m.endColumn, m.mutatorName, m.replacement);
      const ignored = m.status === 'Ignored';
      const key = JSON.stringify([span, ignored, ignored ? m.statusReason : null]);
      const count = pending.get(key) ?? 0;
      if (count > 0) pending.set(key, count - 1);
      else if (selected.has(span))
        return { failure: lot.file + ' : mutant du lot répété ou motif d’ignorance différent : ' + m.id };
      else if (!ignored) return { failure: lot.file + ' : mutant actif hors lot : ' + m.id };
      else recordBookkeeping(m.id);
    }
    const missing = [...pending.values()].reduce((sum, count) => sum + count, 0);
    if (missing !== 0) return { failure: lot.file + ' : mutant(s) du lot absents du rapport : ' + missing };
  }
  return null;
}

/** A final aggregate has no bookkeeping rows. Every active or ignored identity must belong to the plan. */
export function requireCompleteMutationLots(lots: readonly Lot[], report: MutationReport): void {
  const mismatch = verifyMutationLots(lots, report, (id) => {
    throw new Error('mutant ignoré hors projection finale : ' + id);
  });
  if (mismatch !== null) throw new Error(mismatch.failure);
}
