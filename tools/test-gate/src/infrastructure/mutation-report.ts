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
            statusReason: z.string().optional(),
            replacement: z.string(),
            location: z.object({ start: Position, end: Position }),
            // The legacy parser tolerates absent static metadata. The hosted lot path requires it for active verdicts.
            static: z.boolean().optional(),
            killedBy: z.array(z.string()).optional(),
            coveredBy: z.array(z.string()).optional(),
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
  // The tests of the run: `test-gate replay` runs them again by `<feature>:<line>`.
  testFiles: z
    .record(
      z.string(),
      z.object({ tests: z.array(z.object({ id: z.string(), location: z.object({ start: Position }) })) }),
    )
    .optional(),
  config: z.object({ mutate: z.array(z.string()) }),
  gateNativeScope: z
    .array(
      z.strictObject({ file: z.string(), whole: z.boolean(), lines: z.array(z.number().int().positive()) }),
    )
    .optional(),
});

/** Parses reports/mutation/mutation.json into what rule 5 needs. */
export function parseMutationReport(text: string, requireStatic = false): MutationReport | ReadFailure {
  const parsed = parseJson(ReportSchema, text);
  if ('failure' in parsed) return parsed;
  const { files, config, testFiles } = parsed;
  if (
    requireStatic &&
    Object.values(files).some(({ mutants }) =>
      mutants.some(
        (mutant) =>
          mutant.static === undefined &&
          ['Killed', 'Timeout', 'RuntimeError', 'Survived'].includes(mutant.status),
      ),
    )
  )
    return { failure: 'marquage statique absent pour un mutant actif' };
  const testEntries = Object.entries(testFiles ?? {}).flatMap(([path, file]) =>
    file.tests.map(({ id, location }): [string, string] => [id, path + ':' + location.start.line]),
  );
  const tests = new Map(testEntries);
  if (tests.size !== testEntries.length) return { failure: 'identifiant de test de mutation répété' };
  const nativeScope = parsed.gateNativeScope;
  const coverage =
    nativeScope && new Map(nativeScope.map(({ file, whole, lines }) => [file, { whole, lines }]));
  if (coverage?.size !== nativeScope?.length) return { failure: 'fichier de périmètre natif répété' };
  return {
    tests,
    ...(coverage === undefined ? {} : { gateNativeScope: coverage }),
    files: new Map(
      Object.entries(files).map(([path, file]) => [
        path,
        {
          source: file.source,
          mutants: file.mutants.map((mutant) => ({
            id: mutant.id,
            mutatorName: mutant.mutatorName,
            status: mutant.status,
            ...(mutant.statusReason === undefined ? {} : { statusReason: mutant.statusReason }),
            startLine: mutant.location.start.line,
            startColumn: mutant.location.start.column,
            endLine: mutant.location.end.line,
            endColumn: mutant.location.end.column,
            replacement: mutant.replacement,
            static: mutant.static ?? false,
            killedBy: mutant.killedBy ?? [],
            coveredBy: mutant.coveredBy ?? [],
          })),
        },
      ]),
    ),
    mutate: config.mutate,
  };
}
