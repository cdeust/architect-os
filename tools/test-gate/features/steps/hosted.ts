import assert from 'node:assert/strict';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { noopLogger } from '@stryker-mutator/util';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHostedGate } from '../../src/infrastructure/hosted-gate.js';
import { CONFIG_PATH } from '../../src/infrastructure/gate.js';
import { HOSTED_COSTS, planHostedSlices } from '../../src/infrastructure/hosted-lots.js';
import type { Lot } from '../../src/infrastructure/mutation-lot-proof.js';
import { readNativeLotIgnorer } from '../../src/infrastructure/stryker-lot-plugin.js';
import { FIXTURES, Given, Then, When, repository, type GateRepository } from './repository.js';

const LANES = [1, 2, 3] as const;
const MANIFEST = 'reports/mutation-inventory.json';
const NATIVE = 'reports/mutation/native.json';
const aggregate = 'reports/mutation/mutation.json';

async function command(repo: GateRepository, ...args: string[]) {
  let output = '';
  const status = await runHostedGate(args, repo.dir, { write: (text) => (output += text) }, LANES.length);
  return { status, output };
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
    ignorers: [readNativeLotIgnorer(repo.dir)],
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

When('the hosted mutation chains complete independently in {string} mode', async function (mode: string) {
  const repo = repository(this);
  repo.write(HOSTED_COSTS, JSON.stringify({ files: {}, fallback: 1 }));
  const disjoint = new Set<string>();
  let split = 0;
  for (const lane of LANES) {
    const inventory = await command(repo, 'inventory', String(lane));
    assert.equal(inventory.status, 0, inventory.output);
    const manifest = JSON.parse(repo.read(MANIFEST)) as { lots: Lot[] };
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
    const verified = await command(repo, 'verify', String(lane));
    assert.equal(verified.status, 0, verified.output);
    assert.equal(verified.output, 'lot natif ' + lane + ' vérifié\n');
    const directory = 'reports/mutation-shards/' + lane;
    repo.write(directory + '/mutation-inventory.json', repo.read(MANIFEST));
    repo.write(directory + '/mutation/native.json', repo.read(NATIVE));
    repo.write(directory + '/producer', 'first producer attempt for lane ' + lane);
    const replayed = await command(repo, 'replay', String(lane));
    assert.equal(replayed.status, 0, replayed.output);
  }
  if (mode === 'changed lines') assert.ok(split > 1);
});

Then('the hosted verdict has all independently replayed mutations', async function () {
  const repo = repository(this);
  const accepted = await command(repo, 'collect');
  assert.equal(accepted.status, 0, accepted.output);
  const combined = JSON.parse(repo.read(aggregate));
  const entries = JSON.parse(repo.read('reports/mutation/replay.json')).mutants as {
    file: string;
    id: string;
    divergence: string | null;
  }[];
  assert.ok(entries.every((entry) => entry.divergence === null));
  assert.equal(
    entries.length,
    Object.values(combined.files).reduce(
      (sum: number, value) => sum + (value as { mutants: unknown[] }).mutants.length,
      0,
    ),
  );
  assert.ok(entries.some(({ file }) => file === 'src/nested.mjs'));
  assert.equal(new Set(entries.map(({ id }) => id.split('/')[0])).size, LANES.length);
});

Then('a replaced producer or a missing receipt cannot reuse the hosted verdict', async function () {
  const repo = repository(this);
  const origin = 'reports/mutation-shards/1/producer';
  const proof = repo.read(origin);
  repo.write(origin, 'replacement producer attempt');
  const stale = await command(repo, 'collect');
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.output, /provenance du rejeu différente pour le lot 1/);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
  repo.write(origin, proof);
  const receipt = 'reports/replay-shards/2/replay.json';
  repo.write(receipt, '{}');
  const invalid = await command(repo, 'collect');
  assert.equal(invalid.status, 1, invalid.output);
  assert.match(invalid.output, /hors schéma/);
  repo.remove(receipt);
  const missing = await command(repo, 'collect');
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /reports\/replay-shards\/2\/replay.json absent/);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
});

