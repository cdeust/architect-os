import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then, When, repository } from './repository.js';

type Inventory = {
  head: string;
  lots: {
    file: string;
    sourceSha256: string;
    whole: boolean;
    lines: number[];
    mutants: {
      start: { line: number };
      end: { line: number };
      mutatorName: string;
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
