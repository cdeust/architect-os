import assert from 'node:assert/strict';
import type { ReviewVerdict } from '../../src/review-verdict.js';
import {
  renderFindings,
  renderPriorFindings,
  renderPromotion,
  type PassSignal,
} from '../../src/step-passes.js';
import type { CheckReport } from '../../src/step-checks.js';
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

interface Promotion {
  pass: number;
  model: string;
  signal: PassSignal;
  checks: CheckReport[];
  findings: ReviewVerdict['findings'];
  text?: string;
}
const promotion = (world: SandboxWorld) => stored<Promotion>(world, 'promotion');
const lint: CheckReport = {
  name: 'lint',
  command: ['npm', 'run', 'lint'],
  exitCode: 1,
  stopped: false,
  durationSeconds: 2,
  cut: false,
  output: 'E1',
};
const wrong = { level: 'correctness' as const, file: 'src/a.ts', line: 3, quote: 'x', reason: 'wrong' };

Given(
  'a promoted pass {int} on {string} on the signal {string}, with the failed check {string} and no finding',
  function (pass: number, model: string, signal: string, check: string) {
    assert.equal(check, 'lint');
    this.state['promotion'] = {
      pass,
      model,
      signal: signal as PassSignal,
      checks: [lint],
      findings: [],
    } satisfies Promotion;
  },
);

Given(
  'a promoted pass {int} on {string} on the signal {string}, with no failed check and one finding',
  function (pass: number, model: string, signal: string) {
    this.state['promotion'] = {
      pass,
      model,
      signal: signal as PassSignal,
      checks: [],
      findings: [wrong],
    } satisfies Promotion;
  },
);

When('the host renders the promotion within {int} bytes', function (bound: number) {
  const p = promotion(this);
  p.text = renderPromotion({ pass: p.pass, model: p.model, signal: p.signal }, p.checks, p.findings, bound);
});

When('the host renders the prior findings within {int} bytes', function (bound: number) {
  const p = promotion(this);
  p.text = renderPriorFindings(p.findings, bound).text;
});

Then('the promotion is, with its final line break:', function (expected: string) {
  assert.equal(promotion(this).text, `${expected}\n`);
});
