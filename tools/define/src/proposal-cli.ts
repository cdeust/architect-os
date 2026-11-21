import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifiedProposal } from './application/verified-proposal.js';
import { readProjection } from './infrastructure/prd-gen.js';

const [run_id, root, plan_step, define, ...extra] = process.argv.slice(2);
if (!run_id || !root || !plan_step || !define || extra.length) {
  process.stderr.write('usage: plan:proposal <run_id> <prd-gen-plugin-root> <step> <define-file>\n');
  process.exitCode = 2;
} else {
  try {
    const reply = await readProjection(process.execPath, resolve(root), {
      run_id,
      format: 'verified_plan_v1',
      plan_step,
    });
    try {
      if (reply.isError) throw new Error();
      process.stdout.write(verifiedProposal(readFileSync(define), run_id, plan_step, reply.content));
    } catch {
      process.stderr.write('architect-os proposal: PLAN_PROJECTION_REFUSED\n');
      process.exitCode = 2;
    }
  } catch {
    process.stderr.write('architect-os proposal: PLAN_TRANSPORT_FAILED\n');
    process.exitCode = 3;
  }
}
