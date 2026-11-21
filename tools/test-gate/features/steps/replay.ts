import { loadConfiguration, loadSources, type runCucumber } from '@cucumber/cucumber/api';
import { runReplayCucumber } from '../../src/infrastructure/replay-cucumber.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MutantRecord } from '../../src/domain/mutation.js';
import {
  expectationOf,
  judgeReplay,
  mutatedSource,
  recheckDivergence,
  type Expectation,
  type Judgement,
  type RunResult,
} from '../../src/domain/replay.js';
import type { ExecutedPickle } from '../../src/domain/run.js';
import { CucumberRunner, detectLimit, sha256, type Timed } from '../../src/infrastructure/replay.js';
import { parseMutationReport } from '../../src/infrastructure/mutation-report.js';
import { CONFIG_PATH } from '../../src/infrastructure/gate.js';
import { FIXTURES, Given, Then, When, repository } from './repository.js';

// Steps of features/replay.feature and features/canary-rule.feature (rule 7). The end-to-end replays run the real
// cucumber-js of the repository on the fixture suite (tools/test-gate/fixtures/suite) inside a disposable repository.

const MUTATION = 'reports/mutation/mutation.json';
const RECORD = 'reports/mutation/replay.json';
const ROOT_MODULES = join(FIXTURES, '..', '..', '..', 'node_modules');

interface Mutant {
  id: string;
  status: string;
  static?: boolean;
  killedBy?: string[];
  coveredBy?: string[];
}

interface Report {
  files: Record<string, { source: string; mutants: Mutant[] }>;
}

function editReport(world: Parameters<typeof repository>[0], edit: (report: Report) => void): void {
  const repo = repository(world);
  const report = JSON.parse(repo.read(MUTATION)) as Report;
  edit(report);
  repo.write(MUTATION, JSON.stringify(report));
}

function mutantOf(report: Report, id: string): Mutant {
  const found = Object.values(report.files)
    .flatMap((file) => file.mutants)
    .find((mutant) => mutant.id === id);
  assert.ok(found !== undefined, `no mutant ${id}`);
  return found;
}

Given('the gate repository can run the fixture suite with cucumber-js', function () {
  const repo = repository(this);
  repo.write('.gitignore', 'reports/\nnode_modules\n');
  symlinkSync(ROOT_MODULES, repo.path('node_modules'));
  repo.write(
    'specs/steps/steps.mjs',
    readFileSync(join(FIXTURES, 'suite', 'specs', 'steps', 'steps.mjs'), 'utf8'),
  );
  repo.write(
    'cucumber.mjs',
    "export default {};\nexport const replay = { import: ['specs/steps/*.mjs'], retry: 0, strict: true };\n",
  );
});

Given('the gate configuration declares the replay', function () {
  const repo = repository(this);
  const config = JSON.parse(repo.read(CONFIG_PATH)) as Record<string, unknown>;
  config['replay'] = { profile: 'replay', record: RECORD, work: 'reports/replay', limitMs: 600_000 };
  repo.write(CONFIG_PATH, JSON.stringify(config));
});

Given('the gate replay profile is {string}', function (profile: string) {
  const repo = repository(this);
  const config = JSON.parse(repo.read(CONFIG_PATH)) as { replay: Record<string, unknown> };
  config.replay['profile'] = profile;
  repo.write(CONFIG_PATH, JSON.stringify(config));
});

Then('the gate output starts with {string}', function (prefix: string) {
  assert.ok(repository(this).output.startsWith(prefix), repository(this).output);
});

Given('the gate replay limit is {int} ms', function (limitMs: number) {
  const repo = repository(this);
  const config = JSON.parse(repo.read(CONFIG_PATH)) as { replay: Record<string, unknown> };
  config.replay['limitMs'] = limitMs;
  repo.write(CONFIG_PATH, JSON.stringify(config));
});

Given(
  'mutant {string} of the gate mutation report is replaced by {string}',
  function (id: string, replacement: string) {
    editReport(this, (report) => {
      (mutantOf(report, id) as Mutant & { replacement: string }).replacement = replacement;
    });
  },
);

Given('the gate configuration declares the canary {string} with:', function (file: string, text: string) {
  const repo = repository(this);
  const config = JSON.parse(repo.read(CONFIG_PATH)) as Record<string, unknown>;
  config['canary'] = { file, functions: JSON.parse(text) as unknown };
  repo.write(CONFIG_PATH, JSON.stringify(config));
});

