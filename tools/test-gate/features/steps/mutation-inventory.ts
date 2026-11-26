import assert from 'node:assert/strict';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { noopLogger } from '@stryker-mutator/util';
import { PluginKind } from '@stryker-mutator/api/plugin';
import { readNativeLotIgnorer, strykerPlugins } from '../../src/infrastructure/stryker-lot-plugin.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGate } from '../../src/infrastructure/gate.js';
import { mutationCatalog } from '../../src/infrastructure/mutation-catalog.js';
import {
  combineHostedNative,
  combineNative,
  projectNative,
  type NativeProof,
} from '../../src/infrastructure/mutation-shards.js';
import { requireCompleteMutationLots, type Lot } from '../../src/infrastructure/mutation-lot-proof.js';
import { requireNativeMutationReport } from '../../src/infrastructure/mutation-report.js';
import { literalStrykerPattern } from '../../src/infrastructure/stryker-pattern.js';
import { FIXTURES, Given, Then, When, repository } from './repository.js';

export function fixtureIgnorer(repo: ReturnType<typeof repository>) {
  const ignorer = readNativeLotIgnorer(repo.dir, repo.path('reports/mutation-inventory.json'));
  assert.ok(ignorer, 'the native inventory must produce a working ignorer for the instrumenter');
  return ignorer;
}

type Inventory = {
  head: string;
  lots: {
    file: string;
    sourceSha256: string;
    whole: boolean;
    lines: number[];
    mutants: {
      start: { line: number; column: number };
      end: { line: number; column: number };
      mutatorName: string;
      replacement: string;
      ignored: string | null;
    }[];
  }[];
};

Then('the registered native plugin reads the inventory from its working directory', function () {
  const repo = repository(this);
  assert.equal(strykerPlugins.length, 1);
  const [plugin] = strykerPlugins;
  assert.ok(plugin);
  assert.equal(plugin.name, 'gate-native-lots');
  assert.equal(plugin.kind, PluginKind.Ignore);
  const cwd = process.cwd();
  const previous = process.env;
  const env = repo.admittedEnvironment();
  mkdirSync(join(env.ARCHITECT_OS_RUN_DIR!, 'reports'), { recursive: true });
  writeFileSync(
    join(env.ARCHITECT_OS_RUN_DIR!, 'reports', 'mutation-inventory.json'),
    repo.read('reports/mutation-inventory.json'),
  );
  repo.remove('reports/mutation-inventory.json');
  try {
    process.env = { ...previous, ...env };
    process.chdir(repo.dir);
    const ignorer = plugin.factory();
    assert.ok(ignorer, 'the registered factory returns an ignorer');
    const file = repo.path('src/scoped.mjs');
    assert.equal(ignorer.shouldIgnore({ hub: { file: { opts: { filename: file } } }, node: {} }), undefined);
  } finally {
    process.chdir(cwd);
    process.env = previous;
  }
});

Then('the native plugin refuses an inventory with invalid UTF-8 bytes or a byte-order mark', function () {
  const repo = repository(this);
  const path = repo.path('reports/mutation-inventory.json');
  const valid = readFileSync(path);
  const malformed = Buffer.from(valid);
  const insideQuotedPath = malformed.indexOf(Buffer.from('src/scoped.mjs'));
  assert(insideQuotedPath >= 0);
  malformed[insideQuotedPath] = 255;
  writeFileSync(path, malformed);
  assert.throws(() => readNativeLotIgnorer(repo.dir, repo.path('reports/mutation-inventory.json')), {
    code: 'ERR_ENCODING_INVALID_ENCODED_DATA',
  });
  writeFileSync(path, Buffer.concat([Buffer.from('\uFEFF'), valid]));
  assert.throws(
    () => readNativeLotIgnorer(repo.dir, repo.path('reports/mutation-inventory.json')),
    SyntaxError,
  );
});

Given('the gate source {string} begins with a byte-order mark', function (file: string) {
  const repo = repository(this);
  repo.write(file, '\uFEFFexport const value = true;\n');
});

