import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  blocks,
  parseReviewVerdict,
  ReviewVerdictSchema,
  type ReviewVerdict,
} from '../../src/review-verdict.js';
import { Given, PKG, Then, When, stored } from './helpers.js';

const valid = (): Record<string, any> => ({
  verdict: 'request_changes',
  findings: [{ level: 'correctness', file: 'src/a.ts', line: 12, quote: 'x = 1', reason: 'wrong' }],
  not_checked: ['the replay'],
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
  });
});

Then('the verdict blocks is {word}', function (expected: string) {
  assert.equal(blocks(stored<ReviewVerdict>(this, 'verdict')), expected === 'true');
});
