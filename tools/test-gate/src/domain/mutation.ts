import {
  acceptedIdentities,
  debtIdentity,
  entryOf,
  judgeDebt,
  type DebtInput,
  type DebtSummary,
} from './debt.js';
import type { ChangedFile } from './diff.js';
import { isProduction, type Layout } from './layout.js';
import type { ReadFailure, Violation } from './violation.js';

export interface Perimeter {
  /** Production files with changed lines, and those lines. */
  readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
  /** Files rule 5 judges: those of `changedLines`. */
  readonly judged: readonly string[];
  /**
   * Files Stryker must mutate (`--mutate`): `judged`, plus the files of the entries the mutation debt registry lost,
   * so that rule 6 can prove their removal. Only rule 6 reads the mutants of the latter.
   */
  readonly files: readonly string[];
}

/**
 * The perimeter of rule 5 from the diff against the first parent; `retired` are the production files of the entries
 * removed from the mutation debt registry. A changed test extends nothing: what it stops killing is seen by the full
 * run (.github/workflows/mutation-full.yml), which is off the path of a change.
 */
export function perimeterOf(
  layout: Layout,
  changes: readonly ChangedFile[],
  retired: readonly string[],
): Perimeter {
  const changedLines = new Map<string, ReadonlySet<number>>();
  for (const change of changes) {
    if (isProduction(layout, change.path) && change.lines.length > 0) {
      changedLines.set(change.path, new Set(change.lines));
    }
  }
  const judged = [...changedLines.keys()].sort();
  return { changedLines, judged, files: [...new Set([...judged, ...retired])].sort() };
}

/** What the gate keeps of a Stryker JSON report (mutation-testing-report-schema). */
export interface MutantRecord {
  readonly id: string;
  readonly mutatorName: string;
  readonly status: string;
  readonly startLine: number;
  /** Column of the start, from one. */
  readonly startColumn: number;
  readonly endLine: number;
  /** Column of the end, from one, exclusive. */
  readonly endColumn: number;
  /** The code of the mutant. */
  readonly replacement: string;
}

export interface MutationReport {
  readonly files: ReadonlyMap<string, { readonly source: string; readonly mutants: readonly MutantRecord[] }>;
  /** config.mutate of the run: a file listed there but absent from `files` was mutated and had no mutant. */
  readonly mutate: readonly string[];
}

export interface JudgedMutant {
  readonly file: string;
  readonly mutant: MutantRecord;
}

export interface MutationJudgement {
  readonly perimeter: Perimeter;
  readonly mutants: readonly JudgedMutant[];
  readonly invalid: readonly string[];
  /** Rule 6 on the mutation debt registry. */
  readonly debt: DebtSummary;
  readonly violations: readonly Violation[];
}

const RED = new Set(['Survived', 'NoCoverage', 'Pending']);
/** The red statuses the mutation debt registry can accept; Pending is always red. */
const DEBT = new Set(['Survived', 'NoCoverage']);
const INVALID = new Set(['CompileError', 'RuntimeError']);
const DIRECTIVE = 'Stryker disable';
const NEXT_LINE = `// ${DIRECTIVE} next-line `;
const EQUIVALENT = ': équivalent: ';
/** A comment that starts a Stryker directive (Stryker reads `//` and block comments alike). */
const DIRECTIVE_COMMENT = /\/[/*]\s*Stryker\s+disable/;

/**
 * The mutators a well-formed justification names, or null when the line is not one. The invariant after the
 * separator cannot be empty: the line is trimmed and the separator ends with a space.
 */
export function justifiedMutators(line: string): readonly string[] | null {
  const text = line.trim();
  const at = text.indexOf(EQUIVALENT);
  if (!text.startsWith(NEXT_LINE) || at <= NEXT_LINE.length) return null;
  return text.slice(NEXT_LINE.length, at).split(',');
}

function label(file: string, mutant: MutantRecord): string {
  return `${file}:${mutant.startLine} ${mutant.mutatorName} #${mutant.id}`;
}

/**
 * Rule 5 on one report: statuses in the perimeter, form of every Stryker directive in its files. A Survived or
 * NoCoverage mutant of the mutation debt registry is accepted. Then rule 6 on that registry.
 */
export function judgeMutation(
  perimeter: Perimeter,
  report: MutationReport | ReadFailure,
  debt: DebtInput,
): MutationJudgement {
  const violations: Violation[] = [];
  const add = (text: string) => violations.push({ rule: 5, text });
  const mutants: JudgedMutant[] = [];
  const invalid: string[] = [];
  if ('failure' in report) {
    // `files`, not `judged`: a removal from the debt registry is proved by the report alone.
    if (perimeter.files.length > 0) add(`rapport de mutation illisible : ${report.failure}`);
    const unread = judgeDebt(debt, report, 0);
    violations.push(...unread.violations);
    return { perimeter, mutants, invalid, debt: unread.summary, violations };
  }
  const known = acceptedIdentities(debt);
  let accepted = 0;
  for (const file of perimeter.judged) {
    const result = report.files.get(file);
    if (result === undefined) {
      if (!report.mutate.includes(file)) add(`${file} : fichier du périmètre absent du rapport de mutation`);
      continue;
    }
    const lines = result.source.split('\n');
    lines.forEach((line, index) => {
      if (DIRECTIVE_COMMENT.test(line) && justifiedMutators(line) === null) {
        add(`${file}:${index + 1} : directive Stryker refusée : ${line.trim()}`);
      }
    });
    for (const mutant of result.mutants) {
      const changed = perimeter.changedLines.get(file);
      const byLine =
        changed !== undefined && [...changed].some((n) => n >= mutant.startLine && n <= mutant.endLine);
      if (!byLine) continue;
      mutants.push({ file, mutant });
      const justification = justifiedMutators(String(lines[mutant.startLine - 2]));
      if (RED.has(mutant.status)) {
        if (DEBT.has(mutant.status) && known.has(debtIdentity(entryOf(file, mutant, result.source))))
          accepted++;
        else add(`${label(file, mutant)} : ${mutant.status}`);
      }
      if (INVALID.has(mutant.status)) invalid.push(`${label(file, mutant)} : ${mutant.status}`);
      if (mutant.status === 'Ignored' && justification?.includes(mutant.mutatorName) !== true) {
        add(`${label(file, mutant)} : Ignored sans justification « équivalent » sur la ligne précédente`);
      }
    }
  }
  const judgedDebt = judgeDebt(debt, report, accepted);
  violations.push(...judgedDebt.violations);
  return { perimeter, mutants, invalid, debt: judgedDebt.summary, violations };
}
