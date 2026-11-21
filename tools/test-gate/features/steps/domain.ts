import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { countRule, type Count } from '../../src/domain/count.js';
import type { DebtInput, DebtRegistry } from '../../src/domain/debt.js';
import { parseUnifiedDiff, type ChangedFile } from '../../src/domain/diff.js';
import type { Layout } from '../../src/domain/layout.js';
import { mentioned, mutatedAt, rangePatterns } from '../../src/domain/mutate-pattern.js';
import {
  judgeMutation,
  perimeterOf,
  type MutantRecord,
  type MutationJudgement,
  type Perimeter,
} from '../../src/domain/mutation.js';
import { distributeReplayFiles } from '../../src/domain/replay-lots.js';
import { parseMutationReport } from '../../src/infrastructure/mutation-report.js';
import { Workspace } from '../../src/infrastructure/workspace.js';
import { FIXTURES, Given, Then, When } from './repository.js';

// Direct scenarios over the pure functions of the domain and over Workspace: each pins one observable the
// end-to-end scenarios of the gate (a git repository, a cucumber report) cannot isolate (order, boundary at 0).

const layout = JSON.parse(readFileSync(join(FIXTURES, 'gate.json'), 'utf8')) as Layout;

const list = (text: string): string[] => (text === '' ? [] : text.split(', '));

// The registry of a gate that creates it empty: rule 6 has nothing to say.
const EMPTY_DEBT: DebtInput = {
  path: 'mutation-debt.json',
  current: { survivors: [] },
  parent: null,
  present: new Set(),
  sources: new Map(),
};

When(
  'the gate counts the static pickles {string} against those {string} of the first parent {string}',
  function (now: string, parent: string, firstParent: string) {
    this.state['count'] = countRule({
      job: 'linux',
      firstParent: firstParent === 'none' ? null : firstParent,
      now: list(now),
      parent: list(parent),
      executed: 0,
      base: null,
    });
  },
);

Then('the gate count added pickles are {string}', function (expected: string) {
  assert.deepEqual((this.state['count'] as Count).added, list(expected));
});

Then('the gate count removed pickles are {string}', function (expected: string) {
  assert.deepEqual((this.state['count'] as Count).removed, list(expected));
});

Then('the gate count base source is {string}', function (expected: string) {
  assert.equal((this.state['count'] as Count).source, expected);
});

When('the gate parses the unified diff:', function (text: string) {
  this.state['parsed'] = parseUnifiedDiff(text);
});

Then('the gate parsed diff is:', function (expected: string) {
  const lines = (this.state['parsed'] as ChangedFile[]).map(
    (file) => `${file.path}${file.deleted ? ' (supprimé)' : ''}: ${file.lines.join(',')}`,
  );
  assert.deepEqual(lines, expected.split('\n'));
});

/** `src/a.mjs:1,2` -> a ChangedFile; no line after the colon is a file with no added line. */
const change = (spec: string): ChangedFile => {
  const [path, lines = ''] = spec.split(':');
  return {
    path: path as string,
    deleted: false,
    lines: lines === '' ? [] : lines.split(',').map(Number),
  };
};

When('the gate computes the perimeter of the changes {string}', function (changes: string) {
  this.state['perimeter'] = perimeterOf(layout, list(changes).map(change), []);
});

When(
  'the gate computes the perimeter of the changes {string} with the retired files {string}',
  function (changes: string, retired: string) {
    this.state['perimeter'] = perimeterOf(layout, list(changes).map(change), list(retired));
  },
);

Then('the gate perimeter changed files are {string}', function (expected: string) {
  assert.deepEqual([...(this.state['perimeter'] as Perimeter).changedLines.keys()], list(expected));
});

Then('the gate perimeter judged files are {string}', function (expected: string) {
  assert.deepEqual((this.state['perimeter'] as Perimeter).judged, list(expected));
});

Then('the gate perimeter files are {string}', function (expected: string) {
  assert.deepEqual((this.state['perimeter'] as Perimeter).files, list(expected));
});

Given(
  'a gate perimeter over {string} with changed lines {string}',
  function (files: string, changed: string) {
    const changedLines = new Map<string, ReadonlySet<number>>();
    for (const spec of list(changed)) {
      const { path, lines } = change(spec);
      changedLines.set(path, new Set(lines));
    }
    const perimeter: Perimeter = {
      changedLines,
      judged: list(files),
      files: list(files),
      retired: [],
    };
    this.state['perimeter'] = perimeter;
  },
);

interface ReportFixture {
  mutate: string[];
  files: Record<string, { source: string[]; mutants: MutantRecord[] }>;
}

