// Candidate defects for baseline/tasks.json: `node --import tsx baseline/find-defects.ts <dir> <sources> -- <check>`.
// For each source file (comma-separated, relative to <dir>), tries one-token mutations of its lines (a comparison,
// a boolean operator, a constant), each alone, and runs <check> in <dir>. Prints, as JSON lines, the mutations that
// make <check> fail while it passes on the original: a defect is a candidate when it breaks a few tests, not the
// module's import. The file is written back after each try. A human picks the tasks among the candidates.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, sources, separator, ...check] = process.argv.slice(2);
if (dir === undefined || sources === undefined || separator !== '--' || check.length === 0) {
  process.stderr.write('usage: find-defects <dir> <source,source> -- <check command>\n');
  process.exit(2);
}
const perFile = Number(process.env['DEFECTS_PER_FILE'] ?? '40');

/** Token swaps: each one a plausible slip, never a syntax change. */
const SWAPS: readonly (readonly [string, string])[] = [
  [' == ', ' != '],
  [' != ', ' == '],
  [' === ', ' !== '],
  [' !== ', ' === '],
  [' < ', ' <= '],
  [' <= ', ' < '],
  [' > ', ' >= '],
  [' >= ', ' > '],
  [' and ', ' or '],
  [' or ', ' and '],
  [' && ', ' || '],
  [' || ', ' && '],
  [' + 1', ' + 2'],
  [' - 1', ' - 2'],
  ['return True', 'return False'],
  ['return False', 'return True'],
  ['return true', 'return false'],
  ['return false', 'return true'],
  [' not in ', ' in '],
  ['.startswith(', '.endswith('],
  ['.startsWith(', '.endsWith('],
];

const COMMENT = /^\s*(#|\/\/|\*|\/\*|"""|''')/;

function run(): { ok: boolean; output: string } {
  const result = spawnSync(check[0] as string, check.slice(1), {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { ok: result.status === 0, output: `${result.stdout}\n${result.stderr}` };
}

/** Failing test names in pytest (`FAILED a::b`) or vitest (`× name`) output. */
function failing(output: string): string[] {
  const names = new Set<string>();
  for (const line of output.split('\n')) {
    const pytest = /^FAILED (\S+)/.exec(line);
    const vitest = /^\s+×\s+(.+?)(\s+\d+ms)?$/.exec(line);
    if (pytest !== null) names.add(pytest[1] as string);
    else if (vitest !== null) names.add((vitest[1] as string).trim());
  }
  return [...names];
}

if (!run().ok) {
  process.stderr.write('the check fails on the original: no candidate is meaningful\n');
  process.exit(1);
}
for (const source of sources.split(',')) {
  const file = join(dir, source);
  const original = readFileSync(file, 'utf8');
  const lines = original.split('\n');
  let tried = 0;
  for (const [index, line] of lines.entries()) {
    if (COMMENT.test(line)) continue;
    for (const [from, to] of SWAPS) {
      if (tried >= perFile || !line.includes(from)) continue;
      tried++;
      const mutated = line.replace(from, to);
      writeFileSync(file, [...lines.slice(0, index), mutated, ...lines.slice(index + 1)].join('\n'));
      try {
        const { ok, output } = run();
        const names = failing(output);
        if (!ok && names.length > 0 && names.length <= 5) {
          process.stdout.write(
            `${JSON.stringify({ file: source, line: index + 1, from: line, to: mutated, failing: names })}\n`,
          );
        }
      } finally {
        writeFileSync(file, original);
      }
    }
  }
}
