import { readFileSync } from 'node:fs';
import { parsePlanApproval } from '@architect-os/contracts';
import { preparePlan } from './application/prepare.js';
import { approvedReviewedPlan } from './application/admit.js';
import { admissionFolder, issueAdmission, type Issue } from './infrastructure/admission.js';
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
  // A reviewed Plan is materialized like any other: the folder starts nothing until `npm run admit` has verified its
  // specimens and issued the receipt Step requires (journal, §123).
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

const ADMIT_USAGE =
  'usage: admit <define> <reviewed-plan> <policy> <decision> <specimens> <step-folder> <worktree>';

/**
 * `npm run admit` : émet le reçu d'admission d'une étape après avoir vérifié ce qu'il atteste (journal, §123). Une
 * entrée distincte de `npm run step`, qui ne l'appelle jamais. Code de sortie : 0 (émis), 2 (refus nommé), 3 (erreur
 * inattendue, rien n'est attesté).
 */
export function runAdmit(proc: PlanProcess, issue: Issue = issueAdmission): number {
  const args = proc.argv.slice(2);
  const fail = (message: string, code = 2): number => {
    proc.stderr.write(`architect-os admit: ${message}\n`);
    return code;
  };
  if (args.length !== 7 || args.some((arg) => arg === '')) return fail(ADMIT_USAGE);
  const [define, proposal, policy, decision, specimens, folder, worktree] = args as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  try {
    let draft: ReturnType<typeof preparePlan>;
    try {
      const sources = { define: readText(define), proposal: readText(proposal), policy: readText(policy) };
      draft = preparePlan(sources, readStepInputs(sources.policy));
    } catch {
      throw new Error('ADMIT_INPUT_INVALID');
    }
    const plan = approvedReviewedPlan(draft, () => readText(decision));
    let measured: unknown;
    try {
      measured = JSON.parse(readText(specimens));
    } catch {
      throw new Error('ADMIT_SPECIMENS_REQUIRED');
    }
    const issued = issue({
      plan,
      specimens: measured,
      folder: admissionFolder(folder, plan.manifest.step),
      worktree,
    });
    proc.stdout.write(`${JSON.stringify({ status: 'issued', step: plan.manifest.step, ...issued })}\n`);
    return 0;
  } catch (error) {
    // Only a named refusal keeps its name; anything else attests nothing.
    if (error instanceof Error && /^ADMIT_[A-Z_]+$/.test(error.message)) return fail(error.message);
    return fail('ADMIT_UNEXPECTED_ERROR', 3);
  }
}
