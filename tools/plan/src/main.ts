import { readFileSync } from 'node:fs';
import { parsePlanApproval } from '@architect-os/contracts';
import { preparePlan } from './application/prepare.js';
import { readStepInputs, isStepName } from './infrastructure/step-inputs.js';
import { publishStepInputs } from './infrastructure/publish.js';

interface PlanProcess {
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

function readText(path: string): string {
  // Preserve BOMs and refuse ill-formed UTF-8 so the SHA-256 covers the actual source bytes.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
}

export function runPlan(proc: PlanProcess): number {
  const [action, define, proposal, policy, ...extra] = proc.argv.slice(2);
  const refuse = (error: string): number => {
    proc.stderr.write(`architect-os plan: ${error}\n`);
    return 2;
  };
  if (
    !define ||
    !proposal ||
    !policy ||
    !((action === 'prepare' && extra.length === 0) || (action === 'materialize' && extra.length === 2))
  ) {
    return refuse(
      'usage: plan prepare <define> <proposal> <policy> | plan materialize <define> <proposal> <policy> <decision> <folder>',
    );
  }

  let draft: ReturnType<typeof preparePlan>;
  try {
    const sources = {
      define: readText(define),
      proposal: readText(proposal),
      policy: readText(policy),
    };
    draft = preparePlan(sources, readStepInputs(sources.policy));
  } catch {
    return refuse('PLAN_INPUT_INVALID');
  }
  if (!isStepName(draft.manifest.step)) return refuse('PLAN_STEP_INVALID');
  if (action === 'prepare') {
    proc.stdout.write(`${JSON.stringify({ status: 'pending', ...draft })}\n`);
    return 0;
  }

  const [decisionPath, folder] = extra;
  try {
    const decision = parsePlanApproval(JSON.parse(readText(decisionPath!)));
    if (decision.approval_sha256 !== draft.approval_sha256) return refuse('PLAN_NOT_APPROVED');
  } catch {
    return refuse('PLAN_NOT_APPROVED');
  }
  if (draft.manifest.source_sha256.reviewed_plan) return refuse('PLAN_SPECIMEN_EVIDENCE_REQUIRED');
  try {
    publishStepInputs(folder!, draft.manifest.step, draft.files);
  } catch {
    return refuse('PLAN_PUBLISH_REFUSED');
  }
  proc.stdout.write(
    `${JSON.stringify({ status: 'materialized', manifest: draft.manifest, approval_sha256: draft.approval_sha256, folder })}\n`,
  );
  return 0;
}
