import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { parseReviewedPlanReply } from '../../src/plan.js';

function reviewedReceipt() {
  const define = 'a'.repeat(64);
  const plan = 'b'.repeat(64);
  return {
    reviewed_plan: {
      version: 1,
      run_id: 'reviewed-run',
      define_sha256: define,
      proposal_sha256: 'c'.repeat(64),
      plan_sha256: plan,
      proposal: {
        step: 'delivery',
        objective: ' Keep the signed text. ',
        verification: 'Check.',
        acceptance_ids: ['AC-1'],
      },
      drafter: { provider: 'anthropic', model: 'claude-test.1' },
      reviewer: { provider: 'openai', model: 'gpt-test:1' },
      verdict: { plan_sha256: plan, status: 'clear', findings: [] as string[] },
    },
    define_review: {
      version: 1,
      define_sha256: define,
      input_sha256: 'd'.repeat(64),
      drafter: { provider: 'google', model: 'gemini_test' },
      reviewer: { provider: 'anthropic', model: 'claude-test.2' },
      axes: {
        scope_creep: { status: 'clear', citations: [{ source_id: 'requirement', quote: ' Exact quote. ' }] },
        missing_edge_case: { status: 'clear', citations: [] },
      },
    },
  };
}

const parse = (receipt: unknown) => parseReviewedPlanReply([{ type: 'text', text: JSON.stringify(receipt) }]);

Then('the reviewed Plan reply preserves its exact bytes as field values', function () {
  const receipt = reviewedReceipt();
  assert.deepEqual(parse(receipt), receipt);
});

Then('a reviewed Plan with {string} is rejected', function (change: string) {
  const receipt = reviewedReceipt();
  const { reviewed_plan: plan, define_review: define } = receipt;
  const citation = define.axes.scope_creep.citations[0]!;
  switch (change) {
    case 'same Plan provider':
      plan.reviewer.provider = plan.drafter.provider;
      break;
    case 'same Plan model':
      plan.reviewer.model = plan.drafter.model;
      break;
    case 'same Define provider':
      define.reviewer.provider = define.drafter.provider;
      break;
    case 'same Define model':
      define.reviewer.model = define.drafter.model;
      break;
    case 'different Define digest':
      define.define_sha256 = 'e'.repeat(64);
      break;
    case 'different verdict digest':
      plan.verdict.plan_sha256 = 'e'.repeat(64);
      break;
    case 'prefixed digest':
      define.input_sha256 = '!' + define.input_sha256;
      break;
    case 'suffixed digest':
      define.input_sha256 += '!';
      break;
    case 'prefixed model':
      plan.drafter.model = '!' + plan.drafter.model;
      break;
    case 'suffixed model':
      plan.drafter.model += '!';
      break;
    case 'blank objective':
      plan.proposal.objective = '  ';
      break;
    case 'blank citation':
      citation.quote = '  ';
      break;
    case 'absent citation source':
      Reflect.deleteProperty(citation, 'source_id');
      break;
    case 'empty criteria':
      plan.proposal.acceptance_ids = [];
      break;
    case 'nonempty verdict findings':
      plan.verdict.findings.push('open');
      break;
    default:
      assert.fail(change);
  }
  assert.throws(() => parse(receipt), { name: 'ZodError' });
});