Then('the retirement retains whole-file proof and replays only the canary', async function () {
  const repo = repository(this);
  const collected = await command(repo, 'collect');
  assert.equal(collected.status, 0, collected.output);
  const combined = JSON.parse(repo.read(aggregate));
  assert.ok(combined.files['src/math.mjs'].mutants.length > 1);
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
  const rejected = await command(repo, 'collect');
  assert.equal(rejected.status, 1, rejected.output);
  assert.match(rejected.output, /configuration Linux sans canari/);
  assert.equal(repo.exists(aggregate), false);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
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
  for (const lane of LANES) {
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
      const refused = await command(repo, 'collect');
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
  const plan = (count: number) => planHostedSlices(input, canary, read, costs, count);
  assert.throws(() => plan(0), /nombre de lots natifs invalide/);
  assert.throws(() => plan(1.5), /nombre de lots natifs invalide/);
  assert.throws(() => planHostedSlices(input.slice(0, 1), canary, read, costs, 3), /canari absent/);

  const slices = plan(3);
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

  const fallback = plan(2);
  assert.equal(fallback.flatMap(({ lots }) => lots.filter((lot) => lot.file === file)).length, 1);
  assert.deepEqual(fallback[0]?.patterns, [file, canary]);
  assert.equal(fallback[0]?.lots[0], input[0]);
});

Then('hosted admission preserves unrelated receipts and rejects invalid lane arguments', async function () {
  const repo = repository(this);
  const invoke = async (...args: string[]) => {
    let output = '';
    const status = await runHostedGate(args, repo.dir, { write: (text) => (output += text) }, 12);
    return { status, output };
  };
  const selected = 'reports/replay-shards/10/replay.json';
  const other = 'reports/replay-shards/11/replay.json';
  repo.write(selected, 'receipt for lane 10');
  repo.write(other, 'receipt for lane 11');
  repo.write(HOSTED_COSTS, JSON.stringify({ files: {}, fallback: 1 }));
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
    ['inventory', '13'],
    ['inventory', '10', 'extra'],
    ['collect', '10'],
    ['unknown', '10'],
  ]) {
    const bad = await invoke(...args);
    assert.equal(bad.status, 1, JSON.stringify(args));
    assert.match(bad.output, /usage : hosted-gate/, JSON.stringify(args));
  }
  const unplanned = await invoke('verify', '10');
  assert.equal(unplanned.status, 1, unplanned.output);
  assert.match(unplanned.output, /inventaire différent du périmètre courant pour le lot 10/);
  const valid = await invoke('inventory', '10');
  assert.equal(valid.status, 0, valid.output);
  assert.equal(JSON.parse(repo.read(MANIFEST)).lane, 10);
  assert.equal(repo.read(selected), 'receipt for lane 10');
  assert.equal(repo.read(other), 'receipt for lane 11');
  const replayed = await invoke('replay', '10');
  assert.equal(replayed.status, 1, replayed.output);
  assert.match(replayed.output, /inventaire différent du périmètre courant pour le lot 10/);
  assert.equal(repo.exists(selected), false);
  assert.equal(repo.read(other), 'receipt for lane 11');
});

Then('hosted admission refuses broken configuration and debt at either revision', async function () {
  const repo = repository(this);
  repo.write(HOSTED_COSTS, JSON.stringify({ files: {}, fallback: 1 }));
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
    mutatorName: 'fixture',
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
  const files = (count: number) =>
    planHostedSlices(input, canary, read, costs, count).map(({ lots }) =>
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
    1,
  );
  assert.deepEqual(
    rearranged[0]?.lots.find((item) => item.file === file)?.mutants.map(({ replacement }) => replacement),
    ['later', 'first'],
  );

  const outer = { ...first, end: { line: 3, column: 9 } };
  const nesting = planHostedSlices(
    [lot(measured), lot(file, [outer, later]), lot(canary)],
    canary,
    weightedRead,
    { ...costs, fallback: 2 },
    2,
  );
  assert.equal(nesting.filter(({ lots }) => lots.some((item) => item.file === file)).length, 2);

  const mid = { ...costs.files[fileFallback], fallback: 7 };
  const flipped = planHostedSlices(
    [lot(measured), lot(fileFallback), lot(globalFallback), lot(canary)],
    canary,
    read,
    {
      fallback: 6,
      files: { [measured]: { fallback: 8, samples: {} }, [fileFallback]: mid },
    },
    2,
  );
  assert.deepEqual(
    flipped[0]?.lots.map(({ file }) => file),
    [canary, fileFallback, globalFallback],
  );
});
