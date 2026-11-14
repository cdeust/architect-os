import assert from 'node:assert/strict';
import {
  QuestionSchema,
  REASON_CODES,
  parseAnswer,
  parseRejection,
  type Parsed,
  type Answer,
} from '../../src/domain/contract.js';
import { normalizePassage, normalizeTitle } from '../../src/domain/normalize.js';
import { Given, Then, When } from './support.js';

const BASE = {
  id: 'quantum-1',
  claims: [
    {
      statement: 'Code assistants help with understanding unfamiliar code.',
      sources: [
        {
          doi: '10.1145/3597503.3639187',
          title: 'Using an LLM to Help With Code Understanding',
          quote: 'participants who used the assistant answered more comprehension questions correctly',
          text: '3597503.txt',
        },
      ],
    },
  ],
  not_found: ['a randomised trial in industry'],
};

type Json = Record<string, unknown>;

Given('a valid evidence answer', function () {
  this.state['answer'] = structuredClone(BASE);
});

/** Sets or replaces the value at a dotted path; a numeric segment is an array index. */
Given('the evidence answer field {string} is set to {string}', function (path: string, value: string) {
  const keys = path.split('.');
  const last = keys.pop() as string;
  let node = this.state['answer'] as Json;
  for (const key of keys) node = node[key] as Json;
  node[last] = JSON.parse(value);
});

Given('the evidence answer quote has {int} characters', function (length: number) {
  const answer = this.state['answer'] as typeof BASE;
  (answer.claims[0] as (typeof BASE.claims)[0]).sources[0]!.quote = 'q'.repeat(length);
});

Given('the evidence answer DOI has {int} characters', function (length: number) {
  const answer = this.state['answer'] as typeof BASE;
  answer.claims[0]!.sources[0]!.doi = `10.1234/${'d'.repeat(length - 8)}`;
});

Given('the evidence answer statement has {int} characters', function (length: number) {
  const answer = this.state['answer'] as typeof BASE;
  answer.claims[0]!.statement = 's'.repeat(length);
});

Given(
  'the evidence answer text name has {int} characters before {string}',
  function (length: number, suffix: string) {
    const answer = this.state['answer'] as typeof BASE;
    answer.claims[0]!.sources[0]!.text = `${'t'.repeat(length)}${suffix}`;
  },
);

Given('the evidence answer id has {int} characters', function (length: number) {
  (this.state['answer'] as typeof BASE).id = `a${'-'.repeat(length - 1)}`;
});

Given('the evidence answer text is {string}', function (raw: string) {
  this.state['raw'] = raw;
});

When('the evidence answer is parsed', function () {
  const raw = (this.state['raw'] as string | undefined) ?? JSON.stringify(this.state['answer']);
  this.state['parsed'] = parseAnswer(raw);
});

Then('the evidence answer is accepted', function () {
  const parsed = this.state['parsed'] as Parsed<Answer>;
  assert.equal(parsed.ok, true);
});

Then('the evidence answer is refused with:', function (issues: string) {
  assert.deepEqual(this.state['parsed'], { ok: false, issues });
});

Then('the evidence reason codes are:', function (table: { raw(): string[][] }) {
  assert.deepEqual(
    [...REASON_CODES],
    table.raw().map((row) => row[0]),
  );
});

When('the evidence title {string} is normalised', function (title: string) {
  this.state['normalised'] = normalizeTitle(title);
});

When('the evidence passage {string} is normalised', function (passage: string) {
  this.state['normalised'] = normalizePassage(passage);
});

When('the evidence passage is normalised:', function (passage: string) {
  this.state['normalised'] = normalizePassage(passage);
});

Then('the evidence normal form is {string}', function (expected: string) {
  assert.equal(this.state['normalised'], expected);
});

Then('the evidence question stamped {string} is {word}', function (instant: string, verdict: string) {
  const parsed = QuestionSchema.safeParse({ id: 'a', question: 'q', asked_at: instant });
  assert.equal(parsed.success, verdict === 'accepted');
});

Then(
  'the evidence rejection whose fingerprint is {int} hexadecimal characters after the prefix {string} is {word}',
  function (count: number, prefix: string, verdict: string) {
    const rejection = {
      id: 'a',
      rejected_at: '2026-11-14T11:00:00Z',
      answer_sha256: `${prefix}${'a'.repeat(count)}`,
      reasons: [],
    };
    assert.equal(parseRejection(JSON.stringify(rejection)) !== undefined, verdict === 'accepted');
  },
);
