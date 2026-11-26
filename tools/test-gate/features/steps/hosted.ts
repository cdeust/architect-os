import assert from 'node:assert/strict';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { noopLogger } from '@stryker-mutator/util';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_PATH } from '../../src/infrastructure/gate.js';
import { git } from '../../src/infrastructure/git.js';
import { HOSTED_COSTS, HOSTED_LANES, planHostedSlices } from '../../src/infrastructure/hosted-lots.js';
import type { Lot } from '../../src/infrastructure/mutation-lot-proof.js';
import { requireNativeMutationReport } from '../../src/infrastructure/mutation-report.js';
import { fixtureIgnorer } from './mutation-inventory.js';
import { projectNative } from '../../src/infrastructure/mutation-shards.js';
import { mutationCatalog } from '../../src/infrastructure/mutation-catalog.js';
import { fixturePolicy, hosted, plannedLanes, writeHostedPolicy } from './hosted-plan.js';
import {
  FIXTURES,
  Given,
  Then,
  When,
  repository,
  type GateRepository,
  type GateWorld,
} from './repository.js';

/** The fixtures let every mutant open a lane, up to this many: a perimeter of several mutants fills them all. */
const MAX_LANES = 3;
const MANIFEST = 'reports/mutation-inventory.json';
const NATIVE = 'reports/mutation/native.json';
const aggregate = 'reports/mutation/mutation.json';

export const command = hosted;
const lanesOf = (world: GateWorld) => world.state['hosted lanes'] as number[];
/** What the plan job announces when it derived the same plan as the judge. */
const announced = (world: GateWorld) => JSON.stringify(lanesOf(world));
const verified = (lanes: number, verdicts: number) =>
  `plan re-dérivé : ${lanes} producteur(s) vérifié(s), ${verdicts} verdict(s) rejoué(s)\n`;

async function plan(world: GateWorld, repo: GateRepository): Promise<number[]> {
  writeHostedPolicy(repo, MAX_LANES);
  const lanes = await plannedLanes(repo);
  world.state['hosted lanes'] = lanes;
  return lanes;
}

async function nativeFixture(repo: GateRepository, file: string, retirement: boolean) {
  const { patterns, lots } = JSON.parse(repo.read(MANIFEST)) as { patterns: string[]; lots: Lot[] };
  const instrumenter = new Instrumenter(noopLogger);
  const sources = lots.map(({ file }) => ({
    name: repo.path(file),
    content: repo.read(file),
    mutate:
      patterns.includes(file) ||
      patterns
        .filter((pattern) => pattern.startsWith(file + ':'))
        .map((pattern) => {
          const [startLine, startColumn, endLine, endColumn] = (
            pattern.match(/:(\d+):(\d+)-(\d+):(\d+)$/)?.slice(1) ?? []
          ).map(Number);
          return {
            start: { line: Number(startLine) - 1, column: Number(startColumn) },
            end: { line: Number(endLine) - 1, column: Number(endColumn) },
          };
        }),
  }));
  const { mutants } = await instrumenter.instrument(sources, {
    plugins: null,
    excludedMutations: [],
    ignorers: [fixtureIgnorer(repo)],
  });
  const toReport = ({ line, column }: { line: number; column: number }) => ({
    line: line + 1,
    column: column + 1,
  });
  const files = Object.fromEntries(
    lots.map(({ file }) => [
      file,
      {
        source: repo.read(file),
        mutants: mutants
          .filter((mutant) => mutant.fileName === repo.path(file))
          .map((mutant) => ({
            id: mutant.id,
            mutatorName: mutant.mutatorName,
            replacement: mutant.replacement,
            status: mutant.status ?? (retirement && file === 'src/math.mjs' ? 'Killed' : 'Survived'),
            killedBy: retirement && file === 'src/math.mjs' ? ['1'] : [],
            statusReason: mutant.statusReason,
            static: false,
            coveredBy: ['1'],
            location: { start: toReport(mutant.location.start), end: toReport(mutant.location.end) },
          })),
      },
    ]),
  );
  const catalogue = JSON.parse(readFileSync(join(FIXTURES, 'mutation/survivor.json'), 'utf8'));
  repo.write(file, JSON.stringify({ files, testFiles: catalogue.testFiles, config: { mutate: patterns } }));
}

When('the one hosted lane of an empty perimeter completes with the proof of its canary', async function () {
  const repo = repository(this);
  const lanes = await plan(this, repo);
  assert.deepEqual(lanes, [1]);
  const file = 'zz/probe.mjs';
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const expected: string[] = [];
  for (const lane of lanes) {
    const inventory = await command(repo, 'inventory', String(lane));
    assert.equal(inventory.status, 0, inventory.output);
    await nativeFixture(repo, NATIVE, false);
    const manifest = repo.read(MANIFEST);
    const report = repo.read(NATIVE);
    const native = JSON.parse(report).files[file].mutants as { id: string; status: string }[];
    assert.ok(native.length > 0);
    assert.ok(native.every(({ status }) => status === 'Survived'));
    const producer = 'canary proof from runner ' + lane;
    const directory = 'reports/mutation-shards/' + lane + '/';
    repo.write(directory + 'mutation-inventory.json', manifest);
    repo.write(directory + 'mutation/native.json', report);
    repo.write(directory + 'producer', producer);
    const mutants = native.map(({ id, status }) => ({ file, id, status, divergence: null }));
    repo.write(
      'reports/replay-shards/' + lane + '/replay.json',
      JSON.stringify({
        producer: digest(producer),
        manifest: digest(manifest),
        record: { report: digest(report), mutants },
      }),
    );
    expected.push(...mutants.map(({ id }) => lane + '/' + id));
  }
  this.state['qualified canary ids'] = expected.sort();
});