Given('the gate replay record reads {string}', function (text: string) {
  repository(this).write(RECORD, text);
});

/** A record bound to the current mutation report: the listed mutants confirmed, or one with a divergence. */
function writeRecord(world: Parameters<typeof repository>[0], entries: [string, string | null][]): void {
  const repo = repository(world);
  const text = repo.read(MUTATION);
  const report = JSON.parse(text) as Report;
  const mutants = entries.map(([id, divergence]) => {
    const [file, found] = Object.entries(report.files)
      .map(([path, f]): [string, Mutant | undefined] => [path, f.mutants.find((m) => m.id === id)])
      .find(([, m]) => m !== undefined) as [string, Mutant];
    return { file, id, status: found.status, divergence };
  });
  repo.write(RECORD, JSON.stringify({ report: sha256(text), mutants }));
}

Given('the gate replay record of the mutation report confirms the mutants {string}', function (ids: string) {
  writeRecord(
    this,
    ids.split(', ').map((id) => [id, null]),
  );
});

Given(
  'the gate replay record of the mutation report has a divergent record for mutant {string}',
  function (id: string) {
    writeRecord(this, [
      ['0', null],
      [id, 'écart'],
    ]);
  },
);

Given('the first replay entry is changed to have a {string}', function (kind: string) {
  const repo = repository(this);
  const record = JSON.parse(repo.read(RECORD)) as {
    mutants: { file: string; id: string; status: string; divergence: string | null }[];
  };
  const first = record.mutants[0];
  assert.ok(first);
  if (kind === 'duplicate entry') record.mutants.push(first);
  else if (kind === 'different status') first.status = 'Survived';
  else if (kind === 'foreign entry') record.mutants.push({ ...first, file: 'unrelated.mjs' });
  else throw new Error(kind);
  repo.write(RECORD, JSON.stringify(record));
});

Given(
  'the {word} of mutant {string} of the gate mutation report are {string}',
  function (field: string, id: string, ids: string) {
    assert.ok(field === 'killedBy' || field === 'coveredBy', `${field} is neither killedBy nor coveredBy`);
    editReport(this, (report) => {
      mutantOf(report, id)[field] = ids === '' ? [] : ids.split(', ');
    });
  },
);

for (const [words, value] of [
  ['is static', true],
  ['is not static', false],
] as const) {
  Given(`mutant {string} of the gate mutation report ${words}`, function (id: string) {
    editReport(this, (report) => {
      mutantOf(report, id).static = value;
    });
  });
}

Given('the gate mutation report keeps only the mutants {string}', function (ids: string) {
  const kept = new Set(ids.split(', '));
  editReport(this, (report) => {
    for (const file of Object.values(report.files)) file.mutants = file.mutants.filter((m) => kept.has(m.id));
  });
});

Given('the gate mutation fixture declares its independent mutation profile', function () {
  const repo = repository(this);
  repo.write(
    'cucumber.mjs',
    repo.read('cucumber.mjs') + "export const mutation = { paths: ['specs/*.feature'] };\n",
  );
});

When('the gate replays mutation lot {string}', function (lot: string) {
  return repository(this).run(['replay', '--shard', lot]);
});

When('the gate collects the mutation replay lots', function () {
  return repository(this).run(['replay-collect']);
});

Given('the gate removes replay lot {string}', function (lot: string) {
  repository(this).remove('reports/replay-shards/' + lot + '/replay.json');
});

Given('the gate appends a newline to the mutation report', function () {
  const repo = repository(this);
  repo.write(MUTATION, repo.read(MUTATION) + '\n');
});

Given('the gate removes a scenario from the mutation report catalogue', function () {
  const repo = repository(this);
  const report = JSON.parse(repo.read(MUTATION));
  report.testFiles['specs/green.feature'].tests.pop();
  repo.write(MUTATION, JSON.stringify(report));
});

Given('the gate report includes a second file with one surviving mutant', function () {
  const repo = repository(this);
  const report = JSON.parse(repo.read(MUTATION));
  const original = report.files['src/math.mjs'];
  const survivor = original.mutants.find(({ id }: { id: string }) => id === '5');
  assert.ok(survivor);
  report.config.mutate.push('src/other.mjs');
  report.files['src/other.mjs'] = { source: original.source, mutants: [{ ...survivor, id: 'other-5' }] };
  repo.write('src/other.mjs', original.source);
  repo.write(MUTATION, JSON.stringify(report));
});

