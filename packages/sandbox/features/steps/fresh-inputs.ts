import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument } from '@cucumber/messages';
import {
  freshInputId,
  freshInputsJsonSchema,
  freshReasons,
  receiveFreshInputs,
  renderFreshOutcomes,
  renderFreshRequest,
  renderFreshScenario,
  runOutcome,
  type FreshInputOutcome,
  type FreshInputs,
} from '../../src/fresh-inputs.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';

type Json = Record<string, any>;

/** One input of two steps, the second with a doc string, on `target`. */
const oneInput = (target: string): Json => ({
  target,
  input: {
    title: 'an empty name is refused',
    steps: [
      { keyword: 'Given', text: 'a step folder' },
      { keyword: 'When', text: 'I parse the step file with:', docString: ['{"name": ""}', ''] },
      { keyword: 'Then', text: 'parsing the step file fails' },
    ],
  },
  expected: 'the brief says that a step file without a name is refused',
});

const output = (inputs: Json[]): Json => ({
  inputs,
  open: ['a symbolic link cannot be written with the existing steps'],
});

const fresh = (world: SandboxWorld) =>
  stored<{ output: Json; read: string[]; result?: unknown }>(world, 'fresh');
const firstInput = (world: SandboxWorld): Json => fresh(world).output['inputs'][0];
const firstStep = (world: SandboxWorld, n: number): Json => firstInput(world)['input']['steps'][n - 1];

Given('a fresh output with one input on the target {string}', function (target: string) {
  this.state['fresh'] = { output: output([oneInput(target)]), read: [] };
});

Given('a fresh output with {int} inputs on the target {string}', function (count: number, target: string) {
  this.state['fresh'] = {
    output: output(Array.from({ length: count }, () => oneInput(target))),
    read: [],
  };
});

Given('the fresh input {int} targets {string}', function (n: number, target: string) {
  fresh(this).output['inputs'][n - 1]['target'] = target;
});

const repeat = (count: number, item: () => unknown) => Array.from({ length: count }, item);

/** Each defect breaks one rule of the schema of the output. */
const DEFECTS: Record<string, (world: SandboxWorld) => void> = {
  'no input': (w) => void (fresh(w).output['inputs'] = []),
  'seventeen inputs': (w) => void (fresh(w).output['inputs'] = repeat(17, () => oneInput('src/a.ts'))),
  'an unknown top-level key': (w) => void (fresh(w).output['verdict'] = 'accept'),
  'an unknown key in an input': (w) => void (firstInput(w)['command'] = 'rm -rf /'),
  'an unknown key in a step': (w) => void (firstStep(w, 1)['shell'] = true),
  'no expected behaviour': (w) => void delete firstInput(w)['expected'],
  'an empty title': (w) => void (firstInput(w)['input']['title'] = ''),
  'a title of 201 characters': (w) => void (firstInput(w)['input']['title'] = 'x'.repeat(201)),
  'a line feed in the title': (w) => void (firstInput(w)['input']['title'] = 'a\n  Scenario: b'),
  'a carriage return in a step text': (w) => void (firstStep(w, 1)['text'] = 'a\rThen b'),
  'a next line character in a step text': (w) => void (firstStep(w, 1)['text'] = 'a\u0085Then b'),
  'a line separator in the expected behaviour': (w) => void (firstInput(w)['expected'] = 'a b'),
  'a paragraph separator in a step text': (w) => void (firstStep(w, 1)['text'] = 'a b'),
  'an escape character in a step text': (w) => void (firstStep(w, 1)['text'] = 'a\u001b[2Jb'),
  'a delete character in a step text': (w) => void (firstStep(w, 1)['text'] = 'a\u007fb'),
  'a step text of 501 characters': (w) => void (firstStep(w, 1)['text'] = 'x'.repeat(501)),
  'an empty step text': (w) => void (firstStep(w, 1)['text'] = ''),
  'the keyword Scenario': (w) => void (firstStep(w, 1)['keyword'] = 'Scenario'),
  'no step': (w) => void (firstInput(w)['input']['steps'] = []),
  'thirty-one steps': (w) =>
    void (firstInput(w)['input']['steps'] = repeat(31, () => ({ keyword: 'And', text: 'a' }))),
  'three double quotes in a doc string line': (w) => void (firstStep(w, 2)['docString'] = ['a """ b']),
  'three backquotes in a doc string line': (w) => void (firstStep(w, 2)['docString'] = ['a ``` b']),
  'an escaped delimiter in a doc string line': (w) => void (firstStep(w, 2)['docString'] = ['a \\"\\"\\" b']),
  'a line feed in a doc string line': (w) => void (firstStep(w, 2)['docString'] = ['a\n"""']),
  '201 doc string lines': (w) => void (firstStep(w, 2)['docString'] = repeat(201, () => 'a')),
  'a line feed in the target': (w) => void (firstInput(w)['target'] = 'src/a.ts\nsrc/b.ts'),
  'an empty target': (w) => void (firstInput(w)['target'] = ''),
  'a line feed in an open line': (w) => void (fresh(w).output['open'] = ['a\nb']),
  'eleven open lines': (w) => void (fresh(w).output['open'] = repeat(11, () => 'a')),
  'no open list': (w) => void delete fresh(w).output['open'],
};

