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
import { mentioned, rangePatterns } from './mutate-pattern.js';
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
  /** The files of the entries the registry lost: mutated whole, so that rule 6 sees every mutant of them. */
  readonly retired: readonly string[];
}

/**
 * The `mutate` patterns of a run: the changed lines of each judged file as ranges, so that a change mutates its own
 * code only, and `whole` (the files of retired debt entries, the canary) whole. Sorted, distinct.
 */
export function mutatePatterns(perimeter: Perimeter, whole: readonly string[]): string[] {
  const entire = new Set([...perimeter.retired, ...whole]);
  const ranges = [...perimeter.changedLines]
    .filter(([file]) => !entire.has(file))
    .flatMap(([file, lines]) => rangePatterns(file, lines));
  return [...new Set([...entire, ...ranges])].sort();
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
  return { changedLines, judged, files: [...new Set([...judged, ...retired])].sort(), retired };
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
  /** Module-level code: Stryker runs every test against it, whatever `coveredBy` says. */
  readonly static: boolean;
  /** Test ids (keys of MutationReport.tests). */
  readonly killedBy: readonly string[];
  readonly coveredBy: readonly string[];
}

export interface MutationReport {
  readonly files: ReadonlyMap<string, { readonly source: string; readonly mutants: readonly MutantRecord[] }>;
  /** config.mutate of the run: a file listed there but absent from `files` was mutated and had no mutant. */
  readonly mutate: readonly string[];
  /** Every test of the run, by id: `<feature>:<line>`. */
  readonly tests: ReadonlyMap<string, string>;
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
/** A mutant the tool could not compile has no verdict. RuntimeError is a detection the replay decides (rule 7). */
const INVALID = new Set(['CompileError']);
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

/** A mutant of a judged file whose location meets one of its changed lines. */
export function inPerimeter(perimeter: Perimeter, file: string, mutant: MutantRecord): boolean {
  const changed = perimeter.changedLines.get(file);
  return changed !== undefined && [...changed].some((n) => n >= mutant.startLine && n <= mutant.endLine);
}

export function label(file: string, mutant: MutantRecord): string {
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
      if (!mentioned(report.mutate, file))
        add(`${file} : fichier du périmètre absent du rapport de mutation`);
      continue;
    }
    const lines = result.source.split('\n');
    lines.forEach((line, index) => {
      if (DIRECTIVE_COMMENT.test(line) && justifiedMutators(line) === null) {
        add(`${file}:${index + 1} : directive Stryker refusée : ${line.trim()}`);
      }
    });
    for (const mutant of result.mutants) {
      if (!inPerimeter(perimeter, file, mutant)) continue;
      mutants.push({ file, mutant });
      const justification = justifiedMutators(String(lines[mutant.startLine - 2]));
      if (RED.has(mutant.status)) {
        if (DEBT.has(mutant.status) && known.has(debtIdentity(entryOf(file, mutant, result.source))))
          accepted++;
        else add(`${label(file, mutant)} : ${mutant.status}`);
      }
      // A mutant the tool could not evaluate has no verdict: the gate cannot conclude on its line.
      if (INVALID.has(mutant.status)) {
        invalid.push(`${label(file, mutant)} : ${mutant.status}`);
        add(`${label(file, mutant)} : ${mutant.status}, mutant sans verdict`);
      }
      if (mutant.status === 'Ignored' && justification?.includes(mutant.mutatorName) !== true) {
        add(`${label(file, mutant)} : Ignored sans justification « équivalent » sur la ligne précédente`);
      }
    }
  }
  const judgedDebt = judgeDebt(debt, report, accepted);
  violations.push(...judgedDebt.violations);
  return { perimeter, mutants, invalid, debt: judgedDebt.summary, violations };
}