Then('replay lot {string} contains just {string}', function (lot: string, file: string) {
  const receipt = JSON.parse(repository(this).read('reports/replay-shards/' + lot + '/replay.json'));
  assert.deepEqual([...new Set(receipt.mutants.map((mutant: { file: string }) => mutant.file))], [file]);
});

Given('the gate copies the first replay receipt into the second lot', function () {
  const repo = repository(this);
  repo.write('reports/replay-shards/2/replay.json', repo.read('reports/replay-shards/1/replay.json'));
});

Then('the gate output includes {string}', function (expected: string) {
  const actual = repository(this).output;
  assert.ok(actual.includes(expected), actual);
});

When('the instrumented runner exercises the replay selector with {string}', async function (variant: string) {
  const repo = repository(this);
  const profiles: Record<string, object> = {
    shard: { shard: '1/2' },
    retry: { retry: 1 },
    dryRun: { dryRun: true },
    failFast: { failFast: true },
    parallel: { parallel: 2 },
    extra: { paths: ['specs/second.feature'] },
    plugins: { plugin: ['unused-example'] },
  };
  const profile = profiles[variant];
  if (profile !== undefined)
    repo.write(
      'cucumber.mjs',
      repo.read('cucumber.mjs') + '\nexport const probe = ' + JSON.stringify(profile) + ';\n',
    );
  if (variant === 'syntax') repo.write('specs/invalid.feature', 'Scenario: missing feature header\n');
  const location =
    variant === 'missing'
      ? 'specs/green.feature:9999'
      : variant === 'syntax'
        ? 'specs/invalid.feature:1'
        : 'specs/green.feature:12';
  const args = [profile === undefined ? 'replay' : 'probe', repo.path('reports/replay.ndjson'), location];
  if (variant === 'profile absent') args[0] = 'absent';
  if (variant === 'no profile') args[0] = '';
  if (variant === 'no report') args[1] = '';
  if (variant === 'no locations') args.pop();
  let diagnostics = '';
  let called = 0;
  const status = await runReplayCucumber(
    args,
    {
      write(text) {
        diagnostics += text;
      },
    },
    {
      async loadConfiguration(...configArgs) {
        const config = await loadConfiguration(...configArgs);
        const formats = config.runConfiguration.formats.files;
        if (variant === 'missing format') delete formats[args[1] as string];
        if (variant === 'wrong format') formats[args[1] as string] = 'json';
        if (variant === 'extra format') formats[repo.path('reports/additional.json')] = 'json';
        return config;
      },
      async loadSources(...sourceArgs) {
        const result = await loadSources(...sourceArgs);
        return variant === 'duplicate' ? { ...result, plan: [...result.plan, ...result.plan] } : result;
      },
      async runCucumber(configuration) {
        called++;
        assert.deepEqual(configuration.formats.files, { [repo.path('reports/replay.ndjson')]: 'message' });
        if (variant === 'execution error') throw new Error('fixture execution failure');
        return { success: variant !== 'step failed', support: {} } as Awaited<ReturnType<typeof runCucumber>>;
      },
    },
    { cwd: repo.dir },
  );
  this.state['replaySelector'] = { status, called, diagnostics };
});

Then(
  'the replay selector exits with {int} and authorizes execution {int} times with {string}',
  function (status: number, called: number, expected: string) {
    const actual = this.state['replaySelector'] as { status: number; called: number; diagnostics: string };
    assert.equal(actual.status, status, actual.diagnostics);
    assert.equal(actual.called, called);
    assert.ok(actual.diagnostics.includes(expected), actual.diagnostics);
  },
);

When('the replay writes its working files outside the repository', async function () {
  const repo = repository(this);
  const work = mkdtempSync(join(tmpdir(), 'replay-outside-'));
  try {
    this.state['timed'] = await new CucumberRunner(repo.dir, 'replay', work).run(
      ['specs/green.feature:4'],
      600_000,
    );
  } finally {
    rmSync(work, { recursive: true });
  }
});

When('the replay child fails after creating its Messages file', async function () {
  const repo = repository(this);
  const file = 'specs/failed-selector.mts';
  repo.write(
    file,
    [
      "import { writeFileSync } from 'node:fs';",
      'export async function runReplayCucumber(args, stderr) {',
      '  writeFileSync(args[1], "");',
      "  stderr.write('AOS_REPLAY_PLAN_VALID\\nAOS_REPLAY_EXECUTION: Error: failure after opening Messages\\n');",
      '  return 1;',
      '}',
    ].join('\n'),
  );
  const runner = new CucumberRunner(
    repo.dir,
    'replay',
    repo.path('reports/replay'),
    pathToFileURL(repo.path(file)),
  );
  this.state['timed'] = await runner.run(['specs/green.feature:4'], 600_000);
});