Then('the inventory source digest includes every byte of {string}', function (file: string) {
  const repo = repository(this);
  const lot = readInventory(this).lots.find((item) => item.file === file);
  assert.ok(lot);
  const bytes = readFileSync(repo.path(file));
  assert.equal(lot.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
});

When('the gate inventories the mutation scope', function () {
  return repository(this).run(['inventory', '--job', 'linux']);
});

function readInventory(world: Parameters<typeof repository>[0]): Inventory {
  const repo = repository(world);
  assert.equal(repo.exitCode, 0);
  const result = JSON.parse(repo.read('reports/mutation-inventory.json')) as Inventory;
  assert.match(result.head, /^[a-f0-9]{40}$/);
  return result;
}

Then('the inventory declares only the shard {string}', function (shard: string) {
  const repo = repository(this);
  const manifest = JSON.parse(repo.read('reports/mutation-inventory.json')) as { shard?: number };
  if (shard === 'none') assert.equal(Object.hasOwn(manifest, 'shard'), false);
  else assert.equal(manifest.shard, Number(shard));
});

Then('the inventory files are {string}', function (paths: string) {
  assert.deepEqual(
    readInventory(this).lots.map(({ file }) => file),
    paths.split(', '),
  );
});

Then('the mutation plugin retains an unlocated node of {string}', function (file: string) {
  const repo = repository(this);
  const plugin = readNativeLotIgnorer(repo.dir, repo.path('reports/mutation-inventory.json'));
  assert.equal(
    plugin.shouldIgnore({ hub: { file: { opts: { filename: repo.path(file) } } }, node: {} }),
    undefined,
  );
});

Then('the whole-file plugin retains the unmutated identifier of {string}', function (file: string) {
  const repo = repository(this);
  const plugin = readNativeLotIgnorer(repo.dir, repo.path('reports/mutation-inventory.json'));
  const loc = { start: { line: 1, column: 13 }, end: { line: 1, column: 18 } };
  assert.equal(
    plugin.shouldIgnore({ hub: { file: { opts: { filename: repo.path(file) } } }, node: { loc } }),
    undefined,
  );
});

Then('native instrumentation refuses the unplanned file {string}', async function (file: string) {
  const repo = repository(this);
  const name = repo.path(file);
  await assert.rejects(
    new Instrumenter(noopLogger).instrument([{ name, content: 'export const value = true;', mutate: true }], {
      plugins: null,
      excludedMutations: [],
      ignorers: [fixtureIgnorer(repo)],
    }),
    { message: 'instrumentation hors inventaire : ' + name },
  );
});

Then('the mutation inventory retains the scoped multiline nodes', function () {
  const result = readInventory(this);
  const [lot] = result.lots;
  assert.equal(result.lots.length, 1);
  assert.ok(lot);
  assert.equal(lot.file, 'src/scoped.mjs');
  assert.equal(lot.whole, false);
  assert.deepEqual(lot.lines, [4]);
  assert.equal(lot.sourceSha256, createHash('sha256').update(repository(this).read(lot.file)).digest('hex'));
  assert(lot.mutants.some((mutant) => mutant.mutatorName === 'BlockStatement' && mutant.start.line === 2));
  assert(lot.mutants.some((mutant) => mutant.mutatorName === 'EqualityOperator' && mutant.start.line === 3));
  assert(lot.mutants.every((mutant) => mutant.start.line <= 4 && mutant.end.line >= 4));
});

Then('the inventory marks {string} as whole', function (file: string) {
  const result = readInventory(this);
  const lot = result.lots.find((candidate) => candidate.file === file);
  assert.ok(lot);
  assert.equal(lot.whole, true);
  assert.deepEqual(lot.mutants, []);
});

Then('the inventory announcement failure invalidates the written inventory', async function () {
  const repo = repository(this);
  let output = '';
  const inventory = 'reports/mutation-inventory.json';
  let wasWritten = false;
  const code = await runGate(
    ['node', 'test-gate', 'inventory', '--job', 'linux'],
    repo.dir,
    {},
    {
      write(text) {
        if (text.startsWith('inventaire ')) {
          const published = JSON.parse(repo.read(inventory));
          assert.ok(Array.isArray(published.lots));
          wasWritten = true;
          throw new Error('fixture output interrupted');
        }
        output += text;
      },
    },
  );
  assert.equal(code, 1, output);
  assert.equal(output, 'porte de test : fixture output interrupted\n');
  assert.equal(wasWritten, true);
  assert.equal(repo.exists(inventory), false);
});

Then('the mutation inventory is refused', function () {
  const repo = repository(this);
  assert.equal(repo.exitCode, 1);
  assert.equal(repo.exists('reports/mutation-inventory.json'), false);
});

Then('the inventory retains the native ignore reason', function () {
  const result = readInventory(this);
  const fixture = result.lots.find(({ file }) => file === 'src/scoped.mjs');
  assert.ok(fixture);
  const mutant = fixture.mutants.find(({ mutatorName }) => mutatorName === 'BooleanLiteral');
  assert.ok(mutant);
  assert.match(mutant.ignored ?? '', /fixture reason/);
});

When('the native plugin instruments the inventory files', async function () {
  const repo = repository(this);
  const { lots } = readInventory(this);
  const instrumenter = new Instrumenter(noopLogger);
  const inputs = lots.map(({ file }) => ({ name: repo.path(file), content: repo.read(file), mutate: true }));
  const result = await instrumenter.instrument(inputs, {
    plugins: null,
    excludedMutations: [],
    ignorers: [fixtureIgnorer(repo)],
  });
  const files = Object.fromEntries(
    lots.map(({ file }) => [
      file,
      {
        source: repo.read(file),
        mutants: result.mutants
          .filter(({ fileName }) => fileName === repo.path(file))
          .map((mutant) => {
            const point = ({ line, column }: { line: number; column: number }) => ({
              line: line + 1,
              column: column + 1,
            });
            const { start, end } = mutant.location;
            return {
              ...mutant,
              status: mutant.status ?? 'Pending',
              location: { start: point(start), end: point(end) },
            };
          }),
      },
    ]),
  );
  // Stryker reports the patterns it was given: the literal pattern of each file (stryker.config.mjs).
  repo.write(
    'reports/mutation/native.json',
    JSON.stringify({
      files,
      config: { mutate: lots.map(({ file }) => literalStrykerPattern(repo.dir, file)) },
    }),
  );
});

Then('the native report names {string} as the file it mutated', function (pattern: string) {
  const { config } = JSON.parse(repository(this).read('reports/mutation/native.json')) as {
    config: { mutate: string[] };
  };
  assert.deepEqual(config.mutate, [pattern]);
});

When('the gate inventories native shard {string}', function (shard: string) {
  return repository(this).run(['inventory', '--shard', shard]);
});

When('the native producer {string} publishes its raw proof', function (shard: string) {
  const repo = repository(this);
  const directory = 'reports/mutation-shards/' + shard;
  const nativePath = 'reports/mutation/native.json';
  const raw = JSON.parse(repo.read(nativePath));
  const testFixture = JSON.parse(readFileSync(join(FIXTURES, 'mutation/survivor.json'), 'utf8'));
  raw.testFiles = testFixture.testFiles;
  raw.schemaVersion = testFixture.schemaVersion;
  raw.thresholds = testFixture.thresholds;
  for (const { tests } of Object.values(raw.testFiles) as { tests: { id: string }[] }[]) {
    for (const test of tests) test.id = shard + '/' + test.id;
  }
  for (const [file, result] of Object.entries(raw.files) as [
    string,
    {
      language?: string;
      mutants: { coveredBy: string[]; killedBy?: string[]; status?: string; static?: boolean }[];
    },
  ][]) {
    result.language = 'javascript';
    for (const mutant of result.mutants) {
      mutant.static = false;
      mutant.coveredBy = [shard + '/1'];
      if (file === 'zz/probe.mjs') {
        mutant.status = 'Killed';
        mutant.killedBy = [shard + '/1'];
      }
    }
  }
  repo.write(directory + '/mutation/native.json', JSON.stringify(raw));
  repo.write(directory + '/mutation-inventory.json', repo.read('reports/mutation-inventory.json'));
});

Given('the second native proof has {string}', function (variant: string) {
  const repo = repository(this);
  const path = 'reports/mutation-shards/2/mutation/native.json';
  const report = JSON.parse(repo.read(path));
  const tests = report.testFiles['specs/green.feature'].tests;
  switch (variant) {
    case 'a surviving canary':
      report.files['zz/probe.mjs'].mutants[0].status = 'Survived';
      delete report.files['zz/probe.mjs'].mutants[0].killedBy;
      break;
    case 'an unknown covering test':
      report.files['src/b.mjs'].mutants[0].coveredBy = ['unknown-identifier'];
      break;
    case 'a missing scenario':
      tests.pop();
      break;
    case 'an unexpected scenario':
      tests.push({ ...tests[0], id: 'extra-location', location: { start: { line: 999, column: 1 } } });
      break;
    case 'a duplicate scenario':
      tests.push({ ...tests[0], id: 'duplicate-location' });
      break;
    default:
      throw new Error(variant);
  }
  repo.write(path, JSON.stringify(report));
});

Given('native producer {string} records a survivor in {string}', function (shard: string, file: string) {
  const repo = repository(this);
  const path = 'reports/mutation-shards/' + shard + '/mutation/native.json';
  const report = JSON.parse(repo.read(path));
  const [mutant] = report.files[file].mutants;
  assert.ok(mutant);
  mutant.status = 'Survived';
  repo.write(path, JSON.stringify(report));
});

When('the gate collects the two native production lots', function () {
  return repository(this).run(['inventory-collect', '--job', 'linux']);
});

Then(
  'the native result from {string} is named {string} and covers {string}',
  function (file: string, id: string, test: string) {
    const repo = repository(this);
    const report = JSON.parse(repo.read('reports/mutation/mutation.json'));
    const [mutant] = report.files[file].mutants;
    assert.equal(mutant.id, id);
    assert.deepEqual(mutant.coveredBy, [test]);
  },
);

Then('the aggregated report keeps the two certified canaries', function () {
  const repo = repository(this);
  const report = JSON.parse(repo.read('reports/mutation/mutation.json'));
  const canaries = report.files['zz/probe.mjs'].mutants as { id: string; status: string }[];
  assert.deepEqual([...new Set(canaries.map(({ id }) => id.split('/')[0]))], ['1', '2']);
  assert(canaries.every(({ status }) => status === 'Killed'));
  assert.equal(report.files['zz/probe.mjs'].language, 'javascript');
  assert.equal(typeof report.schemaVersion, 'string');
  assert.equal(typeof report.thresholds.high, 'number');
  assert.equal(typeof report.testFiles['specs/green.feature'].tests[0].name, 'string');
});

Then('the replay receipt {string} contains only its own canary', function (shard: string) {
  const repo = repository(this);
  const receipt = JSON.parse(repo.read('reports/replay-shards/' + shard + '/replay.json'));
  const canaries = receipt.mutants as { file: string; id: string; divergence: string | null }[];
  assert(canaries.length > 0);
  assert(
    canaries.every(
      ({ file, id, divergence }) =>
        file === 'zz/probe.mjs' && id.startsWith(shard + '/') && divergence !== null,
    ),
  );
});

Then(
  'replay lot {string} confirms a production survivor {string} in {string}',
  function (shard: string, id: string, file: string) {
    const repo = repository(this);
    const receipt = JSON.parse(repo.read('reports/replay-shards/' + shard + '/replay.json'));
    const rows = receipt.mutants as { file: string; id: string; status: string; divergence: string | null }[];
    assert.deepEqual(
      rows.filter((row) => row.file !== 'zz/probe.mjs'),
      [{ file, id, status: 'Survived', divergence: null }],
    );
    const canaries = rows.filter((row) => row.file === 'zz/probe.mjs');
    assert.ok(canaries.length > 0);
    assert.ok(canaries.every((row) => row.id.startsWith(shard + '/') && row.divergence !== null));
  },
);

Given('the merged report has an unprefixed canary ID {string}', function (id: string) {
  const repo = repository(this);
  const path = 'reports/mutation/mutation.json';
  const report = JSON.parse(repo.read(path));
  const [mutant] = report.files['zz/probe.mjs'].mutants;
  assert.ok(mutant);
  mutant.id = id;
  repo.write(path, JSON.stringify(report));
});

Then('replay lot {string} has a canary record for {string}', function (shard: string, id: string) {
  const repo = repository(this);
  const receipt = JSON.parse(repo.read('reports/replay-shards/' + shard + '/replay.json'));
  const matches = (receipt.mutants as { file: string; id: string }[]).filter(
    (entry) => entry.file === 'zz/probe.mjs' && entry.id === id,
  );
  assert.equal(matches.length, 1);
});

When('the gate projects the native report', function () {
  return repository(this).run(['inventory-project', '--job', 'linux']);
});

Then('the verified projection contains only the inventory mutants', function () {
  const repo = repository(this);
  const { lots } = readInventory(this);
  const projected = JSON.parse(repo.read('reports/mutation/mutation.json'));
  assert.deepEqual(
    projected.gateNativeScope,
    lots.map(({ file, whole, lines }) => ({ file, whole, lines })),
  );
  for (const lot of lots) {
    const seen = projected.files[lot.file].mutants as unknown[];
    assert.equal(seen.length, lot.mutants.length);
  }
  assert.ok(repo.exists('reports/mutation/native.json'));
});

When('the gate receives a mutation lot report with {string}', function (variant: string) {
  const repo = repository(this);
  const { lots } = readInventory(this);
  const [lot] = lots;
  assert.ok(lot);
  const source = repo.read(lot.file);
  const mutants = lot.mutants.map(({ start, end, mutatorName, replacement, ignored }, index) => ({
    id: String(index),
    status: ignored === null ? 'Killed' : 'Ignored',
    statusReason: ignored ?? undefined,
    replacement,
    mutatorName,
    location: { start, end },
  }));
  if (variant === 'omitted native file') {
    repo.write(
      'reports/mutation/mutation.json',
      JSON.stringify({ files: {}, config: { mutate: [lot.file] } }),
    );
    return;
  }
  if (variant === 'cross-file id collision' || variant === 'repeated configuration omits another file') {
    const collision = variant === 'cross-file id collision';
    const [, other] = lots;
    assert.ok(other);
    repo.write(
      'reports/mutation/mutation.json',
      JSON.stringify({
        files: {
          [lot.file]: { source, mutants },
          [other.file]: {
            source: repo.read(other.file),
            mutants: other.mutants.map(({ start, end, mutatorName, replacement }, index) => ({
              id: collision ? String(index) : 'other-' + index,
              status: 'Killed',
              mutatorName,
              replacement,
              location: { start, end },
            })),
          },
        },
        config: { mutate: [lot.file, collision ? other.file : lot.file] },
      }),
    );
    return;
  }
  const first = mutants[0];
  assert.ok(first);
  if (variant === 'missing mutant') mutants.shift();
  if (variant === 'duplicate identity') mutants.push({ ...first, id: 'duplicate' });
  if (variant === 'outside active' || variant === 'outside ignored') {
    mutants.push({
      id: 'extra',
      status: variant === 'outside active' ? 'Killed' : 'Ignored',
      statusReason: undefined,
      mutatorName: 'BooleanLiteral',
      replacement: 'false',
      location: { start: { line: 5, column: 26 }, end: { line: 5, column: 30 } },
    });
  }
  if (variant === 'ignored outside the lots') {
    // On the changed line, with a replacement the instrumenter never gives: no lot holds it.
    mutants.push({
      id: 'extra',
      status: 'Ignored',
      statusReason: 'fixture reason',
      mutatorName: 'StringLiteral',
      replacement: '"fixture"',
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 7 } },
    });
  }
  if (variant === 'ignored without reason') {
    first.status = 'Ignored';
    delete first.statusReason;
  }
  if (variant === 'active with a diagnostic') {
    first.status = 'RuntimeError';
    first.statusReason = 'fixture execution failed';
  }
  if (variant === 'native ignore drift') {
    assert.equal(first.status, 'Ignored');
    first.statusReason = 'a different reason';
  }
  if (variant === 'stale inventory') repo.write('reports/mutation-inventory.json', '{}');
  let claimedSource = source;
  if (variant === 'wrong source') claimedSource += '\n';
  if (variant === 'lone surrogate in source') claimedSource = source.replace('�', '\ud800');
  const reportPath = 'reports/mutation/mutation.json';
  const files: Record<string, { source: string; mutants: typeof mutants }> = {
    [lot.file]: { source: claimedSource, mutants },
  };
  if (variant === 'unexpected report file') files['src/unplanned.mjs'] = { source: '', mutants: [] };
  const mutate =
    variant === 'different file list'
      ? []
      : variant === 'substituted file list'
        ? ['src/unplanned.mjs']
        : variant === 'duplicated file list'
          ? [lot.file, lot.file]
          : [lot.file];
  repo.write(reportPath, JSON.stringify({ files, config: { mutate } }));
  if (variant === 'invalid UTF-8 inventory' || variant === 'invalid UTF-8 report') {
    const path = repo.path(
      variant === 'invalid UTF-8 report' ? reportPath : 'reports/mutation-inventory.json',
    );
    const valid = readFileSync(path);
    const character = Buffer.from('�');
    const i = valid.indexOf(character);
    assert(i >= 0);
    writeFileSync(
      path,
      Buffer.concat([valid.subarray(0, i), Buffer.from([255]), valid.subarray(i + character.length)]),
    );
  }
});

