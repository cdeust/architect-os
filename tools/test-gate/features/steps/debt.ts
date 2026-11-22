import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../../src/infrastructure/git.js';
import type { DataTable } from '@cucumber/cucumber';
import { DEBT_PATH, FIXTURES, Given, Then, repository, type GateRepository } from './repository.js';

// Steps of debt.feature: the mutation debt registry of a disposable repository (fixtures/debt/), the code that
// moves in the mutation report, and the text the report prints of the debt.

const MUTATION = 'reports/mutation/mutation.json';
const REPORT = 'reports/gate-report.md';

interface Entry {
  start: { line: number; column: number };
  end: { line: number; column: number };
  [field: string]: unknown;
}

interface MutationFixture {
  files: Record<string, { source: string; mutants: { location: Entry }[] }>;
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** `end.column` of an entry, set to a JSON value. */
function setField(entry: Record<string, unknown>, field: string, value: unknown): void {
  const path = field.split('.');
  const last = path.pop() as string;
  const holder = path.reduce<Record<string, unknown>>(
    (found, key) => found[key] as Record<string, unknown>,
    entry,
  );
  assert.ok(last in holder, `the entry has no field ${field}`);
  holder[last] = value;
}

/** A number in the step is a number of the entry, anything else is text. */
function jsonOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function lines(repo: GateRepository, rule: number): string[] {
  const section = repo.read(REPORT);
  const found: string[] = [];
  let current = '';
  for (const line of section
    .slice(section.indexOf('## Violations'), section.indexOf('## Mutation'))
    .split('\n')) {
    const title = /^### Règle (\d)/.exec(line);
    if (title !== null) current = title[1] ?? '';
    else if (current === String(rule) && line.startsWith('- ') && line !== '- aucune')
      found.push(line.slice(2));
  }
  return found;
}

Given('the gate debt registry is the fixture {string}', function (name: string) {
  repository(this).write(DEBT_PATH, fixture(`debt/${name}.json`));
});

Given(
  'the gate debt registry is the fixture {string} with {string} of its entry {int} set to {string}',
  function (name: string, field: string, index: number, value: string) {
    const registry = JSON.parse(fixture(`debt/${name}.json`)) as { survivors: Record<string, unknown>[] };
    const entry = registry.survivors[index - 1];
    assert.ok(entry !== undefined, `the fixture ${name} has no entry ${index}`);
    setField(entry, field, jsonOrText(value));
    repository(this).write(DEBT_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  },
);

Given('the gate debt registry reads:', function (text: string) {
  repository(this).write(DEBT_PATH, `${text}\n`);
});

Given('the gate debt registry is absent', function () {
  repository(this).remove(DEBT_PATH);
});

Given(
  'the code of {string} moves down by one line from line {int} in the gate mutation report and in the working tree',
  function (path: string, line: number) {
    const repo = repository(this);
    const report = JSON.parse(repo.read(MUTATION)) as MutationFixture;
    const file = report.files[path];
    assert.ok(file !== undefined, `${path} is not in the mutation report`);
    const source = file.source.split('\n');
    source.splice(line - 1, 0, '// inserted');
    file.source = source.join('\n');
    for (const { location } of file.mutants) {
      for (const position of [location.start, location.end]) {
        if (position.line >= line) position.line += 1;
      }
    }
    repo.write(MUTATION, JSON.stringify(report));
    repo.write(path, file.source);
  },
);

Then('the gate debt section reads:', function (text: string) {
  const repo = repository(this);
  const report = repo.read(REPORT);
  const section = report.slice(report.indexOf('## Dette de mutation'), report.indexOf('## Violations'));
  assert.equal(section, `${repo.tokens(text)}\n\n`);
});

Then('the gate report has no debt section', function () {
  const report = repository(this).read(REPORT);
  assert.equal(report.includes('## Dette de mutation'), false);
  // Nothing else sits between the removed pickles and the violations.
  assert.match(report, /\n\n## Violations\n/);
});

Then('the gate violations of rule {int} start with {string}', function (rule: number, prefix: string) {
  const found = lines(repository(this), rule);
  assert.equal(found.length, 1, found.join('\n'));
  const [violation = ''] = found;
  assert.ok(violation.startsWith(prefix), violation);
});

Then('the gate repository file {string} is the fixture {string}', function (path: string, name: string) {
  assert.equal(repository(this).read(path), fixture(name));
});

Then('the gate repository file {string} now reads:', function (path: string, text: string) {
  assert.equal(repository(this).read(path), `${text}\n`);
});

Then('the gate repository holds no file {string}', function (path: string) {
  assert.equal(repository(this).exists(path), false);
});

// A registry written as a table: one row per entry, positions as `line:column`, `\n` in a cell is a newline.
const COLUMNS = ['file', 'start', 'end', 'mutator', 'original', 'replacement'];

function position(text: string): { line: number; column: number } {
  const [line, column] = text.split(':').map(Number);
  return { line: line as number, column: column as number };
}

Given('the gate debt registry holds these entries:', function (table: DataTable) {
  const survivors = table.hashes().map((row) => ({
    file: row['file'],
    start: position(row['start'] as string),
    end: position(row['end'] as string),
    mutator: row['mutator'],
    original: row['original'],
    replacement: row['replacement'],
  }));
  repository(this).write(DEBT_PATH, `${JSON.stringify({ survivors }, null, 2)}\n`);
});

Then('the gate debt registry now holds these entries:', function (table: DataTable) {
  const { survivors } = JSON.parse(repository(this).read(DEBT_PATH)) as {
    survivors: { start: Entry['start']; end: Entry['end']; [field: string]: unknown }[];
  };
  const rows = survivors.map((entry) => [
    entry['file'],
    `${entry.start.line}:${entry.start.column}`,
    `${entry.end.line}:${entry.end.column}`,
    entry['mutator'],
    entry['original'],
    entry['replacement'],
  ]);
  assert.deepEqual(rows, table.raw().slice(1));
  assert.deepEqual(table.raw()[0], COLUMNS);
});

Given('the projected native report has no mutants on the changed line', function () {
  const repo = repository(this);
  const filename = 'reports/mutation/mutation.json';
  const report = JSON.parse(repo.read(filename));
  report.gateNativeScope = [{ file: 'src/math.mjs', whole: false, lines: [1] }];
  report.files['src/math.mjs'].mutants = [];
  repo.write(filename, JSON.stringify(report));
});

Given('the debt registry is unreadable in the {string}', function (revision: string) {
  const repo = repository(this);
  if (revision === 'working tree') {
    repo.remove(DEBT_PATH);
  } else {
    assert.equal(revision, 'first parent');
    repo.write(DEBT_PATH, '{"survivors":[],"extra":true}');
    repo.commit('invalid debt at the first parent');
    repo.write(DEBT_PATH, '{"survivors":[]}');
    repo.commit('valid current debt');
  }
});

Then('the gate repository holds a file {string}', function (file: string) {
  assert.equal(repository(this).exists(file), true);
});

Given('a different debt registry is staged without touching the working copy', function () {
  const repo = repository(this);
  const current = repo.read(DEBT_PATH);
  repo.write(DEBT_PATH, '{"survivors":[]}\n');
  git(repo.dir, ['add', '--', DEBT_PATH]);
  repo.write(DEBT_PATH, current);
});

Then('both comparison reports match the tracked debt registry', function () {
  const repo = repository(this);
  assert.equal(repo.read('reports/mutation-debt.committed.json'), repo.read(DEBT_PATH));
  assert.equal(repo.read('reports/mutation-debt.computed.json'), repo.read(DEBT_PATH));
});
Then('the committed comparison report matches the untouched tracked debt registry', function () {
  const repo = repository(this);
  const committed = git(repo.dir, ['show', 'HEAD:' + DEBT_PATH]);
  assert.equal(repo.read(DEBT_PATH), committed);
  assert.equal(repo.read('reports/mutation-debt.committed.json'), committed);
});
