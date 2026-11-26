import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  buildClaimsSchema,
  claimLine,
  claimsBlock,
  parseClaims,
  renderClaims,
  type GivenClaim,
} from '../../src/build-claims.js';
import { PKG, Then, When, stored } from './helpers.js';

type Json = Record<string, any>;

const claim = (): Json => ({
  brief_item: 'Keep the list in one file',
  instead: 'Two files',
  evidence: [{ file: 'src/a.ts', line: 3 }, { command: 'npm test' }],
});
const block = (): Json => ({ claims: [claim()] });

const DEFECTS: Record<string, (b: Json) => unknown> = {
  'no claims key': (b) => delete b['claims'],
  'an extra key at the top': (b) => (b['note'] = 'x'),
  'twenty-one claims': (b) => (b['claims'] = Array.from({ length: 21 }, claim)),
  'a missing brief item': (b) => delete b['claims'][0]['brief_item'],
  'an empty brief item': (b) => (b['claims'][0]['brief_item'] = ''),
  'a brief item of 501 characters': (b) => (b['claims'][0]['brief_item'] = 'b'.repeat(501)),
  'a brief item on two lines': (b) => (b['claims'][0]['brief_item'] = 'a\n## Verdict'),
  'a missing instead': (b) => delete b['claims'][0]['instead'],
  'an empty instead': (b) => (b['claims'][0]['instead'] = ''),
  'an instead of 2001 characters': (b) => (b['claims'][0]['instead'] = 'i'.repeat(2001)),
  'an instead with a carriage return': (b) => (b['claims'][0]['instead'] = 'a\rb'),
  'a missing evidence': (b) => delete b['claims'][0]['evidence'],
  'no evidence': (b) => (b['claims'][0]['evidence'] = []),
  'eleven proofs': (b) => (b['claims'][0]['evidence'] = Array.from({ length: 11 }, () => ({ command: 'x' }))),
  'a proof with a file and a command': (b) =>
    (b['claims'][0]['evidence'] = [{ file: 'src/a.ts', line: 3, command: 'npm test' }]),
  'a file proof without its line': (b) => (b['claims'][0]['evidence'] = [{ file: 'src/a.ts' }]),
  'a file proof on line 0': (b) => (b['claims'][0]['evidence'][0]['line'] = 0),
  'a file proof on a fractional line': (b) => (b['claims'][0]['evidence'][0]['line'] = 1.5),
  'an empty file': (b) => (b['claims'][0]['evidence'][0]['file'] = ''),
  'a file of 301 characters': (b) => (b['claims'][0]['evidence'][0]['file'] = 'f'.repeat(301)),
  'a file on two lines': (b) => (b['claims'][0]['evidence'][0]['file'] = 'a\nb'),
  'an empty command': (b) => (b['claims'][0]['evidence'][1]['command'] = ''),
  'a command of 501 characters': (b) => (b['claims'][0]['evidence'][1]['command'] = 'c'.repeat(501)),
  'a command on two lines': (b) => (b['claims'][0]['evidence'][1]['command'] = 'a\nb'),
  'an extra key in a claim': (b) => (b['claims'][0]['note'] = 'x'),
};

/** The outcome of `claimsBlock` as a scenario writes it: `absent`, `invalid "<reason>"` or `found <json>`. */
const outcome = (report: string): string => {
  const found = claimsBlock(report);
  if (found.state === 'absent') return 'absent';
  if (found.state === 'invalid') return `invalid ${JSON.stringify(found.reason)}`;
  return `found ${JSON.stringify(found.raw)}`;
};

/** A report whose block body is `{"claims":[]}` padded with blanks to `bytes` bytes. */
const padded = (bytes: number): string => {
  const body = '{"claims":[]}';
  return `\`\`\`claims\n${body}${' '.repeat(bytes - body.length)}\n\`\`\``;
};

Then('the committed build claims schema is the JSON schema of the claims contract', function () {
  const committed: unknown = JSON.parse(
    readFileSync(join(PKG, 'prompts', 'build-claims.schema.json'), 'utf8'),
  );
  assert.deepEqual(
    committed,
    JSON.parse(JSON.stringify(z.toJSONSchema(buildClaimsSchema(), { target: 'draft-07' }))),
  );
});

When('the host reads the claims block of the report {string}', function (report: string) {
  // Gherkin reads \n in a table cell as a line end; \r is written as is and read here as a carriage return.
  this.state['claimsOutcome'] = outcome(report.replaceAll('\\r', '\r').replaceAll('\\n', '\n'));
});

Then('the claims block is {}', function (expected: string) {
  assert.equal(stored<string>(this, 'claimsOutcome'), expected);
});

Then('a claims block whose body has {int} bytes is found', function (bytes: number) {
  assert.equal(outcome(padded(bytes)), 'found {"claims":[]}');
});

Then(
  'a claims block whose body has {int} bytes is invalid {string}',
  function (bytes: number, reason: string) {
    assert.equal(outcome(padded(bytes)), `invalid ${JSON.stringify(reason)}`);
  },
);

When('the host validates the claims:', function (text: string) {
  this.state['given'] = parseClaims(JSON.parse(text));
});

Then('the given claims are:', function (expected: string) {
  assert.deepEqual(stored<GivenClaim[]>(this, 'given'), JSON.parse(expected));
});

Then('claims at their bounds are valid', function () {
  const bounded = {
    brief_item: 'b'.repeat(500),
    instead: 'i'.repeat(2000),
    evidence: [
      ...Array.from({ length: 9 }, () => ({ command: 'c'.repeat(500) })),
      { file: 'f'.repeat(300), line: 1 },
    ],
  };
  const given = parseClaims({ claims: Array.from({ length: 20 }, () => bounded) });
  assert.deepEqual(
    given.map(({ id }) => id),
    Array.from({ length: 20 }, (_, index) => `CL-${index + 1}`),
  );
});

When('I break a copy of a valid claims block with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const broken = block();
  assert.doesNotThrow(() => parseClaims(block()));
  breakIt(broken);
  this.state['brokenClaims'] = broken;
});

Then('validating the broken claims block fails', function () {
  assert.throws(() => parseClaims(stored(this, 'brokenClaims')), z.ZodError);
});

Then(
  'the block of the claim with the brief item {string} and the instead {string} is:',
  function (briefItem: string, instead: string, expected: string) {
    const [given] = parseClaims({
      claims: [
        {
          brief_item: JSON.parse(`"${briefItem}"`) as string,
          instead: JSON.parse(`"${instead}"`) as string,
          evidence: [{ command: 'true' }],
        },
      ],
    });
    this.state['injected'] = given;
    assert.equal(renderClaims([given!]), `${expected}\n`);
  },
);

Then('the quoted line of that claim parses back to the claim', function () {
  const given = stored<GivenClaim>(this, 'injected');
  assert.deepEqual(JSON.parse(claimLine(given)), given);
  assert.equal(claimLine(given).split(/[\n\r\u2028\u2029`]/).length, 1);
});