Then('the hosted collector judges the empty perimeter on that one receipt', async function () {
  const repo = repository(this);
  const collected = await command(repo, 'collect', announced(this));
  const expected = this.state['qualified canary ids'] as string[];
  assert.equal(collected.status, 0, collected.output);
  assert.equal(collected.output, verified(1, expected.length));
  const report = repo.read(aggregate);
  const receipt = JSON.parse(repo.read('reports/mutation/replay.json'));
  assert.equal(receipt.report, createHash('sha256').update(report).digest('hex'));
  assert.deepEqual(Object.keys(JSON.parse(report).files), ['zz/probe.mjs']);
  assert.deepEqual(receipt.mutants.map(({ id }: { id: string }) => id).sort(), expected);
});

Then('the hosted collector rejects an active mutant without static metadata', async function () {
  const repo = repository(this);
  const path = 'reports/mutation-shards/1/mutation/native.json';
  const original = repo.read(path);
  const report = JSON.parse(original);
  delete report.files['zz/probe.mjs'].mutants[0].static;
  const incomplete = JSON.stringify(report);
  const { lots, patterns } = JSON.parse(repo.read('reports/mutation-shards/1/mutation-inventory.json')) as {
    lots: Lot[];
    patterns: string[];
  };
  assert.throws(
    () => requireNativeMutationReport(JSON.stringify(projectNative(incomplete, lots, patterns).raw)),
    /marquage statique absent pour un mutant actif/,
  );
  repo.write(path, incomplete);
  try {
    const refused = await command(repo, 'collect', announced(this));
    assert.equal(refused.status, 1, refused.output);
    assert.match(refused.output, /marquage statique absent pour un mutant actif/);
    assert.equal(repo.exists(aggregate), false);
    assert.equal(repo.exists('reports/mutation/replay.json'), false);
  } finally {
    repo.write(path, original);
  }
});

Then('the hosted lane independently confirms its runtime witness against the original', async function () {
  const repo = repository(this);
  const file = 'src/runtime.mjs';
  const source = 'export const enabled = true;\n';
  const feature = 'specs/runtime.feature';
  repo.write(file, source);
  repo.write(
    feature,
    [
      'Feature: runtime witness',
      '  Scenario: failure on the mutant alone',
      '    Given the runtime flag is read',
      ...Array.from({ length: 23 }, (_, index) => [
        '  Scenario: trailing ' + index,
        '    Given a trailing scenario passes',
      ]).flat(),
      '',
    ].join('\n'),
  );
  repo.write(
    'specs/steps/steps.mjs',
    "import { Given } from '@cucumber/cucumber';\n" +
      "import { enabled } from '../../src/runtime.mjs';\n" +
      "Given('the runtime flag is read', () => { if (!enabled) throw new TypeError('disabled fixture'); });\n" +
      "Given('a trailing scenario passes', () => {});\n",
  );
  const control = 'specs/control.feature';
  repo.write(
    control,
    'Feature: canary control\n  Scenario: control passes\n    Given a trailing scenario passes\n',
  );
  repo.commit('runtime witness fixture');
  writeHostedPolicy(repo, MAX_LANES);
  const catalog = await mutationCatalog(repo.dir);
  assert.equal(catalog.size, 25);
  const tests = [...catalog]
    .filter((location) => location.startsWith(feature + ':'))
    .map((location, index) => ({
      id: String(index),
      location: { start: { line: Number(location.slice(feature.length + 1)), column: 3 } },
    }));
  const lane = '1';
  const inventory = await command(repo, 'inventory', lane);
  assert.equal(inventory.status, 0, inventory.output);
  await nativeFixture(repo, NATIVE, false);
  const native = JSON.parse(repo.read(NATIVE));
  assert.equal(native.files[file].mutants.length, 1);
  const confirmed = native.files[file].mutants[0];
  assert.equal(confirmed.mutatorName, 'BooleanLiteral');
  confirmed.status = 'RuntimeError';
  confirmed.static = true;
  confirmed.coveredBy = tests.map(({ id }) => id);
  native.testFiles = {
    [feature]: { tests },
    [control]: { tests: [{ id: 'canary-control', location: { start: { line: 2, column: 3 } } }] },
  };
  const other = native.files['zz/probe.mjs'].mutants as { coveredBy: string[] }[];
  for (const mutant of other) mutant.coveredBy = ['canary-control'];
  const origin = 'reports/mutation-shards/' + lane + '/';
  repo.write(origin + 'mutation-inventory.json', repo.read(MANIFEST));
  repo.write(origin + 'mutation/native.json', JSON.stringify(native));
  repo.write(origin + 'producer', 'independent producer for the runtime fixture');
  const replay = await command(repo, 'replay', lane);
  assert.equal(replay.status, 0, replay.output);
  const receipt = JSON.parse(repo.read('reports/replay-shards/' + lane + '/replay.json'));
  assert.deepEqual(
    receipt.record.mutants.find((entry: { file: string }) => entry.file === file),
    {
      file,
      id: confirmed.id,
      status: 'RuntimeError',
      divergence: null,
    },
  );
  const work = 'reports/replay';
  const runtime = readdirSync(repo.path(work))
    .filter((name) => name.endsWith('.ndjson'))
    .map((name) => repo.read(work + '/' + name))
    .filter((messages) => messages.includes(JSON.stringify(feature)));
  assert.equal(runtime.length, 3);
  const singletons = runtime.filter(
    (messages) => messages.split('\n').filter((line) => line.includes('"testCaseStarted":')).length === 1,
  );
  assert.equal(singletons.length, 2);
  assert.equal(repo.read(file), source);
});

