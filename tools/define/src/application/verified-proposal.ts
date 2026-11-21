import { createHash } from 'node:crypto';
import { parseDefinePlanningReply, parseVerifiedPlanReply } from '@architect-os/contracts';

function digest(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex');
}
function jsonFile(value: unknown) {
  return JSON.stringify(value) + '\n';
}

/** Verify the file bytes the downstream Plan command will actually consume. */
export function verifiedProposal(
  define: Uint8Array,
  runId: string,
  step: string,
  content: readonly unknown[],
): string {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(define);
  const { handoff } = parseDefinePlanningReply([{ type: 'text', text }]);
  const { verified_plan: plan } = parseVerifiedPlanReply(content);
  const proposal = jsonFile(plan.proposal);
  const binding = {
    version: plan.version,
    run_id: runId,
    define_sha256: digest(define),
    proposal_sha256: digest(proposal),
  };
  if (
    handoff.run_id !== runId ||
    plan.run_id !== runId ||
    plan.proposal.step !== step ||
    plan.define_sha256 !== binding.define_sha256 ||
    plan.proposal_sha256 !== binding.proposal_sha256 ||
    plan.plan_sha256 !== digest(jsonFile(binding))
  )
    throw new Error();
  return proposal;
}
