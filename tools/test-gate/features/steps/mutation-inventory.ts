import assert from 'node:assert/strict';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { noopLogger } from '@stryker-mutator/util';
import { PluginKind } from '@stryker-mutator/api/plugin';
import { readNativeLotIgnorer, strykerPlugins } from '../../src/infrastructure/stryker-lot-plugin.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, Given, Then, When, repository } from './repository.js';

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
  try {
    process.chdir(repo.dir);
    const ignorer = plugin.factory();
    const file = repo.path('src/scoped.mjs');
    assert.equal(ignorer.shouldIgnore({ hub: { file: { opts: { filename: file } } }, node: {} }), undefined);
  } finally {
    process.chdir(cwd);
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
  assert.throws(() => readNativeLotIgnorer(repo.dir), { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
  writeFileSync(path, Buffer.concat([Buffer.from('\uFEFF'), valid]));
  assert.throws(() => readNativeLotIgnorer(repo.dir), SyntaxError);
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
  const plugin = readNativeLotIgnorer(repo.dir);
  assert.equal(
    plugin.shouldIgnore({ hub: { file: { opts: { filename: repo.path(file) } } }, node: {} }),
    undefined,
  );
});

Then('the whole-file plugin retains the unmutated identifier of {string}', function (file: string) {
  const repo = repository(this);
  const plugin = readNativeLotIgnorer(repo.dir);
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
      ignorers: [readNativeLotIgnorer(repo.dir)],
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
    ignorers: [readNativeLotIgnorer(repo.dir)],
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
  repo.write(
    'reports/mutation/native.json',
    JSON.stringify({ files, config: { mutate: lots.map(({ file }) => file) } }),
  );
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