When('the hosted mutation chains complete independently in {string} mode', async function (mode: string) {
  const repo = repository(this);
  const lanes = await plan(this, repo);
  assert.equal(lanes.length, MAX_LANES);
  const disjoint = new Set<string>();
  let split = 0;
  for (const lane of lanes) {
    const inventory = await command(repo, 'inventory', String(lane));
    assert.equal(inventory.status, 0, inventory.output);
    const manifest = JSON.parse(repo.read(MANIFEST)) as { lots: Lot[]; patterns: string[] };
    assert.equal(
      inventory.output,
      'lot ' +
        lane +
        ' : ' +
        manifest.lots.length +
        ' fichier(s), ' +
        manifest.patterns.length +
        ' plage(s)\n',
    );
    const nested = manifest.lots.find(({ file }) => file === 'src/nested.mjs');
    if (nested !== undefined) {
      split++;
      for (const mutant of nested.mutants) {
        const identity = JSON.stringify(mutant);
        assert.ok(!disjoint.has(identity));
        disjoint.add(identity);
      }
    }
    await nativeFixture(repo, NATIVE, mode === 'debt retirement');
    repo.write(aggregate, 'earlier aggregate');
    repo.write('reports/mutation/replay.json', 'earlier replay');
    const verified = await command(repo, 'verify', String(lane));
    assert.equal(verified.status, 0, verified.output);
    assert.equal(verified.output, 'lot natif ' + lane + ' vérifié\n');
    assert.equal(repo.read(aggregate), 'earlier aggregate');
    assert.equal(repo.read('reports/mutation/replay.json'), 'earlier replay');
    const directory = 'reports/mutation-shards/' + lane;
    repo.write(directory + '/mutation-inventory.json', repo.read(MANIFEST));
    repo.write(directory + '/mutation/native.json', repo.read(NATIVE));
    repo.write(directory + '/producer', 'first producer attempt for lane ' + lane);
    repo.write('reports/replay/stale', 'leftover from a previous run');
    const replayed = await command(repo, 'replay', String(lane));
    assert.equal(replayed.status, 0, replayed.output);
    assert.equal(repo.exists('reports/replay/stale'), false);
    const output = 'reports/replay-shards/' + lane;
    const { producer, manifest: planned, record } = JSON.parse(repo.read(output + '/replay.json'));
    const timings = JSON.parse(repo.read(output + '/timings.json'));
    assert.equal(timings.producer, producer);
    assert.equal(timings.manifest, planned);
    assert.equal(timings.report, record.report);
    assert.deepEqual(
      timings.mutants.map(({ elapsedMs, ...key }: { elapsedMs: number }) => {
        assert.ok(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0);
        return key;
      }),
      record.mutants.map(({ divergence: _divergence, ...key }: { divergence: string | null }) => key),
    );
  }
  if (mode === 'changed lines') assert.ok(split > 1);
});

Then('the hosted verdict has all independently replayed mutations', async function () {
  const repo = repository(this);
  const accepted = await command(repo, 'collect', announced(this));
  assert.equal(accepted.status, 0, accepted.output);
  const combined = JSON.parse(repo.read(aggregate));
  const entries = JSON.parse(repo.read('reports/mutation/replay.json')).mutants as {
    file: string;
    id: string;
    divergence: string | null;
  }[];
  assert.equal(accepted.output, verified(lanesOf(this).length, entries.length));
  assert.ok(entries.every((entry) => entry.divergence === null));
  assert.equal(
    entries.length,
    Object.values(combined.files).reduce(
      (sum: number, value) => sum + (value as { mutants: unknown[] }).mutants.length,
      0,
    ),
  );
  assert.ok(entries.some(({ file }) => file === 'src/nested.mjs'));
  assert.deepEqual([...new Set(entries.map(({ id }) => Number(id.split('/')[0])))].sort(), lanesOf(this));
});

Then('a replaced producer or a missing receipt cannot reuse the hosted verdict', async function () {
  const repo = repository(this);
  const last = lanesOf(this).at(-1) as number;
  const goodReceiptPath = 'reports/replay-shards/' + last + '/replay.json';
  const goodReceipt = repo.read(goodReceiptPath);
  const differentManifest = JSON.parse(goodReceipt);
  differentManifest.manifest = '0'.repeat(64);
  repo.write(goodReceiptPath, JSON.stringify(differentManifest));
  const refused = await command(repo, 'collect', announced(this));
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, new RegExp('provenance du rejeu différente pour le lot ' + last));
  assert.equal(repo.exists('reports/mutation/replay.json'), false);

  for (const field of ['producer', 'manifest']) {
    const complete = JSON.parse(goodReceipt);
    const digest = complete[field] as string;
    for (const value of ['x' + digest, digest + 'x']) {
      repo.write(goodReceiptPath, JSON.stringify({ ...complete, [field]: value }));
      const malformed = await command(repo, 'collect', announced(this));
      assert.equal(malformed.status, 1, malformed.output);
      assert.match(malformed.output, /hors schéma/);
      assert.ok(malformed.output.includes(field), malformed.output);
    }
  }
  repo.write(goodReceiptPath, goodReceipt);
  const origin = 'reports/mutation-shards/1/producer';
  const proof = repo.read(origin);
  repo.write(origin, 'replacement producer attempt');
  const stale = await command(repo, 'collect', announced(this));
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.output, /provenance du rejeu différente pour le lot 1/);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
  repo.write(origin, proof);
  const receipt = goodReceiptPath;
  repo.write(receipt, '{}');
  const invalid = await command(repo, 'collect', announced(this));
  assert.equal(invalid.status, 1, invalid.output);
  assert.match(invalid.output, /hors schéma/);
  repo.remove(receipt);
  const missing = await command(repo, 'collect', announced(this));
  assert.equal(missing.status, 1, missing.output);
  assert.ok(missing.output.includes(goodReceiptPath + ' absent'), missing.output);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
  repo.write(receipt, goodReceipt);
});

