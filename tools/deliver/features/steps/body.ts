import assert from 'node:assert/strict';
import {
  bodyFits,
  inert,
  pullRequestBody,
  pullRequestTitle,
  type StepRecordView,
} from '../../src/domain/pull-request.js';
import { stepRecord } from './record-fixture.js';
import { Given, Then, When, type DeliverWorld } from './support.js';

// The title and the body of the pull request (body.feature): pure, over the domain view of the record, so that a
// scenario can give values the schema of the record would refuse.

interface Scene {
  record: StepRecordView;
  body?: string;
}

const scene = (world: DeliverWorld): Scene => world.state['pullBody'] as Scene;

/**
 * Characters a cell of a table cannot show, by name: `{zw}` the zero-width space, `{lf}` a line break, `{rlo}` the
 * right-to-left override, `{wj}` the word joiner, `{bom}` the zero-width no-break space, `{fffd}` the replacement
 * character.
 */
const NAMED: readonly (readonly [string, string])[] = [
  ['{zw}', '\u200b'],
  ['{lf}', '\n'],
  ['{rlo}', '\u202e'],
  ['{wj}', '\u2060'],
  ['{bom}', '\ufeff'],
  ['{fffd}', '\ufffd'],
];
const shown = (text: string): string =>
  NAMED.reduce((out, [name, char]) => (name === '{lf}' ? out : out.replaceAll(char, name)), text);
const given = (text: string): string => NAMED.reduce((out, [name, char]) => out.replaceAll(name, char), text);

const HASH = '1'.repeat(40);

Given(
  'the record of a step that passed, with one check and one review that accepted its criterion',
  function () {
    this.state['pullBody'] = { record: stepRecord() } satisfies Scene;
  },
);

Given('the record of a step refused by one of its two reviews, with two checks', function () {
  const record = stepRecord();
  this.state['pullBody'] = {
    record: {
      ...record,
      outcome: 'refused',
      checks: [
        { name: 'types-deliver', passed: true, stopped: false, durationSeconds: 3 },
        { name: 'format', passed: false, stopped: true, durationSeconds: 12 },
      ],
      reviews: [
        {
          name: 'correctness',
          verdict: 'request_changes',
          findings: 2,
          criteria: [
            { id: 'AC-1', status: 'unmet' },
            { id: 'AC-2', status: 'not_established' },
          ],
        },
        { name: 'security', verdict: 'accept', findings: 0 },
      ],
    },
  } satisfies Scene;
});

Given('the record of a step with no review, no check, no input and no file of the launcher', function () {
  this.state['pullBody'] = {
    record: { ...stepRecord(), reviews: [], checks: [], inputs: {}, launcher: {} },
  } satisfies Scene;
});

Given('the record of a step whose every value is {string}', function (value: string) {
  const hostile = given(value);
  this.state['pullBody'] = {
    record: {
      step: hostile,
      tree: { commit: hostile, tree: hostile, clean: false },
      inputs: { [hostile]: hostile },
      launcher: { [hostile]: hostile },
      checks: [{ name: hostile, passed: false, stopped: false, durationSeconds: 1 }],
      reviews: [
        { name: hostile, verdict: hostile, findings: 1, criteria: [{ id: hostile, status: hostile }] },
      ],
      outcome: hostile,
    },
  } satisfies Scene;
});

When(
  'the body of its pull request is rendered for the step {string} of {string}',
  function (name: string, repository: string) {
    const state = scene(this);
    state.body = pullRequestBody(state.record, { repository, hash: HASH, name: given(name) });
  },
);

Then('the body of the pull request is:', function (expected: string) {
  assert.equal(scene(this).body, `${expected}\n`);
});

Then('the body of the pull request mentions no one, names no issue and closes none', function () {
  const body = scene(this).body as string;
  // Mentions and references: `@` or `#` before a word; a keyword followed by anything; an address but the record's.
  assert.doesNotMatch(body, /@[A-Za-z0-9]/);
  assert.doesNotMatch(body, /#[A-Za-z0-9]/);
  // The address of the record is percent-encoded: a space or a `#` cannot follow a keyword in it.
  const text = body.replace(/\]\(https:\/\/\S+\)/, ']');
  assert.doesNotMatch(text, /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b/i);
  assert.equal(body.match(/:\/\//g)?.length, 1);
  for (const line of body.split('\n')) assert.equal((line.match(/`/g)?.length ?? 0) % 2, 0, line);
});

Then('every row of the tables of the body has as many cells as its header', function () {
  let width: number | undefined;
  for (const line of (scene(this).body as string).split('\n')) {
    if (!line.startsWith('|')) {
      width = undefined;
      continue;
    }
    const cells = line.split(/(?<!\\)\|/).length;
    width ??= cells;
    assert.equal(cells, width, line);
  }
});

Then('the address of the record in the body is {string}', function (address: string) {
  const found = /\]\((\S+)\) of this commit/.exec(scene(this).body as string)?.[1];
  assert.equal(found, address);
});

Then('{string} made inert is {string}', function (value: string, expected: string) {
  assert.equal(shown(inert(given(value))), expected);
});

Then(
  'the title of the template {string} for the name {string} is {string}',
  function (template: string, name: string, expected: string) {
    assert.equal(shown(pullRequestTitle(template, name)), expected);
  },
);

Given(
  'the record of a step whose build declared the departures {string}, judged by {string} as {string} and by {string} as {string}',
  function (ids: string, first: string, firstStatuses: string, second: string, secondStatuses: string) {
    this.state['pullBody'] = {
      record: withClaims(ids, [
        [first, firstStatuses],
        [second, secondStatuses],
      ]),
    } satisfies Scene;
  },
);

Given(
  'the record of a step whose build declared the departures {string}, judged by {string} as {string}',
  function (ids: string, review: string, statuses: string) {
    this.state['pullBody'] = { record: withClaims(ids, [[review, statuses]]) } satisfies Scene;
  },
);

Given('the record of a step whose declared departures the host refused', function () {
  this.state['pullBody'] = {
    record: { ...stepRecord(), claims: { valid: false, given: [] } },
  } satisfies Scene;
});

/** The record whose build declared `ids` (each line hashed 4…, 5…), and each review with its statuses, in order. */
function withClaims(ids: string, reviews: readonly (readonly [string, string])[]): StepRecordView {
  const declared = ids === '' ? [] : ids.split(', ');
  const base = stepRecord();
  return {
    ...base,
    claims: { valid: true, given: declared.map((id, i) => ({ id, sha256: String(4 + i).repeat(64) })) },
    reviews: reviews.map(([name, statuses], i) => ({
      ...(i === 0 ? base.reviews[0] : { verdict: 'accept', findings: 0 }),
      name,
      ...(statuses === ''
        ? {}
        : { claims: statuses.split(', ').map((status, j) => ({ id: declared[j] as string, status })) }),
    })) as StepRecordView['reviews'],
  };
}

Then('the body of the pull request holds:', function (expected: string) {
  const body = scene(this).body as string;
  assert.ok(body.includes(`${expected}\n`), body);
});

Then('a body of {int} characters fits the forge: {word}', function (length: number, fits: string) {
  assert.equal(bodyFits('x'.repeat(length)), fits === 'yes');
});