Given('the checked mutation projection is compact JSON', function () {
  const repo = repository(this);
  const path = 'reports/mutation/mutation.json';
  const compact = JSON.stringify(JSON.parse(repo.read(path)));
  repo.write(path, compact);
  this.state['compact mutation projection'] = compact;
});

Then('the mutation projection kept its original bytes', function () {
  assert.equal(
    repository(this).read('reports/mutation/mutation.json'),
    this.state['compact mutation projection'],
  );
});

When('the gate checks its mutation inventory', function () {
  return repository(this).run(['inventory-check', '--job', 'linux']);
});

Then('the mutation inventory check returns {string}', function (expected: string) {
  const repo = repository(this);
  assert.equal(repo.exitCode, expected === 'pass' ? 0 : 1, repo.output);
  assert.ok(repo.output.includes(expected === 'pass' ? 'lots de mutation vérifiés' : expected), repo.output);
});

Then('the independent mutation catalogue refuses empty and partly invalid sources', async function () {
  const repo = repository(this);
  const config = "export default {};\nexport const mutation = { paths: ['specs/*.feature'] };\n";
  repo.write('cucumber.mjs', config);
  repo.write('specs/empty.feature', 'Feature: no examples\n');
  await assert.rejects(mutationCatalog(repo.dir), /profil de mutation incomplet ou illisible/);
  repo.holdSpecs(['green.feature']);
  const valid = await mutationCatalog(repo.dir);
  assert.equal(valid.size, 4);
  assert.ok(valid.has('specs/green.feature:12'));
  repo.write('specs/bad.feature', 'Not a Gherkin feature\n');
  await assert.rejects(mutationCatalog(repo.dir), /profil de mutation incomplet ou illisible/);
});

