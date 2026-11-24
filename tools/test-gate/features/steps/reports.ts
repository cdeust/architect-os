import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnvelope, TestStepResultStatus } from '@cucumber/messages';
import { parseCucumberReport, parseCucumberShards } from '../../src/infrastructure/cucumber-report.js';
import {
  parseMutationReport,
  requireNativeMutationReport,
} from '../../src/infrastructure/mutation-report.js';
import { FIXTURES, Given, Then, repository, type GateRepository } from './repository.js';

const CUCUMBER = 'reports/cucumber.ndjson';
const MUTATION = 'reports/mutation/mutation.json';
const BASE = 'reports/base/gate-base.json';
const REPORT = 'reports/gate-report.md';

interface MutationFixture {
  files: Record<
    string,
    {
      source: string;
      mutants: { id: string; status: string; location: Record<'start' | 'end', { line: number }> }[];
    }
  >;
}

function mutationReport(repo: GateRepository): MutationFixture {
  return JSON.parse(repo.read(MUTATION)) as MutationFixture;
}

function fixtureSource(fixture: string, path: string): string {
  const report = JSON.parse(
    readFileSync(join(FIXTURES, 'mutation', `${fixture}.json`), 'utf8'),
  ) as MutationFixture;
  const file = report.files[path];
  assert.ok(file !== undefined, `${path} is not in the mutation fixture ${fixture}`);
  return file.source;
}

function replaceLine(text: string, line: number, content: string): string {
  const lines = text.split('\n');
  assert.ok(line >= 1 && line <= lines.length, `line ${line} is outside the file`);
  lines[line - 1] = content;
  return lines.join('\n');
}

/** Lines under `## Violations`, as `<rule>: <text>`. */
function violations(report: string): string[] {
  const section = report.slice(report.indexOf('## Violations'), report.indexOf('## Mutation'));
  const found: string[] = [];
  let rule = '';
  for (const line of section.split('\n')) {
    const title = /^### Règle (\d)/.exec(line);
    if (title !== null) rule = title[1] ?? '';
    else if (line.startsWith('- ') && line !== '- aucune') found.push(`${rule}: ${line.slice(2)}`);
  }
  return found;
}

function expectedLines(repo: GateRepository, text: string): string[] {
  return repo
    .tokens(text)
    .split('\n')
    .filter((line) => line !== '');
}

Given(
  'the two Cucumber reports from fixture {string} are {string}',
  function (fixture: string, mode: string) {
    const repo = repository(this);
    const text = readFileSync(join(FIXTURES, 'reports', fixture + '.ndjson'), 'utf8');
    const envelopes = text.trimEnd().split('\n').map(parseEnvelope);
    const starts = envelopes.flatMap(({ testCaseStarted }) => (testCaseStarted ? [testCaseStarted.id] : []));
    assert(starts.length > 1);
    for (const shard of [0, 1]) {
      if (shard === 1 && mode === 'missing') continue;
      const partition = shard === 1 && mode === 'duplicate' ? 0 : shard;
      const ids = new Set(starts.filter((_, index) => index % 2 === partition));
      const rows = envelopes.filter(
        ({ testCaseStarted, testCaseFinished, testStepStarted, testStepFinished }) => {
          const id =
            testCaseStarted?.id ??
            testCaseFinished?.testCaseStartedId ??
            testStepStarted?.testCaseStartedId ??
            testStepFinished?.testCaseStartedId;
          return id === undefined || ids.has(id);
        },
      );
      const terminal = rows.at(-1)?.testRunFinished;
      assert(terminal);
      if (shard === 1) {
        const started = rows.findIndex((row) => row.testRunStarted !== undefined);
        assert(started >= 0);
        switch (mode) {
          case 'incomplete':
            rows.pop();
            break;
          case 'foreign terminal':
            rows[rows.length - 1] = { testRunFinished: { ...terminal, testRunStartedId: 'foreign' } };
            break;
          case 'empty':
            rows.length = 0;
            break;
          case 'no run start':
            rows.splice(started, 1);
            break;
          case 'duplicate run start':
            rows.splice(started, 0, rows[started] as (typeof rows)[number]);
            break;
          case 'duplicate run finish':
            rows.push({ testRunFinished: terminal });
            break;
          case 'nonterminal finish': {
            const source = rows.find((row) => row.source !== undefined)?.source;
            assert(source);
            rows.push({ source });
            break;
          }
          case 'failed run hook': {
            const finished = rows.find((row) => row.testRunHookFinished !== undefined)?.testRunHookFinished;
            assert(finished);
            const index = rows.findIndex((row) => row.testRunHookFinished === finished);
            rows[index] = {
              testRunHookFinished: {
                ...finished,
                result: { ...finished.result, status: TestStepResultStatus.FAILED },
              },
            };
            break;
          }
        }
      }
      repo.write(
        'reports/cucumber-shards/' + (shard + 1) + '/cucumber.ndjson',
        rows.map((row) => JSON.stringify(row)).join('\n'),
      );
    }
  },
);

