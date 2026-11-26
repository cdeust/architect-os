import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifiedProposal } from './application/verified-proposal.js';
import { readProjection } from './infrastructure/prd-gen.js';
import { isBundleDigest } from './domain/bundle.js';

interface ProposalProcess {
  argv: readonly string[];
  execPath: string;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}
export async function runProposal(proc: ProposalProcess, read = readProjection) {
  const [run_id, root, sha256, plan_step, define, ...extra] = proc.argv.slice(2);
  if (!run_id || !root || !isBundleDigest(sha256) || !plan_step || !define || extra.length) {
    proc.stderr.write(
      'usage: plan:proposal <run_id> <prd-gen-plugin-root> <producer-sha256> <step> <define-file>\n',
    );
    return 2;
  }
  try {
    const reply = await read(proc.execPath, resolve(root), sha256, {
      run_id,
      format: 'verified_plan_v1',
      plan_step,
    });
    try {
      if (reply.isError) throw new Error();
      proc.stdout.write(verifiedProposal(readFileSync(define), run_id, plan_step, reply.content));
      return 0;
    } catch {
      proc.stderr.write('architect-os proposal: PLAN_PROJECTION_REFUSED\n');
      return 2;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SPEC_PRODUCER_')) {
      proc.stderr.write(`architect-os proposal: ${error.message}\n`);
      return 2;
    }
    proc.stderr.write('architect-os proposal: PLAN_TRANSPORT_FAILED\n');
    return 3;
  }
}
