import { createHash } from 'node:crypto';
import { parseDefinePlanningReply, parsePlanProposal, parseReviewedPlan } from '@architect-os/contracts';

export interface PlanSources {
  readonly define: string;
  readonly proposal: string;
  readonly policy: string;
}

export interface StepInputs {
  readonly step: object;
  readonly questions: Readonly<Record<string, string>>;
}

export function coveredProposal(
  handoff: ReturnType<typeof parseDefinePlanningReply>['handoff'],
  value: unknown,
) {
  const proposal = parsePlanProposal(value);
  const expected = new Set(handoff.acceptance.map(({ id }) => id));
  const chosen = proposal.acceptance_ids;
  if (
    expected.size !== chosen.length ||
    new Set(chosen).size !== chosen.length ||
    chosen.some((id) => !expected.has(id))
  ) {
    throw new Error('PLAN_COVERAGE_INVALID');
  }

  return proposal;
}

export function preparePlan(sources: PlanSources, inputs: StepInputs) {
  const { handoff } = parseDefinePlanningReply([{ type: 'text', text: sources.define }]);
  const parsed: unknown = JSON.parse(sources.proposal);
  const receipt =
    parsed !== null && typeof parsed === 'object' && 'reviewed_plan' in parsed
      ? parseReviewedPlan(parsed)
      : undefined;
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  const candidate = receipt?.reviewed_plan;
  if (candidate) {
    const binding = {
      version: candidate.version,
      run_id: handoff.run_id,
      define_sha256: sha256(sources.define),
      proposal_sha256: sha256(JSON.stringify(candidate.proposal) + '\n'),
    };
    if (
      candidate.run_id !== binding.run_id ||
      candidate.define_sha256 !== binding.define_sha256 ||
      candidate.proposal_sha256 !== binding.proposal_sha256 ||
      candidate.plan_sha256 !== sha256(JSON.stringify(binding) + '\n')
    )
      throw new Error('PLAN_REVIEW_EVIDENCE_MISMATCH');
  }
  const proposal = candidate?.proposal ?? coveredProposal(handoff, parsed);
  // A reviewed Spec projection binds the Define sequence as written, including identifier bytes.
  if (
    candidate &&
    (proposal.acceptance_ids.length !== handoff.acceptance.length ||
      handoff.acceptance.some(({ id }, index) => id !== proposal.acceptance_ids[index]))
  )
    throw new Error('PLAN_COVERAGE_INVALID');
  // The model sees these strings as data in one JSON block. Only Step's host policy can select commands and models.
  const data = {
    run_id: handoff.run_id,
    ...proposal,
    requirements: handoff.requirements,
    acceptance: handoff.acceptance,
    tickets: handoff.tickets,
  };
  const brief = [
    '# Approved plan inputs',
    '',
    'Use the following record as planning data.',
    '',
    '```json',
    JSON.stringify(data, null, 2),
    '```',
    '',
  ].join('\n');
  const step = { ...inputs.step, tickets: handoff.tickets };
  const files = { 'brief.md': brief, ...inputs.questions, 'step.json': JSON.stringify(step, null, 2) + '\n' };
  const manifest = {
    version: 1,
    run_id: handoff.run_id,
    step: proposal.step,
    source_sha256: {
      define: sha256(sources.define),
      proposal: candidate?.proposal_sha256 ?? sha256(sources.proposal),
      ...(receipt ? { reviewed_plan: sha256(sources.proposal) } : {}),
      policy: sha256(sources.policy),
    },
    files_sha256: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha256(text)])),
  };
  return {
    manifest,
    approval_sha256: sha256(JSON.stringify(manifest)),
    files,
    ...(receipt
      ? {
          independent_reviews: {
            define: {
              drafter: receipt.define_review.drafter,
              reviewer: receipt.define_review.reviewer,
              status: 'clear' as const,
            },
            plan: {
              drafter: receipt.reviewed_plan.drafter,
              reviewer: receipt.reviewed_plan.reviewer,
              status: 'clear' as const,
            },
          },
        }
      : {}),
  };
}