Then('the aggregate rejects empty proofs, foreign coverage and conflicting source copies', async function () {
  const repo = repository(this);
  const bytes = readFileSync(join(FIXTURES, 'mutation/survivor.json'), 'utf8');
  const raw = JSON.parse(bytes) as NativeProof['raw'];
  const report = requireNativeMutationReport(bytes);
  const proof: NativeProof = { raw, report };
  const file = 'src/math.mjs';
  const copy = raw.files[file];
  assert.ok(copy !== undefined);
  const proofs = [proof, proof];
  await assert.rejects(combineNative(repo.dir, [], [], undefined), /aucun producteur de mutation/);
  await assert.rejects(
    combineNative(repo.dir, proofs, [], undefined),
    /fichier de mutation répété entre lots : src\/math\.mjs/,
  );
  const sharedCanary = await combineNative(repo.dir, proofs, [], file);
  const sharedSource = await combineNative(repo.dir, proofs, [], undefined, true);
  assert.deepEqual(sharedCanary.files, sharedSource.files);
  const shuffled: NativeProof = { report, raw: { ...raw, files: { 'src/z.mjs': copy, 'src/a.mjs': copy } } };
  const sorted = await combineNative(repo.dir, [shuffled], [], undefined);
  assert.deepEqual(Object.keys(sorted.files), ['src/a.mjs', 'src/z.mjs']);
  assert.equal(sharedSource.files[file]?.mutants.length, copy.mutants.length * 2);
  assert.deepEqual(
    sharedSource.files[file]?.mutants
      .filter(({ id }) => id.endsWith('/0'))
      .map(({ id, coveredBy }) => [id, coveredBy]),
    [
      ['1/0', ['specs/green.feature:12', 'specs/green.feature:13', 'specs/second.feature:3']],
      ['2/0', ['specs/green.feature:12', 'specs/green.feature:13', 'specs/second.feature:3']],
    ],
  );
  const second = (edit: typeof copy): NativeProof => ({ report, raw: { ...raw, files: { [file]: edit } } });
  const different = second({ ...copy, source: copy.source + '\n' });
  const foreign = second({ ...copy, mutants: [{ id: 'original', killedBy: ['foreign-id'] }] });
  for (const [other, message] of [
    [different, /fichier de mutation répété entre lots : src\/math\.mjs/],
    [foreign, /scénario de mutant absent du catalogue : foreign-id/],
  ] as const) {
    await assert.rejects(combineNative(repo.dir, [proof, other], [], undefined, true), message);
  }
  assert.throws(() => projectNative('not JSON', [], undefined), /JSON invalide/);
});

