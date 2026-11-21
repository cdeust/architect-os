import assert from 'node:assert/strict';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import { readNativeLotIgnorer } from '../../src/infrastructure/stryker-lot-plugin.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Then, When, repository } from './repository.js';

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

Then('the mutation inventory retains the scoped multiline nodes', function () {
  const result = readInventory(this);
  const [lot] = result.lots;
  assert.equal(result.lots.length, 1);
  assert.ok(lot);
  assert.equal(lot.file, 'src/scoped.mjs');
  assert.equal(lot.whole, false);
  assert.deepEqual(lot.lines, [3]);
  assert.equal(lot.sourceSha256, createHash('sha256').update(repository(this).read(lot.file)).digest('hex'));
  assert(lot.mutants.some((mutant) => mutant.mutatorName === 'BlockStatement' && mutant.start.line === 1));
  assert(lot.mutants.some((mutant) => mutant.mutatorName === 'EqualityOperator' && mutant.start.line === 2));
  assert(lot.mutants.every((mutant) => mutant.start.line <= 3 && mutant.end.line >= 3));
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
  const disabled = () => false;
  const silent = () => undefined;
  const instrumenter = new Instrumenter({
    isTraceEnabled: disabled,
    isDebugEnabled: disabled,
    isInfoEnabled: disabled,
    isWarnEnabled: disabled,
    isErrorEnabled: disabled,
    isFatalEnabled: disabled,
    trace: silent,
    debug: silent,
    info: silent,
    warn: silent,
    error: silent,
    fatal: silent,
  });
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
  if (variant === 'cross-file id collision') {
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
              id: String(index),
              status: 'Killed',
              mutatorName,
              replacement,
              location: { start, end },
            })),
          },
        },
        config: { mutate: [lot.file, other.file] },
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
  repo.write(
    reportPath,
    JSON.stringify({
      files: { [lot.file]: { source: claimedSource, mutants } },
      config: { mutate: variant === 'different file list' ? [] : [lot.file] },
    }),
  );
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

When('the gate checks its mutation inventory', function () {
  return repository(this).run(['inventory-check', '--job', 'linux']);
});

Then('the mutation inventory check returns {string}', function (expected: string) {
  const repo = repository(this);
  assert.equal(repo.exitCode, expected === 'pass' ? 0 : 1, repo.output);
  assert.ok(repo.output.includes(expected === 'pass' ? 'lots de mutation vérifiés' : expected), repo.output);
});