When('the gate judges the mutation report:', function (text: string) {
  const fixture = JSON.parse(text) as ReportFixture;
  this.state['judgement'] = judgeMutation(
    this.state['perimeter'] as Perimeter,
    {
      mutate: fixture.mutate,
      tests: new Map(),
      files: new Map(
        Object.entries(fixture.files).map(([path, file]) => [
          path,
          { source: file.source.join('\n'), mutants: file.mutants },
        ]),
      ),
    },
    EMPTY_DEBT,
  );
});

Then('the gate judged mutants are {string}', function (expected: string) {
  const judgement = this.state['judgement'] as MutationJudgement;
  assert.deepEqual(
    judgement.mutants.map(({ mutant }) => mutant.id),
    list(expected),
  );
});

Then('the gate judgement violations are:', function (expected: string) {
  const judgement = this.state['judgement'] as MutationJudgement;
  assert.deepEqual(
    judgement.violations.map((violation) => `${violation.rule}: ${violation.text}`),
    expected.split('\n'),
  );
});

Given('a gate workspace holding the files {string}', function (files: string) {
  const root = mkdtempSync(join(tmpdir(), 'aos-workspace-'));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const file of list(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  this.state['workspace'] = new Workspace(root);
});

When('the gate workspace globs {string} excluding {string}', function (include: string, exclude: string) {
  this.state['globbed'] = (this.state['workspace'] as Workspace).glob({
    include: list(include),
    exclude: list(exclude),
  });
});

Then('the gate workspace paths are {string}', function (expected: string) {
  assert.deepEqual(this.state['globbed'], list(expected));
});

Then(
  'the range patterns of {string} for the lines {string} are {string}',
  function (file: string, lines: string, patterns: string) {
    assert.deepEqual(rangePatterns(file, new Set(list(lines).map(Number))), list(patterns));
  },
);

Then(
  'the lines {int} to {int} of {string} are mutated under {string}: {word}',
  function (start: number, end: number, file: string, mutate: string, mutated: string) {
    assert.equal(mutatedAt(list(mutate), file, start, end), mutated === 'yes');
  },
);

Then('{string} names {string}: {word}', function (mutate: string, file: string, named: string) {
  assert.equal(mentioned(list(mutate), file), named === 'yes');
});

When('the gate distributes replay files {string}', function (files: string) {
  const lots = list(files).map((entry) => {
    const [file, weight] = entry.split(':') as [string, string];
    return { file, mutants: Array.from({ length: Number(weight) }) };
  });
  this.state['replay-lots'] = distributeReplayFiles(lots).map((batch) => [...batch]);
});

Then('the first replay lot is {string} and the second is {string}', function (first: string, second: string) {
  assert.deepEqual(this.state['replay-lots'], [list(first), list(second)]);
});

When(
  'the gate judges the {string} multiline debt with native scope {string} and Git lines {string}',
  function (disposition: string, attestation: string, lines: string) {
    const file = 'src/math.mjs';
    const parent = JSON.parse(readFileSync(join(FIXTURES, 'debt/partial-line.json'), 'utf8')) as DebtRegistry;
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'mutation/partial-line.json'), 'utf8'));
    raw.files[file].mutants = [
      { ...raw.files[file].mutants.find(({ id }: { id: string }) => id === '9'), status: 'Killed' },
    ];
    raw.config.mutate = [file];
    raw.gateNativeScope =
      attestation === 'absent'
        ? []
        : [
            {
              file,
              whole: attestation === 'whole',
              lines: attestation === 'whole' ? [] : JSON.parse(attestation),
            },
          ];
    const report = parseMutationReport(JSON.stringify(raw), true);
    assert.ok(!('failure' in report), JSON.stringify(report));
    const changes = [{ path: file, deleted: false, lines: JSON.parse(lines) as number[] }];
    const retired = disposition === 'retired';
    const perimeter = perimeterOf(layout, changes, retired ? [file] : []);
    this.state['judgement'] = judgeMutation(perimeter, report, {
      ...EMPTY_DEBT,
      parent,
      current: retired ? EMPTY_DEBT.current : parent,
      present: new Set([file]),
      sources: new Map([[file, raw.files[file].source]]),
    });
  },
);

Then(
  'the gate confirms {int} detected and {int} retired debt entries without violations',
  function (detected: number, retired: number) {
    const { debt, violations } = this.state['judgement'] as MutationJudgement;
    assert.equal(debt.notSurvived, detected);
    assert.equal(debt.removed, retired);
    assert.deepEqual(violations, []);
  },
);
