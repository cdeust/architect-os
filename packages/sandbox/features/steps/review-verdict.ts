import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  blocks,
  criteriaRefusal,
  parseReviewVerdict,
  renderAcceptance,
  ReviewVerdictSchema,
  type ReviewVerdict,
} from '../../src/review-verdict.js';
import { Given, PKG, Then, When, stored } from './helpers.js';

const valid = (): Record<string, any> => ({
  verdict: 'request_changes',
  findings: [{ level: 'correctness', file: 'src/a.ts', line: 12, quote: 'x = 1', reason: 'wrong' }],
  not_checked: ['the replay'],
  criteria: [
    {
      id: 'AC-001',
      status: 'met',
      evidence: [{ file: 'src/a.ts', line: 12, quote: 'x = 1' }],
      reason: 'x is set',
    },
  ],
});

const DEFECTS: Record<string, (v: Record<string, any>) => unknown> = {
  'an unknown level': (v) => (v['findings'][0]['level'] = 'nit'),
  'an unknown verdict': (v) => (v['verdict'] = 'maybe'),
  'a missing verdict': (v) => delete v['verdict'],
  'a missing findings': (v) => delete v['findings'],
  'a missing not_checked': (v) => delete v['not_checked'],
  'a missing level': (v) => delete v['findings'][0]['level'],
  'a missing file': (v) => delete v['findings'][0]['file'],
  'a missing line': (v) => delete v['findings'][0]['line'],
  'a missing quote': (v) => delete v['findings'][0]['quote'],
  'a missing reason': (v) => delete v['findings'][0]['reason'],
  'an extra key at the top': (v) => (v['comment'] = 'x'),
  'an extra key in a finding': (v) => (v['findings'][0]['severity'] = 1),
  'a non-integer line': (v) => (v['findings'][0]['line'] = 1.5),
  'a missing criteria': (v) => delete v['criteria'],
  'an unknown criterion status': (v) => (v['criteria'][0]['status'] = 'partial'),
  'a criterion id that is not an acceptance id': (v) => (v['criteria'][0]['id'] = 'REQ-001'),
  'a missing evidence': (v) => delete v['criteria'][0]['evidence'],
  'a missing criterion reason': (v) => delete v['criteria'][0]['reason'],
  'an extra key in a criterion': (v) => (v['criteria'][0]['note'] = 'x'),
  'an evidence on line 0': (v) => (v['criteria'][0]['evidence'][0]['line'] = 0),
  'an evidence quote on two lines': (v) => (v['criteria'][0]['evidence'][0]['quote'] = 'x\ny'),
  'an evidence quote with a carriage return': (v) => (v['criteria'][0]['evidence'][0]['quote'] = 'x\ry'),
  'an empty evidence quote': (v) => (v['criteria'][0]['evidence'][0]['quote'] = ''),
  'an evidence quote of 301 characters': (v) => (v['criteria'][0]['evidence'][0]['quote'] = 'q'.repeat(301)),
  'an empty evidence file': (v) => (v['criteria'][0]['evidence'][0]['file'] = ''),
  'an evidence file of 301 characters': (v) => (v['criteria'][0]['evidence'][0]['file'] = 'f'.repeat(301)),
  'eleven proofs for a criterion': (v) =>
    (v['criteria'][0]['evidence'] = Array.from({ length: 11 }, () => v['criteria'][0]['evidence'][0])),
};

Then('the committed review verdict schema is the JSON schema of the verdict contract', function () {
  const committed: unknown = JSON.parse(
    readFileSync(join(PKG, 'prompts', 'review-verdict.schema.json'), 'utf8'),
  );
  assert.deepEqual(
    committed,
    // draft-07: Claude Code 2.1.325 refuses the 2020-12 `$schema` zod writes by default (`--json-schema is not a valid
    // JSON Schema: no schema with key or ref …/draft/2020-12/schema`, measured), as the SDK does (journal §29).
    JSON.parse(JSON.stringify(z.toJSONSchema(ReviewVerdictSchema, { target: 'draft-07' }))),
  );
});

When('I parse a valid verdict', function () {
  this.state['verdict'] = parseReviewVerdict(valid());
});

Then('the parsed verdict is the valid verdict', function () {
  assert.deepEqual(stored<ReviewVerdict>(this, 'verdict'), valid());
});

When('I break a copy of the valid verdict with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const broken = valid();
  breakIt(broken);
  this.state['broken'] = broken;
});

Then('parsing the broken verdict fails', function () {
  assert.throws(() => parseReviewVerdict(stored(this, 'broken')));
});

Given('a verdict {string} with finding levels {string}', function (verdict: string, levels: string) {
  this.state['verdict'] = parseReviewVerdict({
    verdict,
    findings:
      levels === ''
        ? []
        : levels.split(',').map((level) => ({ level, file: 'f', line: 1, quote: 'q', reason: 'r' })),
    not_checked: [],
    criteria: [],
  });
});

Given('a verdict {string} with criteria statuses {string}', function (verdict: string, statuses: string) {
  this.state['verdict'] = parseReviewVerdict({
    verdict,
    findings: [],
    not_checked: [],
    criteria: statuses.split(',').map((status, index) => ({
      id: `AC-00${index + 1}`,
      status,
      evidence: [],
      reason: 'r',
    })),
  });
});

Then('the verdict blocks is {word}', function (expected: string) {
  assert.equal(blocks(stored<ReviewVerdict>(this, 'verdict')), expected === 'true');
});

Then('a verdict of {int} quote characters on the boundary parses', function (length: number) {
  const verdict = valid();
  verdict['criteria'][0]['evidence'][0]['quote'] = 'q'.repeat(length);
  verdict['criteria'][0]['evidence'][0]['file'] = 'f'.repeat(length);
  verdict['criteria'][0]['evidence'] = Array.from(
    { length: 10 },
    () => verdict['criteria'][0]['evidence'][0],
  );
  assert.doesNotThrow(() => parseReviewVerdict(verdict));
});

Then(
  /^the criteria of the valid verdict against "([^"]*)" are refused with: (.*)$/,
  function (ids: string, reason: string) {
    const files = new Map([['src/a.ts', 'line\n'.repeat(11) + 'x = 1\n']]);
    const expected = ids === '' ? [] : ids.split(' ');
    assert.equal(
      criteriaRefusal(parseReviewVerdict(valid()), expected, (path) => files.get(path)) ?? 'none',
      reason,
    );
  },
);

Then('the acceptance block for {string} is:', function (ids: string, text: string) {
  assert.equal(renderAcceptance(ids.split(' ')), `${text}\n`);
});