Then('the replay records the execution error from the child', function () {
  const { result } = this.state['timed'] as Timed;
  assert.deepEqual(result.run, { failure: 'Error: failure after opening Messages' });
  assert.equal(result.selectionFailure, undefined);
});

When('the runner snapshots the selector and then the worktree copy is replaced', async function () {
  const repo = repository(this);
  const source = new URL('../../src/infrastructure/replay-cucumber.ts', import.meta.url);
  const original = repo.path('specs/selector.mts');
  repo.write('specs/selector.mts', readFileSync(source, 'utf8'));
  const runner = new CucumberRunner(repo.dir, 'replay', repo.path('reports/replay'), pathToFileURL(original));
  repo.write('specs/selector.mts', 'throw Error("mutated selector loaded");\n');
  this.state['timed'] = await runner.run(['specs/green.feature:4'], 600_000);
});

When('the gate replays the mutation report', function () {
  return repository(this).run(['replay']);
});

When('the gate replays every mutant of the mutation report', async function () {
  const started = performance.now();
  await repository(this).run(['replay', '--all']);
  this.state['replayMs'] = performance.now() - started;
});

Then('the gate replay took less than {int} seconds', function (seconds: number) {
  assert.ok((this.state['replayMs'] as number) < seconds * 1000, String(this.state['replayMs']));
});

Given('the gate mutation report copies {string} to {string}', function (from: string, to: string) {
  editReport(this, (report) => {
    report.files[to] = report.files[from] as Report['files'][string];
  });
});

Given(
  'the {word} field of mutant {string} of the gate mutation report is absent',
  function (field: string, id: string) {
    editReport(this, (report) => {
      delete (mutantOf(report, id) as unknown as Record<string, unknown>)[field];
    });
  },
);

Given('the gate repository holds a scenario that leaves a child process behind', function () {
  const repo = repository(this);
  repo.write(
    'specs/orphan.feature',
    'Feature: Orphan\n\n  Scenario: a step that leaves a child process behind\n    Given a child process left behind\n',
  );
  repo.write(
    'specs/steps/orphan.mjs',
    [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "import { Given } from '@cucumber/cucumber';",
      "Given('a child process left behind', () => {",
      // Bounded: a mutant that disables the kill of the group leaves it behind for a minute, not forever.
      "  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      "  writeFileSync('orphan.pid', String(child.pid));",
      '  child.unref();',
      '});',
      '',
    ].join('\n'),
  );
});

When('the replay runner runs {string} once within {int} ms', async function (test: string, limit: number) {
  const repo = repository(this);
  const runner = new CucumberRunner(repo.dir, 'replay', repo.path('reports/replay'));
  const descriptors = readdirSync('/dev/fd').length;
  const started = performance.now();
  this.state['timed'] = await runner.run([test], limit);
  this.state['wallMs'] = performance.now() - started;
  this.state['descriptors'] = readdirSync('/dev/fd').length - descriptors;
});

Then('the replay run passed within its limit', function () {
  const { result } = this.state['timed'] as Timed;
  assert.equal(result.timedOut, false);
  assert.ok(!('failure' in result.run), JSON.stringify(result.run));
  assert.deepEqual(
    result.run.pickles.flatMap((pickle) =>
      pickle.attempts.flatMap((a) => a.steps.map((step) => step.status)),
    ),
    ['PASSED'],
  );
});

Given('the gate repository holds a scenario that writes a megabyte to its standard output', function () {
  const repo = repository(this);
  repo.write(
    'specs/chatty.feature',
    'Feature: Chatty\n\n  Scenario: a step that writes a megabyte\n    Given a megabyte written to the standard output\n',
  );
  repo.write(
    'specs/steps/chatty.mjs',
    [
      "import { writeSync } from 'node:fs';",
      "import { Given } from '@cucumber/cucumber';",
      "Given('a megabyte written to the standard output', () => {",
      "  writeSync(1, 'x'.repeat(1024 * 1024));",
      '});',
      '',
    ].join('\n'),
  );
});

Then('the replay runner left no file descriptor open', function () {
  assert.equal(this.state['descriptors'], 0);
});