Given('the gate cucumber report is the fixture {string}', function (name: string) {
  repository(this).write(CUCUMBER, readFileSync(join(FIXTURES, 'reports', `${name}.ndjson`), 'utf8'));
});

Given(
  'the gate cucumber report is the fixture {string} with a line of spaces between its envelopes',
  function (name: string) {
    const text = readFileSync(join(FIXTURES, 'reports', `${name}.ndjson`), 'utf8');
    repository(this).write(CUCUMBER, text.split('\n').join('\n   \n'));
  },
);

Given('the gate cucumber report reads:', function (text: string) {
  repository(this).write(CUCUMBER, text);
});

Given('the gate mutation report is the fixture {string}', function (name: string) {
  repository(this).write(MUTATION, readFileSync(join(FIXTURES, 'mutation', `${name}.json`), 'utf8'));
});

Given('the gate mutation report reads:', function (text: string) {
  repository(this).write(MUTATION, text);
});

Given(
  'mutant {string} of the gate mutation report has the status {string}',
  function (id: string, status: string) {
    const repo = repository(this);
    const report = mutationReport(repo);
    const mutant = Object.values(report.files)
      .flatMap((file) => file.mutants)
      .find((candidate) => candidate.id === id);
    assert.ok(mutant !== undefined, `no mutant ${id}`);
    mutant.status = status;
    repo.write(MUTATION, JSON.stringify(report));
  },
);

Given(
  'the {word} line of mutant {string} of the gate mutation report is {int}',
  function (edge: string, id: string, line: number) {
    const repo = repository(this);
    const report = mutationReport(repo);
    const mutant = Object.values(report.files)
      .flatMap((file) => file.mutants)
      .find((candidate) => candidate.id === id);
    assert.ok(mutant !== undefined, `no mutant ${id}`);
    assert.ok(edge === 'start' || edge === 'end', `${edge} is neither start nor end`);
    mutant.location[edge].line = line;
    repo.write(MUTATION, JSON.stringify(report));
  },
);

Given(
  'the gate repository holds {string} of the mutation fixture {string}',
  function (path: string, fixture: string) {
    repository(this).write(path, fixtureSource(fixture, path));
  },
);

Given(
  'the gate repository holds {string} of the mutation fixture {string} with line {int} changed',
  function (path: string, fixture: string, line: number) {
    repository(this).write(
      path,
      replaceLine(fixtureSource(fixture, path), line, '// changed since the first parent'),
    );
  },
);

Given(
  'line {int} of {string} reads {string} in the gate mutation report and in the working tree',
  function (line: number, path: string, content: string) {
    const repo = repository(this);
    const report = mutationReport(repo);
    const file = report.files[path];
    assert.ok(file !== undefined, `${path} is not in the mutation report`);
    file.source = replaceLine(file.source, line, content);
    repo.write(MUTATION, JSON.stringify(report));
    repo.write(path, file.source);
  },
);

Given('the gate base is the fixture {string}', function (name: string) {
  const repo = repository(this);
  const text = readFileSync(join(FIXTURES, 'base', `${name}.json`), 'utf8');
  repo.write(
    BASE,
    text.includes('FIRST_PARENT') ? text.replaceAll('FIRST_PARENT', repo.rev('HEAD^1')) : text,
  );
});

Given('the gate repository file {string} is the gate base just written', function (path: string) {
  const repo = repository(this);
  repo.write(path, repo.read('reports/gate-base.json'));
});

Given('the gate base reads:', function (text: string) {
  repository(this).write(BASE, text);
});