Then('the retirement retains whole-file proof and replays only the canary', async function () {
  const repo = repository(this);
  const collected = await command(repo, 'collect', announced(this));
  assert.equal(collected.status, 0, collected.output);
  const combined = JSON.parse(repo.read(aggregate));
  assert.ok(combined.files['src/math.mjs'].mutants.length > 1);
  assert.deepEqual(
    combined.gateNativeScope.find(({ file }: { file: string }) => file === 'src/math.mjs'),
    {
      file: 'src/math.mjs',
      whole: true,
      lines: [],
    },
  );
  assert.ok(
    combined.gateNativeScope.some(
      ({ file, whole }: { file: string; whole: boolean }) => file === 'src/math.mjs' && whole,
    ),
  );
  const entries = JSON.parse(repo.read('reports/mutation/replay.json')).mutants as { file: string }[];
  assert.ok(entries.length > 0);
  assert.ok(entries.every(({ file }) => file === 'zz/probe.mjs'));
});

Then('a second collection without a canary invalidates the old verdict', async function () {
  const repo = repository(this);
  const config = JSON.parse(repo.read(CONFIG_PATH));
  delete config.canary;
  repo.write(CONFIG_PATH, JSON.stringify(config));
  const rejected = await command(repo, 'collect', announced(this));
  assert.equal(rejected.status, 1, rejected.output);
  assert.match(rejected.output, /configuration Linux sans canari/);
  assert.equal(repo.exists(aggregate), false);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
  delete config.replay;
  repo.write(CONFIG_PATH, JSON.stringify(config));
  repo.write(aggregate, 'another earlier aggregate');
  const absentReplay = await command(repo, 'collect', announced(this));
  assert.equal(absentReplay.status, 1, absentReplay.output);
  assert.match(absentReplay.output, /configuration Linux sans canari, mutation ou rejeu/);
  assert.equal(repo.exists(aggregate), false);
});

Given('only the second fixture exercises the nested return value', function () {
  const repo = repository(this);
  const feature = 'specs/second.feature';
  repo.write(feature, repo.read(feature) + '    And the nested return value is true\n');
  const steps = 'specs/steps/steps.mjs';
  repo.write(
    steps,
    repo.read(steps) +
      "import { pick } from '../../src/nested.mjs';\n" +
      "Given('the nested return value is true', () => assert.equal(pick('present'), true));\n",
  );
});

