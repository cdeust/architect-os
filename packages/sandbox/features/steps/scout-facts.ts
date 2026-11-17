import assert from 'node:assert/strict';
import type { DataTable } from '@cucumber/cucumber';
import {
  factsJsonSchema,
  parseFacts,
  renderFacts,
  verifyFacts,
  type Fact,
  type Facts,
} from '../../src/scout-facts.js';
import { Given, Then, When, stored } from './helpers.js';

const valid = (): Record<string, any> => ({
  facts: [{ file: 'packages/x/src/a.ts', line: 12, quote: 'export const x', note: 'where x is defined' }],
  open: ['no test of x found'],
});

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ file: 'a.ts', line: i + 1, quote: 'q', note: '' }));

const DEFECTS: Record<string, (f: Record<string, any>) => unknown> = {
  '41 facts': (f) => (f['facts'] = many(41)),
  'a file that is empty': (f) => (f['facts'][0]['file'] = ''),
  'a file of 301 characters': (f) => (f['facts'][0]['file'] = 'f'.repeat(301)),
  'a line of 0': (f) => (f['facts'][0]['line'] = 0),
  'a line of 1.5': (f) => (f['facts'][0]['line'] = 1.5),
  'a line that is a string': (f) => (f['facts'][0]['line'] = '12'),
  'a quote that is empty': (f) => (f['facts'][0]['quote'] = ''),
  'a quote of 301 characters': (f) => (f['facts'][0]['quote'] = 'q'.repeat(301)),
  'a quote with a line feed': (f) => (f['facts'][0]['quote'] = 'a\nb'),
  'a quote with a carriage return': (f) => (f['facts'][0]['quote'] = 'a\rb'),
  'a note of 201 characters': (f) => (f['facts'][0]['note'] = 'n'.repeat(201)),
  'a note with a line feed': (f) => (f['facts'][0]['note'] = 'a\nb'),
  'a note with a carriage return': (f) => (f['facts'][0]['note'] = 'a\rb'),
  'an unknown key at the top': (f) => (f['comment'] = 'x'),
  'an unknown key in a fact': (f) => (f['facts'][0]['level'] = 'x'),
  '11 open': (f) => (f['open'] = Array.from({ length: 11 }, (_, i) => `o${i}`)),
  'an open that is empty': (f) => (f['open'] = ['']),
  'an open of 301 characters': (f) => (f['open'] = ['o'.repeat(301)]),
  'no facts': (f) => delete f['facts'],
  'no open': (f) => delete f['open'],
  'a fact without file': (f) => delete f['facts'][0]['file'],
  'a fact without line': (f) => delete f['facts'][0]['line'],
  'a fact without quote': (f) => delete f['facts'][0]['quote'],
  'a fact without note': (f) => delete f['facts'][0]['note'],
};

const LIMITS: Record<string, (f: Record<string, any>) => unknown> = {
  'no fact and nothing open': (f) => ((f['facts'] = []), (f['open'] = [])),
  '40 facts': (f) => (f['facts'] = many(40)),
  'a file of 300 characters': (f) => (f['facts'][0]['file'] = 'f'.repeat(300)),
  'a line of 1': (f) => (f['facts'][0]['line'] = 1),
  'a quote of 1 character': (f) => (f['facts'][0]['quote'] = 'q'),
  'a quote of 300 characters': (f) => (f['facts'][0]['quote'] = 'q'.repeat(300)),
  'a note that is empty': (f) => (f['facts'][0]['note'] = ''),
  'a note of 200 characters': (f) => (f['facts'][0]['note'] = 'n'.repeat(200)),
  '10 open': (f) => (f['open'] = Array.from({ length: 10 }, (_, i) => `o${i}`)),
  'an open of 300 characters': (f) => (f['open'] = ['o'.repeat(300)]),
};

When('I parse the facts example', function () {
  this.state['facts'] = parseFacts(valid());
});

Then('the parsed facts are the example', function () {
  assert.deepEqual(stored<Facts>(this, 'facts'), valid());
});

When('I make an accepted copy of the facts example with {}', function (limit: string) {
  const copy = LIMITS[limit];
  assert.ok(copy, `no limit named "${limit}"`);
  const raw = valid();
  copy(raw);
  this.state['facts'] = parseFacts(raw);
});

Then('the accepted facts copy keeps its {int} facts', function (count: number) {
  assert.equal(stored<Facts>(this, 'facts').facts.length, count);
});