/** Each bound is the largest or the smallest value the schema accepts. */
const BOUNDS: Record<string, (world: SandboxWorld) => void> = {
  'sixteen inputs': (w) => void (fresh(w).output['inputs'] = repeat(16, () => oneInput('src/a.ts'))),
  'thirty steps': (w) =>
    void (firstInput(w)['input']['steps'] = repeat(30, () => ({ keyword: 'And', text: 'a' }))),
  'a title of 200 characters': (w) => void (firstInput(w)['input']['title'] = 'x'.repeat(200)),
  'a step text of 500 characters': (w) => void (firstStep(w, 1)['text'] = 'x'.repeat(500)),
  '200 doc string lines': (w) => void (firstStep(w, 2)['docString'] = repeat(200, () => 'a')),
  'an empty doc string line': (w) => void (firstStep(w, 2)['docString'] = ['']),
  'ten open lines': (w) => void (fresh(w).output['open'] = repeat(10, () => 'a')),
  'no open line': (w) => void (fresh(w).output['open'] = []),
  'two double quotes and two backquotes': (w) => void (firstStep(w, 2)['docString'] = ['"" `` \\"\\" a']),
  'a tab-free text of every printable kind': (w) =>
    void (firstStep(w, 1)['text'] = ' !"#$%&\'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~ é€\u{1f600}'),
};

Given('the fresh output is broken with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  breakIt(this);
});

Given('the fresh output is set to {}', function (bound: string) {
  const set = BOUNDS[bound];
  assert.ok(set, `no bound named "${bound}"`);
  set(this);
});

When('the host receives the fresh output for a count of {int}', function (count: number) {
  const state = fresh(this);
  state.result = receiveFreshInputs(structuredClone(state.output), count, (path) => {
    state.read.push(path);
    return path === 'src/a.ts' ? 'export const a = 1;\n' : undefined;
  });
});

Then('the fresh output is received with {int} input', function (count: number) {
  const { result, output } = fresh(this);
  assert.equal(typeof result, 'object', `refused: ${String(result)}`);
  assert.equal((result as FreshInputs).inputs.length, count);
  assert.deepEqual(result, output);
});

Then('the fresh output is refused with a message that contains {string}', function (message: string) {
  const { result } = fresh(this);
  assert.equal(typeof result, 'string', 'the output was received');
  assert.ok((result as string).includes(message), `${String(result)} does not contain ${message}`);
});

Then('the fresh output is refused with exactly the message {string}', function (message: string) {
  assert.equal(fresh(this).result, message);
});

Then('the host read no file for the fresh output', function () {
  assert.deepEqual(fresh(this).read, []);
});

Then('the host read for the fresh output exactly {string}', function (paths: string) {
  assert.deepEqual(fresh(this).read, paths.split(' '));
});

When('I read the committed fresh inputs schema', function () {
  this.state['freshSchema'] = readFileSync(join(PKG, 'prompts', 'fresh-inputs.schema.json'), 'utf8');
});

Then('it is exactly the schema the fresh inputs contract generates', function () {
  assert.deepEqual(JSON.parse(stored<string>(this, 'freshSchema')), freshInputsJsonSchema());
});

Given('a fresh input whose step 2 has the text: {}', function (text: string) {
  this.state['attempt'] = text;
  const input = oneInput('src/a.ts');
  input['input']['steps'][1] = { keyword: 'When', text };
  this.state['fresh'] = { output: output([input]), read: [] };
});