Then('the static mutant contradicts a limited coverage claim', async function () {
  const repo = repository(this);
  for (const lane of lanesOf(this)) {
    const path = 'reports/mutation-shards/' + lane + '/mutation/native.json';
    const original = repo.read(path);
    const report = JSON.parse(original);
    const mutant = report.files['src/nested.mjs']?.mutants.find(
      (candidate: { replacement: string; status: string }) =>
        candidate.replacement === 'false' && candidate.status === 'Survived',
    );
    if (mutant === undefined) continue;
    const replay = 'reports/replay-shards/' + lane + '/replay.json';
    const originalReceipt = repo.read(replay);
    try {
      delete mutant.static;
      repo.write(path, JSON.stringify(report));
      const unknown = await command(repo, 'replay', String(lane));
      assert.equal(unknown.status, 1, unknown.output);
      assert.match(unknown.output, /marquage statique absent/);
      assert.equal(repo.exists(replay), false);
      mutant.static = true;
      repo.write(path, JSON.stringify(report));
      const rechecked = await command(repo, 'replay', String(lane));
      assert.equal(rechecked.status, 0, rechecked.output);
      assert.match(rechecked.output, /1 divergence/);
      const refused = await command(repo, 'collect', announced(this));
      assert.equal(refused.status, 1, refused.output);
      assert.match(refused.output, /lot [1-3] : .*Survived selon l'outil/);
    } finally {
      repo.write(path, original);
      repo.write(replay, originalReceipt);
    }
    return;
  }
  assert.fail('no native BooleanLiteral survivor');
});

Then('hosted planning keeps peers together and preserves a deeply nested file', function () {
  const point = (line: number, column: number) => ({ line, column });
  const candidate = (line: number, end: number, replacement: string) => ({
    start: point(line, 2),
    end: point(end, 3),
    mutatorName: 'fixture',
    replacement,
    ignored: null,
  });
  const peers = [candidate(2, 6, 'a'), candidate(2, 6, 'b')];
  const inside = candidate(2, 5, 'c');
  const innermost = candidate(4, 4, 'd');
  const disjoint = candidate(1, 1, 'e');
  const file = 'src/fixture.mjs';
  const canary = 'zz/probe.mjs';
  const lot = (file: string, mutants: Lot['mutants']): Lot => ({
    file,
    mutants,
    sourceSha256: 'unused source digest in planning',
    whole: true,
    lines: [1, 2, 3, 4, 5, 6],
    nativeMutants: mutants.length,
  });
  const input = [lot(file, [innermost, inside, disjoint, ...peers]), lot(canary, [innermost])];
  const costs = { files: {}, fallback: 1 };
  const read = () => '#!\n(() =>\n () =>\n  true\n )\n);\n';
  // Five mutants worth one lane each: the plan opens as many lanes as it is allowed.
  const atMost = (maxLanes: number) => ({ loadTimeMutantMs: 1, laneTargetMs: 1, maxLanes });
  const plan = (count: number) => planHostedSlices(input, canary, read, costs, atMost(count));
  assert.throws(() => planHostedSlices(input.slice(0, 1), canary, read, costs, atMost(3)), /canari absent/);

  const admitted = (operation: () => ReturnType<typeof plan>) => {
    let result: ReturnType<typeof plan> | undefined;
    assert.doesNotThrow(() => {
      result = operation();
    }, 'a valid hierarchy must produce its complete native slices');
    assert.ok(result);
    return result;
  };
  const slices = admitted(() => plan(3));
  assert.equal(slices.length, 3);
  assert.ok(slices.every((slice) => slice.lots.some(({ file }) => file === canary)));
  assert.deepEqual(
    slices.flatMap(({ patterns }) => patterns.filter((pattern) => pattern !== canary)).sort(),
    [file + ':1:1-1:2', file + ':2:1-5:2', file + ':2:1-6:2', file + ':4:1-4:2'],
  );
  const planned = slices.map(({ lots }) => lots.find((lot) => lot.file === file));
  assert.ok(planned.every((lot) => lot?.whole === false));
  const spans = planned.map((lot) => new Set(lot?.mutants.map(({ replacement }) => replacement)));
  assert.ok(spans.some((bucket) => bucket.has('a') && bucket.has('b')));
  assert.equal(spans.filter((bucket) => ['a', 'c', 'd'].some((id) => bucket.has(id))).length, 3);

  const fallback = admitted(() => plan(2));
  // Nested deeper than the two lanes allowed, the file stays whole in one, and the other is not opened.
  assert.equal(fallback.length, 1);
  assert.equal(fallback.flatMap(({ lots }) => lots.filter((lot) => lot.file === file)).length, 1);
  assert.deepEqual(fallback[0]?.patterns, [file, canary]);
  assert.equal(fallback[0]?.lots[0], input[0]);

  const sibling = 'src/unrelated.mjs';
  const loaded = admitted(() =>
    planHostedSlices([...input, lot(sibling, [innermost])], canary, read, costs, atMost(2)),
  );
  assert.equal(loaded.length, 2);
  assert.ok(loaded.some(({ lots }) => lots.some((entry) => entry.file === file)));
  assert.ok(loaded.some(({ lots }) => lots.some((entry) => entry.file === sibling)));
  assert.ok(
    !loaded.some(
      ({ lots }) => lots.some((entry) => entry.file === file) && lots.some((entry) => entry.file === sibling),
    ),
  );
});

Then('hosted admission preserves unrelated receipts and rejects invalid lane arguments', async function () {
  const repo = repository(this);
  const invoke = (...args: string[]) => command(repo, ...args);
  const selected = 'reports/replay-shards/1/replay.json';
  const other = 'reports/replay-shards/2/replay.json';
  repo.write(selected, 'receipt for lane 1');
  repo.write(other, 'receipt for lane 2');
  assert.deepEqual(await plan(this, repo), [1]);
  for (const args of [
    [],
    ['verify'],
    ['replay', '0'],
    ['inventory', '01'],
    ['inventory', '-1'],
    ['inventory', ' 1'],
    ['inventory', '3junk'],
    ['inventory', '1.0'],
    ['inventory', '1e1'],
    ['inventory', '1000'],
    ['inventory', '1', 'extra'],
    ['collect'],
    ['collect', '[1]', 'extra'],
    ['lanes', '1'],
    ['unknown', '1'],
  ]) {
    const bad = await invoke(...args);
    assert.equal(bad.status, 1, JSON.stringify(args));
    assert.equal(
      bad.output,
      'porte de test hébergée : usage : hosted-gate lanes | inventory|verify|replay <lot> | collect <plan annoncé>\n',
      JSON.stringify(args),
    );
  }
  assert.equal(repo.read(selected), 'receipt for lane 1');
  // The highest number a matrix can hold is still read as a lane, and refused for the plan.
  for (const outside of ['2', '256', '999']) {
    const unplanned = await invoke('verify', outside);
    assert.equal(unplanned.status, 1, unplanned.output);
    assert.equal(
      unplanned.output,
      'porte de test hébergée : lot ' + outside + ' hors du plan re-dérivé (1 lot(s))\n',
    );
  }
  const unproduced = await invoke('verify', '1');
  assert.equal(unproduced.status, 1, unproduced.output);
  assert.match(unproduced.output, /inventaire différent du périmètre courant pour le lot 1/);
  const cost = repo.read(HOSTED_COSTS);
  writeFileSync(
    repo.path(HOSTED_COSTS),
    Buffer.concat([
      Buffer.from('{"fallback":1,"files":{},"reference":"'),
      Buffer.from([255]),
      Buffer.from('"}'),
    ]),
  );
  const invalidEncoding = await invoke('inventory', '1');
  assert.equal(invalidEncoding.status, 1, invalidEncoding.output);
  assert.match(invalidEncoding.output, /utf-8/i);
  assert.equal(repo.exists(MANIFEST), false);
  repo.write(HOSTED_COSTS, cost);
  const valid = await invoke('inventory', '1');
  assert.equal(valid.status, 0, valid.output);
  assert.equal(JSON.parse(repo.read(MANIFEST)).lane, 1);
  assert.equal(repo.read(selected), 'receipt for lane 1');
  assert.equal(repo.read(other), 'receipt for lane 2');
  const replayed = await invoke('replay', '1');
  assert.equal(replayed.status, 1, replayed.output);
  assert.match(replayed.output, /inventaire différent du périmètre courant pour le lot 1/);
  assert.equal(repo.exists(selected), false);
  assert.equal(repo.read(other), 'receipt for lane 2');
  // A new plan replaces the announced one, and touches neither a manifest nor a receipt.
  repo.write('reports/mutation-lanes.json', 'an earlier plan');
  const manifest = repo.read(MANIFEST);
  assert.deepEqual(await plannedLanes(repo), [1]);
  assert.equal(repo.read(MANIFEST), manifest);
  assert.equal(repo.read(other), 'receipt for lane 2');
});

Then('hosted admission refuses broken configuration and debt at either revision', async function () {
  const repo = repository(this);
  writeHostedPolicy(repo, MAX_LANES);
  const config = repo.read(CONFIG_PATH);
  const debt = 'mutation-debt.json';
  const validDebt = repo.read(debt);
  async function refuses(text: string | RegExp) {
    const rejected = await command(repo, 'inventory', '1');
    assert.equal(rejected.status, 1, rejected.output);
    if (typeof text === 'string') assert.ok(rejected.output.includes(text), rejected.output);
    else assert.match(rejected.output, text);
    assert.equal(repo.exists(MANIFEST), false);
  }
  repo.write(CONFIG_PATH, '\uFEFF' + config);
  await refuses(/JSON invalide/);
  repo.write(CONFIG_PATH, JSON.stringify({ ...JSON.parse(config), jobs: {} }));
  await refuses('configuration Linux sans canari, mutation ou rejeu');
  for (const key of ['canary', 'replay']) {
    const incomplete = JSON.parse(config);
    delete incomplete[key];
    repo.write(CONFIG_PATH, JSON.stringify(incomplete));
    await refuses('configuration Linux sans canari, mutation ou rejeu');
  }
  repo.write(CONFIG_PATH, config);
  const root = await command(repo, 'inventory', '1');
  assert.equal(root.status, 0, root.output);
  repo.write(debt, '{');
  await refuses('registre de dette illisible');
  repo.commit('unreadable parent debt');
  repo.write(debt, validDebt);
  repo.commit('valid current debt');
  await refuses('registre de dette illisible');
});

Then('hosted planning balances measured spans and contains only within the same source', function () {
  const canary = 'zz/probe.mjs';
  const mutant = {
    start: { line: 2, column: 2 },
    end: { line: 2, column: 8 },
    // Each mutant spans a body of its own: none is taken to run when the module loads.
    mutatorName: 'ArrowFunction',
    replacement: 'next',
    ignored: null,
  };
  const lot = (file: string, variants: Lot['mutants'] = [mutant]): Lot => ({
    file,
    mutants: variants,
    sourceSha256: file,
    whole: true,
    lines: [2],
    nativeMutants: variants.length,
  });
  const measured = 'src/measured.mjs';
  const fileFallback = 'src/file-fallback.mjs';
  const globalFallback = 'src/global-fallback.mjs';
  const ignored = 'src/ignored.mjs';
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(['target', mutant.mutatorName, mutant.replacement]))
    .digest('hex')
    .slice(0, 16);
  const costs = {
    fallback: 1,
    files: {
      [measured]: { fallback: 2, samples: { [fingerprint]: 80 } },
      [fileFallback]: { fallback: 30, samples: {} },
      [ignored]: { fallback: 100, samples: {} },
    },
  };
  const read = () => 'preceding line\n target;\n';
  const input = [
    lot(fileFallback),
    lot(globalFallback),
    lot(measured),
    lot(ignored, [{ ...mutant, ignored: 'a native reason' }]),
    lot(canary),
  ];
  const atMost = (maxLanes: number) => ({ loadTimeMutantMs: 1000, laneTargetMs: 1, maxLanes });
  const files = (count: number) =>
    planHostedSlices(input, canary, read, costs, atMost(count)).map(({ lots }) =>
      lots.map(({ file }) => file).filter((file) => file !== canary),
    );
  assert.deepEqual(files(2), [[measured], [fileFallback, globalFallback, ignored]]);
  assert.deepEqual(files(1), [[measured, fileFallback, globalFallback, ignored]]);

  const file = 'src/timing.mjs';
  const first = { ...mutant, replacement: 'first' };
  const later = {
    ...mutant,
    start: { line: 3, column: 2 },
    end: { line: 3, column: 8 },
    replacement: 'later',
  };
  const fingerprintOf = (fragment: string, replacement: string) =>
    createHash('sha256')
      .update(JSON.stringify([fragment, mutant.mutatorName, replacement]))
      .digest('hex')
      .slice(0, 16);
  const reverse = {
    fallback: 1,
    files: { [file]: { fallback: 1, samples: { [fingerprintOf('latest', 'later')]: 80 } } },
  };
  const weightedRead = () => 'preceding line\n target;\n latest;\n';
  const rearranged = planHostedSlices(
    [lot(file, [first, later]), lot(canary)],
    canary,
    weightedRead,
    reverse,
    atMost(1),
  );
  assert.deepEqual(
    rearranged[0]?.lots.find((item) => item.file === file)?.mutants.map(({ replacement }) => replacement),
    ['later', 'first'],
  );

  const outer = { ...first, end: { line: 3, column: 9 } };
  const nesting = planHostedSlices(
    [lot(file, [outer, { ...later, end: outer.end }]), lot(measured), lot(canary)],
    canary,
    weightedRead,
    { ...costs, fallback: 2 },
    atMost(2),
  );
  assert.equal(nesting.filter(({ lots }) => lots.some((item) => item.file === file)).length, 2);
  const withMeasured = nesting.find(({ lots }) => lots.some((item) => item.file === measured));
  assert.equal(withMeasured?.lots.find((item) => item.file === file)?.mutants[0]?.replacement, 'later');

  const mid = { ...costs.files[fileFallback], fallback: 7 };
  const flipped = planHostedSlices(
    [lot(measured), lot(fileFallback), lot(globalFallback), lot(canary)],
    canary,
    read,
    {
      fallback: 6,
      files: { [measured]: { fallback: 8, samples: {} }, [fileFallback]: mid },
    },
    atMost(2),
  );
  assert.deepEqual(
    flipped[0]?.lots.map(({ file }) => file),
    [canary, fileFallback, globalFallback],
  );

  const equal = planHostedSlices(
    [lot(measured), lot(fileFallback), lot(canary)],
    canary,
    read,
    { fallback: 1, files: {} },
    atMost(2),
  );
  assert.deepEqual(
    equal.map(({ lots }) => lots.map(({ file }) => file)),
    [
      [canary, measured],
      [canary, fileFallback],
    ],
  );

  const empty = planHostedSlices([lot(file, []), lot(canary)], canary, read, costs, atMost(2));
  assert.equal(empty.length, 1);
  assert.deepEqual(empty[0]?.patterns, [file, canary]);
  assert.equal(empty[0]?.lots[0]?.whole, true);
});

