import { createHash } from 'node:crypto';
import { parseDefinePlanningReply, parsePlanProposal } from '@architect-os/contracts';

export interface PlanSources {
  readonly define: string;
  readonly proposal: string;
  readonly policy: string;
}

export interface StepInputs {
  readonly stepJson: string;
  readonly questions: Readonly<Record<string, string>>;
}

export function preparePlan(sources: PlanSources, inputs: StepInputs) {
  const { handoff } = parseDefinePlanningReply([{ type: 'text', text: sources.define }]);
  const proposal = parsePlanProposal(JSON.parse(sources.proposal));
  const expected = new Set(handoff.acceptance.map(({ id }) => id));
  const chosen = proposal.acceptance_ids;
  if (
    expected.size !== chosen.length ||
    new Set(chosen).size !== chosen.length ||
    chosen.some((id) => !expected.has(id))
  ) {
    throw new Error('PLAN_COVERAGE_INVALID');
  }

  // The model sees these strings as data in one JSON block. Only Step's host policy can select commands and models.
  const data = {
    run_id: handoff.run_id,
    ...proposal,
    requirements: handoff.requirements,
    acceptance: handoff.acceptance,
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
  const files = { 'brief.md': brief, ...inputs.questions, 'step.json': inputs.stepJson };
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  const manifest = {
    version: 1,
    run_id: handoff.run_id,
    step: proposal.step,
    source_sha256: {
      define: sha256(sources.define),
      proposal: sha256(sources.proposal),
      policy: sha256(sources.policy),
    },
    files_sha256: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha256(text)])),
  };
  return { manifest, approval_sha256: sha256(JSON.stringify(manifest)), files };
}