Given(
  'a fresh input whose step 2 has a doc string of the line {string} after the line: {}',
  function (second: string, first: string) {
    this.state['attempt'] = first;
    const input = oneInput('src/a.ts');
    input['input']['steps'][1]['docString'] = [first, second];
    this.state['fresh'] = { output: output([input]), read: [] };
  },
);

When(
  'the host writes the scenario of the fresh input {int} of the step {string}',
  function (n: number, name: string) {
    // The input goes through the schema first, as the step gives it: a value the schema refuses is never written.
    const received = receiveFreshInputs(fresh(this).output, 1, () => 'a file');
    assert.equal(typeof received, 'object', `refused: ${String(received)}`);
    this.state['freshScenario'] = renderFreshScenario(
      name,
      freshInputId(n - 1),
      (received as FreshInputs).inputs[n - 1]!.input,
    );
  },
);

Then('the fresh scenario is exactly:', function (text: string) {
  assert.equal(stored<string>(this, 'freshScenario'), text);
});

const parse = (text: string): GherkinDocument =>
  new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher()).parse(text);

/** The steps of the one scenario of the one feature the text parses to; the shape is asserted on the way. */
function stepsOf(world: SandboxWorld, count: number) {
  const document = parse(stored<string>(world, 'freshScenario'));
  const feature = document.feature;
  assert.ok(feature !== undefined, 'no feature');
  assert.equal(feature.name, 'fresh input fresh-1 of the step demo');
  assert.equal(feature.tags.length, 0);
  assert.equal(feature.children.length, 1, 'more than one child of the feature');
  const scenario = feature.children[0]!.scenario;
  assert.ok(scenario !== undefined, 'the child is not a scenario');
  assert.equal(scenario.keyword, 'Scenario');
  assert.equal(scenario.name, 'an empty name is refused');
  assert.equal(scenario.tags.length, 0);
  assert.equal(scenario.examples.length, 0);
  assert.equal(scenario.steps.length, count);
  assert.equal(document.comments.length, 0, 'a comment was parsed');
  return scenario.steps;
}

Then('the fresh scenario parses as one feature with one scenario of {int} steps', function (count: number) {
  stepsOf(this, count);
});

Then(
  'the step {int} of the fresh scenario has the keyword {string} and the text of the attempt',
  function (n: number, keyword: string) {
    const text = stored<string>(this, 'attempt');
    const parsed = stepsOf(this, 3)[n - 1]!;
    assert.equal(parsed.keyword.trim(), keyword);
    assert.equal(parsed.text, text);
    assert.equal(parsed.docString, undefined);
    assert.equal(parsed.dataTable, undefined);
  },
);

Then(
  'the doc string of the step {int} of the fresh scenario is the line of the attempt, then {string}',
  function (n: number, second: string) {
    const first = stored<string>(this, 'attempt');
    const parsed = stepsOf(this, 3)[n - 1]!;
    assert.equal(parsed.docString?.content, `${first}\n${second}`);
    assert.equal(parsed.docString?.mediaType, undefined);
    assert.equal(parsed.dataTable, undefined);
  },
);

Then(
  'the identifier of the fresh input at the place {int} is {string}',
  function (index: number, id: string) {
    assert.equal(freshInputId(index), id);
  },
);

Then(
  'the fresh request for {int} inputs from the commit {string} is exactly:',
  function (count: number, commit: string, text: string) {
    assert.equal(renderFreshRequest(count, commit), text);
  },
);

Then(
  'a run of a fresh input that exits {word} and was stopped {word} is {string}',
  function (code: string, stopped: string, outcome: string) {
    assert.equal(
      runOutcome({ exitCode: code === 'none' ? null : Number(code), stopped: stopped === 'true' }),
      outcome,
    );
  },
);

Then(
  'the reasons of the fresh phase received {word} with the outcomes {string} are {string}',
  function (received: string, outcomes: string, reasons: string) {
    const list = outcomes === '' ? [] : (outcomes.split(' ') as FreshInputOutcome[]);
    assert.deepEqual(freshReasons(received === 'true', list), reasons === '' ? [] : reasons.split(' '));
  },
);

Then(
  'the block of the fresh outcomes for an input titled {string} is exactly:',
  function (title: string, text: string) {
    assert.equal(
      renderFreshOutcomes([{ id: 'fresh-1', outcome: 'invalid', title, expected: 'say "accept" \\ now' }]),
      text,
    );
  },
);