Then('each hosted producer must match its committed inventory and canary', async function () {
  const repo = repository(this);
  const directory = 'reports/mutation-shards/1/';
  const native = directory + 'mutation/native.json';
  const manifestPath = directory + 'mutation-inventory.json';
  const receiptPath = 'reports/replay-shards/1/replay.json';
  const timing = 'reports/replay-shards/1/timings.json';
  const earlierTiming = repo.read(timing);
  const original = repo.read(native);
  const manifest = repo.read(manifestPath);
  const receipt = repo.read(receiptPath);
  try {
    repo.write(manifestPath, manifest + '\n');
    const wrongTree = await command(repo, 'replay', '1');
    assert.equal(wrongTree.status, 1, wrongTree.output);
    assert.match(wrongTree.output, /inventaire différent du périmètre courant pour le lot 1/);
    assert.equal(repo.exists(timing), false);
    assert.equal(repo.exists(receiptPath), false);
    repo.write(manifestPath, manifest);
    const report = JSON.parse(original);
    for (const mutant of report.files['zz/probe.mjs'].mutants) mutant.status = 'NoCoverage';
    repo.write(native, JSON.stringify(report));
    const wrongCanary = await command(repo, 'replay', '1');
    assert.equal(wrongCanary.status, 1, wrongCanary.output);
    assert.match(wrongCanary.output, /canari de mutation refusé dans le lot 1/);
    assert.equal(repo.exists(receiptPath), false);
  } finally {
    repo.write(manifestPath, manifest);
    repo.write(native, original);
    repo.write(receiptPath, receipt);
    repo.write(timing, earlierTiming);
  }
});

