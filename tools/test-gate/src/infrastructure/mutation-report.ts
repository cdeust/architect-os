import type { MutantStatus } from 'mutation-testing-report-schema';
import { z } from 'zod';
import type { MutationReport } from '../domain/mutation.js';
import type { ReadFailure } from '../domain/violation.js';
import { parseJson } from './json.js';

// The fields the gate reads of a Stryker JSON report: MutationTestResult, FileResult, MutantResult, and Location in node_modules/mutation-testing-report-schema/dist/src-generated/schema.d.ts. Other fields are ignored.
const STATUSES = [
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
] as const satisfies readonly MutantStatus[];

const Position = z.object({ line: z.number().int().positive(), column: z.number().int() });

const ReportSchema = z.object({
  files: z.record(
    z.string(),
    z
      .object({
        source: z.string(),
        mutants: z.array(
          z.object({
            id: z.string(),
            mutatorName: z.string(),
            status: z.enum(STATUSES),
            replacement: z.string(),
            location: z.object({ start: Position, end: Position }),
          }),
        ),
      })
      // The debt reads the text between start and end: both lines are in the source.
      .refine(
        ({ source, mutants }) => {
          const last = source.split('\n').length;
          return mutants.every(({ location }) => location.start.line <= last && location.end.line <= last);
        },
        { error: 'un mutant sort du texte de son fichier' },
      ),
  ),
  config: z.object({ mutate: z.array(z.string()) }),
});

/** Parses reports/mutation/mutation.json into what rule 5 needs. */
export function parseMutationReport(text: string): MutationReport | ReadFailure {
  const parsed = parseJson(ReportSchema, text);
  if ('failure' in parsed) return parsed;
  const { files, config } = parsed;
  return {
    files: new Map(
      Object.entries(files).map(([path, file]) => [
        path,
        {
          source: file.source,
          mutants: file.mutants.map((mutant) => ({
            id: mutant.id,
            mutatorName: mutant.mutatorName,
            status: mutant.status,
            startLine: mutant.location.start.line,
            startColumn: mutant.location.start.column,
            endLine: mutant.location.end.line,
            endColumn: mutant.location.end.column,
            replacement: mutant.replacement,
          })),
        },
      ]),
    ),
    mutate: config.mutate,
  };
}
