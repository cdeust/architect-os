import assert from 'node:assert/strict';
import type { ReviewVerdict } from '../../src/review-verdict.js';
import { renderFindings, renderPriorFindings } from '../../src/step-passes.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';

interface Rendered {
  findings: ReviewVerdict['findings'];
  build?: string[];
  review?: { text: string; ids: string[] };
}
const rendered = (world: SandboxWorld) => stored<Rendered>(world, 'passFindings');

Given(
  '{int} blocking findings, each with a reason of {int} characters',
  function (count: number, length: number) {
    this.state['passFindings'] = {
      findings: Array.from({ length: count }, () => ({
        level: 'correctness' as const,
        file: 'f',
        line: 1,
        quote: 'q',
        reason: 'x'.repeat(length),
      })),
    } satisfies Rendered;
  },
);

When('the host renders them for the next build within {int} bytes', function (bound: number) {
  const r = rendered(this);
  r.build = renderFindings(r.findings, bound);
});

When('the host renders them for the next review within {int} bytes', function (bound: number) {
  const r = rendered(this);
  r.review = renderPriorFindings(r.findings, bound);
});

/** A kept finding is written by its rank; any other line as it is. */
Then('the build lines are {string}', function (expected: string) {
  const entry = `- correctness "f":1 "${'x'.repeat(28)}"`;
  assert.equal(
    rendered(this)
      .build!.map((line, index) => (line === entry ? String(index + 1) : line))
      .join('; '),
    expected,
  );
});

Then('the review is asked to rule on {string}', function (ids: string) {
  assert.equal(rendered(this).review!.ids.join(' '), ids);
});

Then('the review lines end with: {}', function (last: string) {
  const lines = rendered(this).review!.text.trimEnd().split('\n');
  assert.equal(lines.at(-1), last);
  assert.ok(lines.includes('## Findings of the previous review'));
});