Then('the gate verdict is green', function () {
  const repo = repository(this);
  assert.match(repo.read(REPORT), /^# Porte de test, job \S+ : VERTE\n/);
  assert.equal(repo.exitCode, 0);
});

Then('the gate verdict is red', function () {
  const repo = repository(this);
  assert.match(repo.read(REPORT), /^# Porte de test, job \S+ : ROUGE\n/);
  assert.equal(repo.exitCode, 1);
});

Then('the gate verdict is {string}', function (verdict: string) {
  const repo = repository(this);
  const green = verdict === 'green';
  assert.match(repo.read(REPORT), new RegExp(`^# Porte de test, job \\S+ : ${green ? 'VERTE' : 'ROUGE'}\\n`));
  assert.equal(repo.exitCode, green ? 0 : 1);
});

Then('the Cucumber lot parser refuses an empty list with {string}', function (failure: string) {
  assert.deepEqual(
    parseCucumberShards([], () => true),
    { failure },
  );
});

Then('the Cucumber lot outcome diagnostic is:', function (expected: string) {
  const actual = violations(repository(this).read(REPORT)).filter((line) => line.startsWith('2: '));
  assert.deepEqual(actual, expected === 'none' ? [] : ['2: ' + expected]);
});

Then('the gate reports no violation', function () {
  assert.deepEqual(violations(repository(this).read(REPORT)), []);
});

Then('the gate violations are:', function (text: string) {
  const repo = repository(this);
  assert.deepEqual(violations(repo.read(REPORT)), expectedLines(repo, text));
});

Then('the gate violations of rule {int} are:', function (rule: number, text: string) {
  const repo = repository(this);
  const ofRule = violations(repo.read(REPORT)).filter((line) => line.startsWith(`${rule}: `));
  assert.deepEqual(ofRule, expectedLines(repo, text));
});

Then('the gate report reads:', function (text: string) {
  const repo = repository(this);
  assert.equal(repo.read(REPORT), `${repo.tokens(text)}\n`);
});

Then('the gate report has the line {string}', function (line: string) {
  const repo = repository(this);
  assert.ok(repo.read(REPORT).split('\n').includes(repo.tokens(line)), repo.read(REPORT));
});

Then('the gate report has the line:', function (line: string) {
  const repo = repository(this);
  assert.ok(repo.read(REPORT).split('\n').includes(repo.tokens(line)), repo.read(REPORT));
});

Then('the gate mutation section reads:', function (text: string) {
  const repo = repository(this);
  const report = repo.read(REPORT);
  assert.equal(report.slice(report.indexOf('## Mutation')), `${repo.tokens(text)}\n`);
});

Then('the gate plan is:', function (text: string) {
  const repo = repository(this);
  assert.deepEqual(JSON.parse(repo.read('reports/gate-plan.json')), JSON.parse(repo.tokens(text)));
});

Then('the gate base written is:', function (text: string) {
  const repo = repository(this);
  assert.deepEqual(JSON.parse(repo.read('reports/gate-base.json')), JSON.parse(repo.tokens(text)));
});

Then('no gate base is written', function () {
  assert.equal(repository(this).exists('reports/gate-base.json'), false);
});

Then('the GitHub step summary holds the gate report {int} time(s)', function (times: number) {
  const repo = repository(this);
  assert.equal(repo.read('summary.md'), repo.read(REPORT).repeat(times));
});

Then('the gate output is the gate report', function () {
  const repo = repository(this);
  assert.equal(repo.output, repo.read(REPORT));
});

Given('a native mutation report with {string}', function (variant: string) {
  const source = 'export const value = true;';
  const mutant = {
    id: 'one',
    status: 'Killed',
    static: false,
    mutatorName: 'BooleanLiteral',
    replacement: 'false',
    location: { start: { line: 1, column: 22 }, end: { line: 1, column: 26 } },
  };
  const { static: _static, ...withoutActivation } = mutant;
  const raw: Record<string, unknown> = {
    files: {
      'src/a.mjs': { source, mutants: [mutant] },
      'src/b.mjs': {
        source,
        mutants: [
          { ...mutant, id: 'two' },
          {
            ...withoutActivation,
            id: 'three',
            status:
              variant === 'duplicate scenario' || variant === 'duplicate scope' ? 'NoCoverage' : variant,
          },
        ],
      },
    },
    config: { mutate: ['src/a.mjs', 'src/b.mjs'] },
  };
  if (variant === 'duplicate scenario') {
    raw['testFiles'] = {
      'specs/a.feature': { tests: [{ id: 'reused', location: { start: { line: 2, column: 1 } } }] },
      'specs/b.feature': { tests: [{ id: 'reused', location: { start: { line: 7, column: 1 } } }] },
    };
  }
  if (variant === 'duplicate scope') {
    raw['gateNativeScope'] = [
      { file: 'src/a.mjs', whole: false, lines: [1] },
      { file: 'src/a.mjs', whole: true, lines: [] },
    ];
  }
  this.state['native report reading'] = parseMutationReport(JSON.stringify(raw), true);
});

Then('strict native report reading fails with {string}', function (failure: string) {
  assert.deepEqual(this.state['native report reading'], { failure });
});

Then('the uncovered native mutant has no optional report metadata', function () {
  const report = this.state['native report reading'] as ReturnType<typeof parseMutationReport>;
  assert.ok(!('failure' in report), JSON.stringify(report));
  assert.equal(Object.hasOwn(report, 'gateNativeScope'), false);
  const mutant = report.files.get('src/b.mjs')?.mutants.find(({ id }) => id === 'three');
  assert.ok(mutant);
  assert.equal(mutant.status, 'NoCoverage');
  assert.equal(mutant.static, false);
  assert.equal(Object.hasOwn(mutant, 'statusReason'), false);
});

Then('a valid native mutation report has a parsed source, position and active static flag', function () {
  const bytes = readFileSync(join(FIXTURES, 'mutation/survivor.json'), 'utf8');
  assert.doesNotThrow(() => {
    const parsed = parseMutationReport(bytes, true);
    assert.ok(!('failure' in parsed));
    const file = parsed.files.get('src/math.mjs');
    assert.ok(file !== undefined);
    assert.match(file.source, /function sum/);
    const first = file.mutants[0];
    assert.ok(first !== undefined);
    assert.equal(first.status, 'Killed');
    assert.deepEqual([first.startLine, first.endLine, first.static], [2, 4, false]);
  }, 'a valid native mutation report must parse in process');
  assert.throws(() => requireNativeMutationReport('broken'), /JSON invalide/);
});

Then(
  'Cucumber Messages admission distinguishes legacy reads, strict lots and torn replay tails',
  function () {
    const source = readFileSync(join(FIXTURES, 'reports/green.ndjson'), 'utf8');
    const inScope = () => true;
    for (const invalid of ['false', '"text"', '[]', 'null']) {
      const proof = parseCucumberReport(invalid + '\n' + source, inScope, true);
      assert.deepEqual(proof, { failure: 'rapport Cucumber invalide : enveloppe Messages non objet' });
    }
    const lines = source.trimEnd().split('\n');
    const terminal = JSON.parse(lines.pop() as string);
    terminal.testRunFinished.testRunStartedId = 'different run';
    const mismatch = [...lines, JSON.stringify(terminal)].join('\n');
    const legacy = parseCucumberReport(mismatch, inScope);
    assert.ok(!('failure' in legacy) && legacy.pickles.length > 0);
    assert.deepEqual(parseCucumberReport(mismatch, inScope, true), {
      failure: 'fin Cucumber rattachée à un autre lot',
    });

    const torn = lines.join('\n') + '\n{';
    let identities: readonly (string | null)[] = [];
    const observed = parseCucumberReport(torn, inScope, false, (locations, completed) => {
      identities = locations;
      assert.equal(completed, false);
    });
    const unopened = parseCucumberReport(torn, inScope);
    assert.ok(identities.includes('specs/green.feature:4'));
    assert.ok('failure' in observed);
    assert.deepEqual(observed, unopened);
  },
);

async function copyNativeIgnores(repo: GateRepository): Promise<void> {
  const { Instrumenter } = await import('@stryker-mutator/instrumenter');
  const { noopLogger } = await import('@stryker-mutator/util');
  const report = mutationReport(repo);
  const file = report.files['src/math.mjs']!;
  const { mutants } = await new Instrumenter(noopLogger).instrument(
    [{ name: repo.path('src/math.mjs'), content: file.source, mutate: true }],
    { plugins: null, excludedMutations: [], ignorers: [] },
  );
  for (const native of mutants) {
    const row = file.mutants.find((mutant) => mutant.id === native.id);
    assert.ok(row);
    if (native.status === 'Ignored')
      Object.assign(row, { status: 'Ignored', statusReason: native.statusReason });
  }
  repo.write(MUTATION, JSON.stringify(report));
}

Given('the gate report uses native ignore statuses', async function () {
  await copyNativeIgnores(repository(this));
});

Given('the gate report uses native ignore statuses for a {string} verdict', async function (verdict: string) {
  if (verdict === 'green') await copyNativeIgnores(repository(this));
});
