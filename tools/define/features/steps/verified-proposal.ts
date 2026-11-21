import { parseVerifiedPlanReply } from '@architect-os/contracts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runProposal } from '../../src/proposal.js';
import { Then } from '@cucumber/cucumber';
import { verifiedProposal } from '../../src/application/verified-proposal.js';

Then('the verified proposal with {string} yields {string}', async function (change: string, outcome: string) {
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
  if (change === 'define digest') plan.define_sha256 = sha('wrong');
  if (change === 'proposal digest') plan.proposal_sha256 = sha('wrong');
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
  else if (
    !['missing 0', 'missing 1', 'missing 2', 'missing 3', 'extra', 'refusal', 'transport'].includes(change)
  )
    assert.throws(consume);
  const root = mkdtempSync(join(tmpdir(), 'verified-proposal-'));
  try {
    const path = join(root, 'define');
    writeFileSync(path, define + (change === 'define bytes' ? '\n' : ''));
    const step = change === 'step' ? 'different' : 'audit';
    let out = '',
      err = '',
      reads = 0;
    const args = [run, 'fixture-plugin', step, path];
    if (/^missing [0-3]$/.test(change)) args[Number(change.at(-1))] = '';
    if (change === 'extra') args.push('extra');
    const invalidArgs = change.startsWith('missing ') || change === 'extra';
    const proc = {
      argv: ['node', 'proposal', ...args],
      execPath: 'trusted-node',
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    };
    const code = await runProposal(proc, async (node, plugin, args) => {
      ++reads;
      assert.equal(node, 'trusted-node');
      assert.equal(plugin, resolve('fixture-plugin'));
      assert.deepEqual(args, { run_id: run, format: 'verified_plan_v1', plan_step: step });
      if (change === 'transport') throw new Error();
      return {
        isError: change === 'refusal',
        content: [{ type: 'text', text: file({ verified_plan: plan }) }],
      };
    });
    assert.equal(reads, invalidArgs ? 0 : 1);
    const transport = change === 'transport';
    assert.equal(code, transport ? 3 : outcome === 'accept' ? 0 : 2);
    assert.equal(out, outcome === 'accept' ? file(proposal) : '');
    assert.equal(
      err,
      invalidArgs
        ? 'usage: plan:proposal <run_id> <prd-gen-plugin-root> <step> <define-file>\n'
        : transport
          ? 'architect-os proposal: PLAN_TRANSPORT_FAILED\n'
          : outcome === 'accept'
            ? ''
            : 'architect-os proposal: PLAN_PROJECTION_REFUSED\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Then('the projection rejects noncanonical hash text', function () {
  const hash = 'a'.repeat(64);
  for (const invalid of ['x' + hash, hash + 'x'])
    assert.throws(() =>
      parseVerifiedPlanReply([
        {
          type: 'text',
          text: JSON.stringify({
            verified_plan: {
              version: 1,
              run_id: 'ok',
              define_sha256: invalid,
              proposal_sha256: hash,
              plan_sha256: hash,
              proposal: { step: 'x', objective: 'x', verification: 'x', acceptance_ids: ['AC-1'] },
            },
          }),
        },
      ]),
    );
});
Then('the projection rejects malformed or prefixed Define bytes even with a matching binding', function () {
  const handoff = {
    version: 1,
    run_id: 'id',
    requirements: [{ id: 'FR-1', text: 'word TARGET' }],
    acceptance: [{ id: 'AC-1', text: 'read', requirement_ids: ['FR-1'] }],
  };
  const file = (x: unknown) => JSON.stringify(x) + '\n';
  const raw = file({ handoff });
  const proposal = { step: 'x', objective: 'x', verification: 'x', acceptance_ids: ['AC-1'] };
  const sha = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex');
  for (const bytes of [
    Buffer.from('\ufeff' + raw),
    Buffer.concat([
      Buffer.from(raw.split('TARGET')[0]!),
      Buffer.from([255]),
      Buffer.from(raw.split('TARGET')[1]!),
    ]),
  ]) {
    const binding = {
      version: 1,
      run_id: 'id',
      define_sha256: sha(bytes),
      proposal_sha256: sha(file(proposal)),
    };
    assert.throws(() =>
      verifiedProposal(bytes, 'id', 'x', [
        {
          type: 'text',
          text: file({ verified_plan: { ...binding, plan_sha256: sha(file(binding)), proposal } }),
        },
      ]),
    );
  }
});