Then('the complete native union refuses missing identities and extra bookkeeping rows', async function () {
  const bytes = readFileSync(join(FIXTURES, 'mutation/survivor.json'), 'utf8');
  const report = requireNativeMutationReport(bytes);
  const file = 'src/math.mjs';
  const rows = report.files.get(file);
  assert.ok(rows !== undefined);
  const [expected, extra] = rows.mutants;
  assert.ok(expected !== undefined && extra !== undefined);
  const planned: Lot[] = [
    {
      file,
      whole: false,
      lines: [2, 3, 4],
      nativeMutants: rows.mutants.length,
      sourceSha256: createHash('sha256').update(rows.source).digest('hex'),
      mutants: [
        {
          start: { line: expected.startLine, column: expected.startColumn },
          end: { line: expected.endLine, column: expected.endColumn },
          mutatorName: expected.mutatorName,
          replacement: expected.replacement,
          ignored: null,
        },
      ],
    },
  ];
  const withMutants = (mutants: typeof rows.mutants) => ({
    ...report,
    mutate: [file],
    files: new Map([[file, { ...rows, mutants }]]),
  });
  requireCompleteMutationLots(planned, withMutants([expected]));
  assert.throws(() => requireCompleteMutationLots(planned, withMutants([])), /mutant\(s\) du lot absents/);
  const ghost = { ...extra, status: 'Ignored', statusReason: 'native bookkeeping' };
  assert.throws(
    () => requireCompleteMutationLots(planned, withMutants([expected, ghost])),
    /mutant ignoré hors projection finale : 1/,
  );
  const raw = JSON.parse(bytes) as NativeProof['raw'];
  const native = raw.files[file];
  assert.ok(native !== undefined);
  const [selected, unplanned] = native.mutants;
  assert.ok(selected !== undefined && unplanned !== undefined);
  const valid = { ...raw, files: { [file]: { ...native, mutants: [selected] } } };
  const root = repository(this).dir;
  const combined = await combineHostedNative(root, [{ raw: valid, report }], planned, file, 1);
  assert.equal(requireNativeMutationReport(combined).files.get(file)?.mutants[0]?.id, '1/0');
  await assert.rejects(
    combineHostedNative(root, [{ raw: valid, report }], planned, file, 2),
    /nombre de producteurs différent du plan hébergé/,
  );
  const withNative = (mutants: typeof native.mutants): NativeProof => ({
    raw: { ...valid, files: { [file]: { ...native, mutants } } },
    report,
  });
  await assert.rejects(
    combineHostedNative(root, [withNative([])], planned, file, 1),
    /mutant\(s\) du lot absents/,
  );
  const bookkeeping = { ...unplanned, status: 'Ignored', statusReason: 'native bookkeeping' };
  await assert.rejects(
    combineHostedNative(root, [withNative([selected, bookkeeping])], planned, file, 1),
    /mutant ignoré hors projection finale : 1\/1/,
  );
});

When('the local multiline mutation report marks its enclosing and contained mutants killed', function () {
  const repo = repository(this);
  const path = 'reports/mutation/mutation.json';
  const report = JSON.parse(repo.read(path));
  const { mutants } = report.files['src/scoped.mjs'];
  assert.ok(mutants.some((m: { location: { start: { line: number } } }) => m.location.start.line < 3));
  for (const mutant of mutants) mutant.status = 'Killed';
  repo.write(path, JSON.stringify(report));
});

When(
  'the local multiline mutation report drops its enclosing mutant and retains {int} contained mutants',
  function (contained: number) {
    const repo = repository(this);
    const path = 'reports/mutation/mutation.json';
    const report = JSON.parse(repo.read(path));
    const file = report.files['src/scoped.mjs'];
    file.mutants = file.mutants.filter(
      (m: { location: { start: { line: number } } }) => m.location.start.line === 3,
    );
    assert.equal(file.mutants.length, contained);
    repo.write(path, JSON.stringify(report));
  },
);
