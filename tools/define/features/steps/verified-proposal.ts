import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { verifiedProposal } from '../../src/application/verified-proposal.js';

Then('the verified proposal with {string} yields {string}', function (change: string, outcome: string) {
  const file = (v: unknown) => JSON.stringify(v) + '\n';
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const run = 'run_fixture';
  const handoff = {
    version: 1,
    run_id: change === 'handoff run' ? 'run_other' : run,
    requirements: [{ id: 'FR-1', text: 'Keep evidence.' }],
    acceptance: [{ id: 'AC-1', text: 'Read evidence.', requirement_ids: ['FR-1'] }],
  };
  const define = file({ handoff });
  const proposal = {
    step: 'audit',
    objective: 'Keep evidence.',
    verification: 'Read evidence.',
    acceptance_ids: ['AC-1'],
  };
  const binding = {
    version: 1,
    run_id: run,
    define_sha256: sha(define),
    proposal_sha256: sha(file(proposal)),
  };
  const plan = { ...binding, plan_sha256: sha(file(binding)), proposal };
  if (change === 'proposal bytes') proposal.verification += ' Changed.';
  if (change === 'binding digest') plan.plan_sha256 = sha('other');
  if (change === 'run') plan.run_id = 'run_other';
  if (change === 'unknown field') Object.assign(plan, { decision: 'approve' });
  const consume = () =>
    verifiedProposal(
      Buffer.from(define + (change === 'define bytes' ? '\n' : '')),
      run,
      change === 'step' ? 'different' : 'audit',
      [{ type: 'text', text: file({ verified_plan: plan }) }],
    );
  if (outcome === 'accept') assert.equal(consume(), file(proposal));
  else assert.throws(consume);
});
