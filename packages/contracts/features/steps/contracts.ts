import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import {
  DATA_OP_NAMES,
  RecallDataSchema,
  RecallInputSchema,
  RememberInputSchema,
  TOOLS,
  TOOL_NAMES,
  WorkerOutputSchema,
  resultSchema,
} from '../../src/index.js';

// Then with a doc string argument: node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts
// (the doc string is passed as the last string parameter of the step function).

const recallResult = resultSchema(RecallDataSchema);
const inputSchemas = { recall: RecallInputSchema, remember: RememberInputSchema };

Then('the Result schema of recall data accepts:', (json: string) => {
  assert.equal(recallResult.safeParse(JSON.parse(json)).success, true);
});

Then('the Result schema of recall data rejects:', (json: string) => {
  assert.equal(recallResult.safeParse(JSON.parse(json)).success, false);
});

Then(
  'the {word} input schema parses {string} to {string}',
  (tool: keyof typeof inputSchemas, input: string, expected: string) => {
    assert.deepEqual(inputSchemas[tool].parse(JSON.parse(input)), JSON.parse(expected));
  },
);

Then('the {word} input schema rejects {string}', (tool: keyof typeof inputSchemas, input: string) => {
  assert.equal(inputSchemas[tool].safeParse(JSON.parse(input)).success, false);
});

Then('the tool names are {string}', (names: string) => {
  assert.deepEqual(TOOL_NAMES, names.split(', '));
});

Then('every tool is owned by {string}', (owner: string) => {
  for (const name of TOOL_NAMES) assert.equal(TOOLS[name].owner, owner);
});

Then('every tool has a non-empty description', () => {
  for (const name of TOOL_NAMES) assert.ok(TOOLS[name].description.length > 0);
});

Then('no data operation name matches the pattern {string} ignoring case', (pattern: string) => {
  assert.deepEqual(
    DATA_OP_NAMES.filter((op) => new RegExp(pattern, 'i').test(op)),
    [],
  );
});

Then('the worker output schema accepts:', (json: string) => {
  assert.equal(WorkerOutputSchema.safeParse(JSON.parse(json)).success, true);
});

Then('the worker output schema rejects:', (json: string) => {
  assert.equal(WorkerOutputSchema.safeParse(JSON.parse(json)).success, false);
});

/** `count` evidence whose source, ref and excerpt have the given lengths. */
const evidence = (count: number, source: number, ref: number, excerpt: number) =>
  Array.from({ length: count }, () => ({
    source: 's'.repeat(source),
    ref: 'r'.repeat(ref),
    excerpt: 'e'.repeat(excerpt),
  }));

const ZERO = { input_tokens: 0, output_tokens: 0, usd: 0 };

Then(
  'the worker output schema {word} {int} evidence with a source of {int}, a ref of {int} and an excerpt of {int} characters',
  (verdict: string, count: number, source: number, ref: number, excerpt: number) => {
    const output = { status: 'ok', data: {}, evidence: evidence(count, source, ref, excerpt), cost: ZERO };
    assert.equal(WorkerOutputSchema.safeParse(output).success, verdict === 'accepts');
  },
);

Then(
  'the Result schema of recall data {word} {int} evidence with a source of {int}, a ref of {int} and an excerpt of {int} characters',
  (verdict: string, count: number, source: number, ref: number, excerpt: number) => {
    const result = {
      status: 'ok',
      data: { summary: 's', memories: [] },
      evidence: evidence(count, source, ref, excerpt),
      run_id: 'r1',
      cost: ZERO,
    };
    assert.equal(TOOLS.recall.output.safeParse(result).success, verdict === 'accepts');
  },
);
