import { label, type MutantRecord, type MutationReport } from './mutation.js';
import type { Violation } from './violation.js';

type FileResult = NonNullable<ReturnType<MutationReport['files']['get']>>;

// Rule 7, first half: before the gate reads a verdict of the mutation tool on the code, the tool proves it on a module
// whose answer is known (gate.json `canary`): every mutant of a function the scenarios assert is Killed, of one they run
// without asserting is Survived, of one they never reach is NoCoverage. One wrong status and the run of the tool is
// not read: its report on the code is no evidence.

/** gate.json `canary`: the module, and the status every mutant of each of its exported functions must get. */
export interface Canary {
  readonly file: string;
  readonly functions: Readonly<Record<string, string>>;
}

/**
 * The span of a function: the BlockStatement mutant of its body, on the line that reads `export function <name>(`.
 * Every mutant of the function lies inside it. null when the line or the block is absent.
 */
function spanOf(result: FileResult, name: string): MutantRecord | null {
  const line = result.source.split('\n').findIndex((text) => text.startsWith(`export function ${name}(`)) + 1;
  return result.mutants.find((m) => m.mutatorName === 'BlockStatement' && m.startLine === line) ?? null;
}

/** By lines: no two functions of the canary share one. */
function inside(span: MutantRecord, mutant: MutantRecord): boolean {
  return mutant.startLine >= span.startLine && mutant.endLine <= span.endLine;
}

export function canaryViolations(canary: Canary, report: MutationReport): Violation[] {
  const add = (text: string): Violation => ({ rule: 7, text });
  const result = report.files.get(canary.file);
  if (result === undefined) return [add(`canari ${canary.file} absent du rapport de mutation`)];
  const violations: Violation[] = [];
  const placed = new Set<string>();
  for (const [name, status] of Object.entries(canary.functions)) {
    const span = spanOf(result, name);
    if (span === null) {
      violations.push(add(`canari ${canary.file} : fonction ${name} sans bloc muté`));
      continue;
    }
    for (const mutant of result.mutants.filter((m) => inside(span, m))) {
      placed.add(mutant.id);
      if (mutant.status !== status) {
        violations.push(
          add(`canari ${label(canary.file, mutant)} : ${mutant.status}, ${status} attendu (${name})`),
        );
      }
    }
  }
  for (const mutant of result.mutants) {
    if (!placed.has(mutant.id))
      violations.push(add(`canari ${label(canary.file, mutant)} : hors des fonctions déclarées`));
  }
  return violations;
}
