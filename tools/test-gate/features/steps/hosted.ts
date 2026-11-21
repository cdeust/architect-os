import assert from 'node:assert/strict';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { noopLogger } from '@stryker-mutator/util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHostedGate } from '../../src/infrastructure/hosted-gate.js';
import { HOSTED_COSTS } from '../../src/infrastructure/hosted-lots.js';
import type { Lot } from '../../src/infrastructure/mutation-lot-proof.js';
import { readNativeLotIgnorer } from '../../src/infrastructure/stryker-lot-plugin.js';
import { FIXTURES, Then, When, repository, type GateRepository } from './repository.js';

const LANES = [1, 2, 3] as const;
const MANIFEST = 'reports/mutation-inventory.json';
const NATIVE = 'reports/mutation/native.json';
const aggregate = 'reports/mutation/mutation.json';

async function command(repo: GateRepository, ...args: string[]) {
  let output = '';
  const status = await runHostedGate(args, repo.dir, { write: (text) => (output += text) }, LANES.length);
  return { status, output };
}

async function nativeFixture(repo: GateRepository, file: string) {
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
            status: mutant.status ?? 'Survived',
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

When('the hosted mutation chains complete independently', async function () {
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
    await nativeFixture(repo, NATIVE);
    const verified = await command(repo, 'verify', String(lane));
    assert.equal(verified.status, 0, verified.output);
    const directory = 'reports/mutation-shards/' + lane;
    repo.write(directory + '/mutation-inventory.json', repo.read(MANIFEST));
    repo.write(directory + '/mutation/native.json', repo.read(NATIVE));
    repo.write(directory + '/producer', 'first producer attempt for lane ' + lane);
    const replayed = await command(repo, 'replay', String(lane));
    assert.equal(replayed.status, 0, replayed.output);
  }
  assert.ok(split > 1);
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
  repo.remove('reports/replay-shards/2/replay.json');
  const missing = await command(repo, 'collect');
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /reports\/replay-shards\/2\/replay.json absent/);
  assert.equal(repo.exists('reports/mutation/replay.json'), false);
});