Then('the hosted collector reports both independent divergences on separate lines', async function () {
  const repo = repository(this);
  const paths = [1, 2].map((lane) => 'reports/replay-shards/' + lane + '/replay.json');
  const original = paths.map((path) => repo.read(path));
  try {
    for (const [index, path] of paths.entries()) {
      const receipt = JSON.parse(original[index] as string);
      receipt.record.mutants[0].divergence = 'independent replay disagreement';
      repo.write(path, JSON.stringify(receipt));
    }
    const failure = await command(repo, 'collect', announced(this));
    assert.equal(failure.status, 1, failure.output);
    const lines = failure.output
      .split('\n')
      .filter((line) => line.includes('independent replay disagreement'));
    assert.equal(lines.length, 2, failure.output);
    assert.match(lines[0] as string, /^porte de test hébergée : lot 1 : /);
    assert.match(lines[1] as string, /lot 2 : /);
    assert.equal(repo.exists('reports/mutation/replay.json'), false);
  } finally {
    for (const [index, path] of paths.entries()) repo.write(path, original[index] as string);
  }
});

/** The judge is red, names `reason`, and leaves neither an aggregate report nor a replay record to read. */
async function refusedByJudge(world: GateWorld, reason: RegExp, announcement = announced(world)) {
  const repo = repository(world);
  const refused = await command(repo, 'collect', announcement);
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, reason);
  assert.equal(repo.exists(aggregate), false);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
}

/** Moves a path of the report tree away for the time of `during`, then puts it back. */
async function without(repo: GateRepository, path: string, during: () => Promise<void>) {
  const aside = repo.path('reports/aside-' + path.replaceAll('/', '-'));
  renameSync(repo.path(path), aside);
  try {
    await during();
  } finally {
    renameSync(aside, repo.path(path));
  }
}

Then(
  'a plan announced with fewer lanes, more lanes, another order, another spelling or nothing is refused',
  async function () {
    const lanes = lanesOf(this);
    const different = new RegExp(
      `^porte de test hébergée : plan annoncé différent du plan re-dérivé \\(${lanes.length} lot\\(s\\)\\)\\n$`,
    );
    for (const announcement of [
      JSON.stringify(lanes.slice(0, -1)),
      JSON.stringify(lanes.slice(1)),
      JSON.stringify([...lanes, lanes.length + 1]),
      JSON.stringify([...lanes].reverse()),
      JSON.stringify(lanes, null, 1),
      '[' + lanes.join(', ') + ']',
      announced(this) + '\n',
      String(lanes.length),
      String(lanes.length + 1),
      '[]',
      '',
    ])
      await refusedByJudge(this, different, announcement);
  },
);