/**
 * The state of a process: '' once it is gone, `Z` for a zombie (dead, not yet reaped by its new parent). Linux:
 * /proc/<pid>/stat, whose third field is the state (proc(5)); elsewhere kill(pid, 0), which ends with ESRCH once the
 * process is reaped. No command is launched: process launching lives behind the port (.dependency-cruiser.cjs).
 */
const stateOf = (pid: number): string => {
  if (existsSync('/proc')) {
    try {
      return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.charAt(0) ?? '';
    } catch {
      return '';
    }
  }
  try {
    process.kill(pid, 0);
    return 'S';
  } catch {
    return '';
  }
};

Then('the child process left behind is gone', async function () {
  const pid = Number(repository(this).read('orphan.pid'));
  let state = stateOf(pid);
  for (let tries = 0; tries < 30 && state !== '' && !state.startsWith('Z'); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    state = stateOf(pid);
  }
  assert.ok(state === '' || state.startsWith('Z'), `process ${pid} still running: ${state}`);
});

Then('the replay runner measured the run, within its wall time', function () {
  const { ms, result } = this.state['timed'] as Timed;
  assert.ok(!('failure' in result.run), JSON.stringify(result.run));
  assert.ok(ms > 0 && ms <= (this.state['wallMs'] as number), `${ms} / ${String(this.state['wallMs'])}`);
});

Then('the gate replay record is:', function (text: string) {
  const repo = repository(this);
  const record = JSON.parse(repo.read(RECORD)) as {
    report: string;
    mutants: { file: string; id: string; status: string; divergence: string | null }[];
  };
  assert.equal(
    record.report,
    createHash('sha256')
      .update(readFileSync(repo.path(MUTATION)))
      .digest('hex'),
  );
  assert.deepEqual(
    record.mutants.map((m) => `${m.file} #${m.id} ${m.status} : ${m.divergence ?? 'confirmé'}`),
    text.split('\n'),
  );
});

Then('the gate replay record is absent', function () {
  assert.equal(repository(this).exists(RECORD), false);
});

Then(
  'the gate repository file {string} is the one of the mutation fixture {string}',
  function (path: string, fixture: string) {
    const report = JSON.parse(readFileSync(join(FIXTURES, 'mutation', `${fixture}.json`), 'utf8')) as Report;
    assert.equal(repository(this).read(path), report.files[path]?.source);
  },
);

Then('the gate replay ran {int} cucumber-js run(s)', function (runs: number) {
  const repo = repository(this);
  if (runs > 0) assert.equal(repo.exists(`reports/replay/run-${runs}.ndjson`), true);
  assert.equal(repo.exists(`reports/replay/run-${runs + 1}.ndjson`), false);
});

When(
  'the gate applies mutant {string} of the mutation fixture {string} to {string}',
  function (id: string, fixture: string, path: string) {
    const report = parseMutationReport(readFileSync(join(FIXTURES, 'mutation', `${fixture}.json`), 'utf8'));
    assert.ok(!('failure' in report), 'the fixture is a mutation report');
    const file = report.files.get(path);
    assert.ok(file !== undefined, `${path} is not in ${fixture}`);
    const mutant = file.mutants.find((m) => m.id === id) as MutantRecord;
    this.state['mutated'] = mutatedSource(file.source, mutant);
  },
);

Then('the mutated source is:', function (text: string) {
  assert.equal(this.state['mutated'], `${text}\n`);
});

Then('the detect limit of a control of {float} ms is {int} ms', function (control: number, limit: number) {
  assert.equal(detectLimit(control), limit);
});

/**
 * A run in a compact form: `timeout`, `unreadable`, `hook <STATUS>`, or pickles separated by ` | `, each one its step
 * statuses separated by spaces, prefixed by `2 attempts: ` for a pickle run twice. Pickles are named p1, p2...
 */