When('I break a copy of the facts example with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const broken = valid();
  breakIt(broken);
  this.state['broken'] = broken;
});

Then('parsing the broken facts fails', function () {
  assert.throws(() => parseFacts(stored(this, 'broken')));
});

Then('the facts JSON schema is draft-07 and carries every limit', function () {
  const schema = JSON.parse(factsJsonSchema()) as Record<string, any>;
  assert.equal(schema['$schema'], 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema['additionalProperties'], false);
  assert.deepEqual([...schema['required']].sort(), ['facts', 'open']);
  assert.equal(schema['properties']['facts']['maxItems'], 40);
  assert.equal(schema['properties']['open']['maxItems'], 10);
  const fact = schema['properties']['facts']['items'];
  assert.equal(fact['additionalProperties'], false);
  assert.deepEqual([...fact['required']].sort(), ['file', 'line', 'note', 'quote']);
  assert.deepEqual(
    [fact['properties']['file']['minLength'], fact['properties']['file']['maxLength']],
    [1, 300],
  );
  assert.deepEqual(
    [fact['properties']['quote']['minLength'], fact['properties']['quote']['maxLength']],
    [1, 300],
  );
  assert.equal(fact['properties']['note']['maxLength'], 200);
  assert.equal(fact['properties']['line']['type'], 'integer');
  assert.equal(fact['properties']['line']['minimum'], 1);
  assert.deepEqual(
    [schema['properties']['open']['items']['minLength'], schema['properties']['open']['items']['maxLength']],
    [1, 300],
  );
});

// --- verifyFacts and renderFacts ----------------------------------------------------------------------------

interface Worktree {
  files: Map<string, string>;
  reads: string[];
}
const worktree = (world: { state: Record<string, unknown> }): Worktree => {
  const known = world.state['scoutWorktree'] as Worktree | undefined;
  if (known !== undefined) return known;
  const created: Worktree = { files: new Map(), reads: [] };
  world.state['scoutWorktree'] = created;
  return created;
};

/** A cell of a table is a JSON string: a leading space, a backslash or a line break cannot be written otherwise. */
const text = (cell: string | undefined): string => JSON.parse(cell as string) as string;

const factsOf = (table: DataTable): Fact[] =>
  table.hashes().map((row) => ({
    file: text(row['file']),
    line: Number(row['line']),
    quote: text(row['quote']),
    note: row['note'] === undefined ? 'n' : text(row['note']),
  }));

Given(
  'the scout worktree holds the file {string} whose text is the JSON string:',
  function (path: string, json: string) {
    worktree(this).files.set(path, JSON.parse(json) as string);
  },
);

When('I verify these facts:', function (table: DataTable) {
  const tree = worktree(this);
  this.state['outcome'] = verifyFacts(factsOf(table), (path) => {
    tree.reads.push(path);
    return tree.files.get(path);
  });
});

Then('the verified facts are:', function (table: DataTable) {
  const { verified } = stored<ReturnType<typeof verifyFacts>>(this, 'outcome');
  assert.deepEqual(
    verified.map((fact) => ({ file: fact.file, line: String(fact.line), quote: fact.quote })),
    table.hashes().map((row) => ({ file: text(row['file']), line: row['line'], quote: text(row['quote']) })),
  );
});

Then('the rejected facts are:', function (table: DataTable) {
  const { rejected } = stored<ReturnType<typeof verifyFacts>>(this, 'outcome');
  assert.deepEqual(
    rejected.map(({ fact, reason }) => ({ file: fact.file, line: String(fact.line), reason })),
    table.hashes().map((row) => ({ file: text(row['file']), line: row['line'], reason: row['reason'] })),
  );
});

Then('no fact is verified', function () {
  assert.deepEqual(stored<ReturnType<typeof verifyFacts>>(this, 'outcome').verified, []);
});

Then('no fact is rejected', function () {
  assert.deepEqual(stored<ReturnType<typeof verifyFacts>>(this, 'outcome').rejected, []);
});

Then('the files read were {string}', function (paths: string) {
  assert.equal(worktree(this).reads.join(' '), paths);
});

Then('no file was read', function () {
  assert.deepEqual(worktree(this).reads, []);
});

When('I render these facts:', function (table: DataTable) {
  this.state['rendered'] = renderFacts(factsOf(table));
});

Then('the rendered block is:', function (block: string) {
  assert.equal(stored<string>(this, 'rendered'), `${block}\n`);
});