Then('the judge distinguishes a missing shard directory from a regular file', async function () {
  const repo = repository(this);
  const directory = 'reports/mutation-shards';
  await without(repo, directory, async () => {
    await refusedByJudge(this, /inventaire différent du périmètre courant pour le lot 1/);
    repo.write(directory, 'regular file');
    try {
      await refusedByJudge(this, /\bENOTDIR\b/);
    } finally {
      repo.remove(directory);
    }
  });
});

Then('a planned lane without its producer or without its receipt is refused', async function () {
  const repo = repository(this);
  for (const lane of lanesOf(this)) {
    await without(repo, 'reports/mutation-shards/' + lane, () =>
      refusedByJudge(this, new RegExp('inventaire différent du périmètre courant pour le lot ' + lane)),
    );
    await without(repo, 'reports/replay-shards/' + lane, () =>
      refusedByJudge(this, new RegExp(`reports/replay-shards/${lane}/replay\\.json absent`)),
    );
  }
});

Then('a receipt for a lane outside the plan is refused', async function () {
  const repo = repository(this);
  const outside = String(lanesOf(this).length + 1);
  for (const directory of ['reports/mutation-shards', 'reports/replay-shards']) {
    for (const name of [outside, '0', 'unnumbered']) {
      cpSync(repo.path(directory + '/1'), repo.path(directory + '/' + name), { recursive: true });
      try {
        await refusedByJudge(
          this,
          new RegExp(`^porte de test hébergée : reçu hors du plan re-dérivé dans ${directory}\\n$`),
        );
      } finally {
        repo.remove(directory + '/' + name);
      }
    }
  }
});

Then('the receipt or the producer of one lane presented for another is refused', async function () {
  const repo = repository(this);
  const receipt = (lane: number) => 'reports/replay-shards/' + lane + '/replay.json';
  const original = repo.read(receipt(2));
  repo.write(receipt(2), repo.read(receipt(1)));
  try {
    await refusedByJudge(this, /provenance du rejeu différente pour le lot 2/);
  } finally {
    repo.write(receipt(2), original);
  }
  await without(repo, 'reports/mutation-shards/2', async () => {
    cpSync(repo.path('reports/mutation-shards/1'), repo.path('reports/mutation-shards/2'), {
      recursive: true,
    });
    try {
      await refusedByJudge(this, /inventaire différent du périmètre courant pour le lot 2/);
    } finally {
      repo.remove('reports/mutation-shards/2');
    }
  });
});

Then('lanes whose reports hold no canary are refused, whether they name it or not', async function () {
  const repo = repository(this);
  const canary = 'zz/probe.mjs';
  const paths = lanesOf(this).map((lane) => 'reports/mutation-shards/' + lane + '/mutation/native.json');
  const originals = paths.map((path) => repo.read(path));
  const strip = (named: boolean) => {
    for (const [index, path] of paths.entries()) {
      const report = JSON.parse(originals[index] as string);
      delete report.files[canary];
      if (!named) report.config.mutate = report.config.mutate.filter((pattern: string) => pattern !== canary);
      repo.write(path, JSON.stringify(report));
    }
  };
  try {
    strip(true);
    await refusedByJudge(this, /zz\/probe\.mjs : lot absent du rapport de mutation/);
    strip(false);
    await refusedByJudge(this, /fichiers du rapport différents des lots prévus/);
  } finally {
    for (const [index, path] of paths.entries()) repo.write(path, originals[index] as string);
  }
});

Then('receipts of another plan are refused', async function () {
  const repo = repository(this);
  const policy = repo.read(HOSTED_LANES);
  // One lane allowed: the same commit now plans a single lane, which holds every mutant.
  repo.write(HOSTED_LANES, JSON.stringify(fixturePolicy(1)));
  try {
    await refusedByJudge(this, /plan annoncé différent du plan re-dérivé \(1 lot\(s\)\)/);
    await refusedByJudge(this, /reçu hors du plan re-dérivé dans reports\/mutation-shards/, '[1]');
    const others = lanesOf(this).slice(1);
    const keepOne = async (remaining: number[]): Promise<void> => {
      const [lane, ...rest] = remaining;
      if (lane === undefined)
        return refusedByJudge(this, /inventaire différent du périmètre courant pour le lot 1/, '[1]');
      await without(repo, 'reports/mutation-shards/' + lane, () =>
        without(repo, 'reports/replay-shards/' + lane, () => keepOne(rest)),
      );
    };
    await keepOne(others);
  } finally {
    repo.write(HOSTED_LANES, policy);
  }
});

Then('receipts of another head are refused, the plan being the same', async function () {
  const repo = repository(this);
  const before = repo.rev('HEAD');
  const tree = repo.rev('HEAD^{tree}');
  const parent = repo.rev('HEAD^1');
  // The same tree on the same parent under another message: the same perimeter and plan, another commit.
  git(repo.dir, [
    '-c',
    'user.name=gate',
    '-c',
    'user.email=gate@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '--amend',
    '--allow-empty',
    '-m',
    'another head',
  ]);
  assert.notEqual(repo.rev('HEAD'), before);
  assert.equal(repo.rev('HEAD^{tree}'), tree);
  assert.equal(repo.rev('HEAD^1'), parent);
  assert.deepEqual(await plannedLanes(repo), lanesOf(this));
  await refusedByJudge(this, /inventaire différent du périmètre courant pour le lot 1/);
});