function runOf(text: string): RunResult {
  if (text === 'timeout') return { run: { pickles: [], runHooks: [] }, timedOut: true };
  if (text === 'unreadable') return { run: { failure: 'illisible' }, timedOut: false };
  if (text.startsWith('hook ')) {
    return { run: { pickles: [], runHooks: [{ name: 'hook h', status: text.slice(5) }] }, timedOut: false };
  }
  const incomplete = text === 'no finish run';
  const unfinished = text === 'no finish attempt';
  const badExit = text === 'exit failure';
  const source = incomplete || unfinished || badExit ? 'PASSED' : text;
  const pickles: ExecutedPickle[] = source.split(' | ').map((spec, index) => {
    const twice = spec.startsWith('2 attempts: ');
    const steps = (twice ? spec.slice(12) : spec).split(' ').map((status) => ({ name: 's', status }));
    const attempt = (n: number) => ({ attempt: n, willBeRetried: unfinished ? null : false, steps });
    return {
      id: `p${index + 1}`,
      pickleSteps: steps.length,
      attempts: twice ? [attempt(0), attempt(1)] : [attempt(0)],
    };
  });
  return {
    run: { pickles, runHooks: [] },
    timedOut: false,
    ...(incomplete ? { incomplete: true } : {}),
    ...(badExit ? { badExit: true } : {}),
  };
}

When(
  'the gate judges the replay of a {word} mutant over {int} scenario(s), control {string}, mutant {string}',
  function (status: string, scenarios: number, control: string, mutant: string) {
    const replay = {
      file: 'src/a.ts',
      mutant: { id: '1', status } as MutantRecord,
      expectation: expectationOf(status) as Expectation,
      tests: [],
      fallback: [],
      source: '',
      mutated: '',
      problem: null,
    };
    this.state['judgement'] = judgeReplay(
      replay,
      scenarios,
      control === 'none' ? null : runOf(control),
      runOf(mutant),
    );
  },
);

Then(
  'the replay divergence is {string}, retry {word}, recheck {word}',
  function (expected: string, retry: string, recheck: string) {
    const judgement = this.state['judgement'] as Judgement;
    assert.deepEqual(
      { divergence: judgement.divergence ?? 'none', retry: judgement.retry, recheck: judgement.recheck },
      { divergence: expected, retry: retry === 'yes', recheck: recheck === 'yes' },
    );
  },
);

When(
  'a fresh control after a broken detection over {int} scenario(s) is {string}',
  function (n: number, run: string) {
    this.state['recheck'] = recheckDivergence(runOf(run), n);
  },
);

Then('the recheck divergence is {string}', function (expected: string) {
  assert.equal(this.state['recheck'] ?? 'none', expected);
});

Given(
  'the file {string} of the gate mutation report is renamed {string}',
  function (from: string, to: string) {
    editReport(this, (report) => {
      const file = report.files[from];
      assert.ok(file !== undefined, `${from} is not in the mutation report`);
      delete report.files[from];
      report.files[to] = file;
    });
  },
);

Given(
  'the gate mutation report has first a Killed StringLiteral mutant {string} on line {int} of {string}',
  function (id: string, line: number, path: string) {
    editReport(this, (report) => {
      const file = report.files[path];
      assert.ok(file !== undefined, `${path} is not in the mutation report`);
      const synthetic = {
        id,
        mutatorName: 'StringLiteral',
        replacement: '""',
        status: 'Killed',
        static: false,
        killedBy: [],
        coveredBy: [],
        location: { start: { line, column: 1 }, end: { line, column: 2 } },
      };
      file.mutants.unshift(synthetic);
    });
  },
);

Given('the gate mutation report mutated {string}', function (patterns: string) {
  editReport(this, (report) => {
    (report as Report & { config: { mutate: string[] } }).config.mutate = patterns.split(', ');
  });
});

When('the replay runner is given the following scenario list:', async function (text: string) {
  const repo = repository(this);
  const runner = new CucumberRunner(repo.dir, 'replay', repo.path('reports/replay'));
  this.state['timed'] = await runner.run(JSON.parse(text) as string[], 600_000);
});

Then('the invalid replay selection creates no run artifacts', function () {
  const { result, ms } = this.state['timed'] as Timed;
  const diagnostic = 'sélection de scénarios de rejeu invalide';
  assert.deepEqual(result, {
    run: { failure: diagnostic },
    timedOut: false,
    selectionFailure: diagnostic,
  });
  assert.equal(ms, 0);
  assert.equal(repository(this).exists('reports/replay'), false);
});

Then('the replay refuses its scenario selection with {string}', function (reason: string) {
  const { result } = this.state['timed'] as Timed;
  assert.equal(result.selectionFailure, reason, JSON.stringify(result.run));
});

Then('a nested logical mutation keeps its AST grouping during replay', function () {
  const source = 'left && middle && right';
  const mutant = {
    mutatorName: 'LogicalOperator',
    replacement: 'left || middle',
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 15,
  } as MutantRecord;
  assert.equal(mutatedSource(source, mutant), '(left || middle) && right');
});
