import { createHash } from 'node:crypto';
import type { StepAdmissionSubject } from '../../src/step-admission.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const files = (entries: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.keys(entries)
      .sort()
      .map((key) => [key, hash(entries[key]!)]),
  );

export function admittedFixture(
  subject: StepAdmissionSubject,
  approvedManifest?: {
    version: number;
    run_id: string;
    step: string;
    source_sha256: Record<string, string>;
    files_sha256: Record<string, string>;
  },
) {
  const author = { provider: 'openai', model: 'fixture-author' };
  const reviewer = { provider: 'google', model: 'fixture-reviewer' };
  const review = { drafter: author, reviewer, status: 'clear' };
  const define_sha256 = subject.define_sha256 ?? hash('fixture Define');
  const slots = [
    { role: 'build', model: subject.step.build.model, prompt: 'prompts/build.md' },
    ...subject.step.scouts.map(({ name, model }) => ({
      role: 'scout:' + name,
      model,
      prompt: 'prompts/scout.md',
    })),
    ...subject.step.reviews.map(({ name, model }) => ({
      role: 'review:' + name,
      model,
      prompt: 'prompts/review.md',
    })),
  ];
  const expected = { verdict: 'pass', findings: [] };
  const caseInput = { id: 'trace-a-local-receipt', input_sha256: hash('Replay a saved receipt'), expected };
  // A review prompt is proven on a case with a status for each acceptance criterion (R2).
  const reviewCase = {
    ...caseInput,
    expected: { ...expected, criteria: [{ id: 'AC-001', status: 'met' }] },
  };
  const manifest = approvedManifest ?? {
    version: 1,
    run_id: 'fixture-run',
    step: subject.name,
    source_sha256: {
      define: define_sha256,
      proposal: subject.proposal_sha256 ?? hash('fixture Plan'),
      reviewed_plan: subject.reviewed_plan_sha256 ?? hash('fixture proposal receipt'),
      policy: hash('fixture policy'),
    },
    files_sha256: files(subject.inputs),
  };
  const payload = {
    step: subject.name,
    worktree: {
      root: subject.worktree,
      ...subject.tree,
    },
    manifest,
    approval: { version: 1, decision: 'approve', approval_sha256: hash(JSON.stringify(manifest)) },
    inputs_sha256: files(subject.inputs),
    launcher_sha256: hash(JSON.stringify(files(subject.launcher))),
    define: { sha256: define_sha256, review },
    plan: {
      sha256: subject.proposal_sha256 ?? hash('fixture Plan'),
      define_sha256,
      raw_receipt_sha256: subject.reviewed_plan_sha256 ?? hash('fixture proposal receipt'),
      review,
    },
    specimens: slots.map(({ role, model, prompt }) => ({
      role,
      model: {
        provider: String(role === 'build' ? (subject.step.build.provider ?? 'anthropic') : 'anthropic'),
        model,
      },
      prompt_sha256: hash(subject.launcher[prompt]!),
      oracle_sha256: hash('The receipt is named and correctly attributed'),
      ...(role.startsWith('review:')
        ? {
            cases_sha256: hash(JSON.stringify([reviewCase])),
            results: [{ ...reviewCase, observed: reviewCase.expected }],
          }
        : {
            cases_sha256: hash(JSON.stringify([caseInput])),
            results: [{ ...caseInput, observed: expected }],
          }),
    })),
  };
  return { version: 1, approved_sha256: hash(JSON.stringify(payload)), payload };
}

/**
 * The proof of specimens a host replay would have measured for each role the Step launches: its route, the digest of
 * the prompt the launcher gives it, and one case whose observed outcome equals the expected one (a review case carries
 * a status per criterion).
 */
export function measuredSpecimens(
  step: StepAdmissionSubject['step'],
  launcher: Readonly<Record<string, string>>,
) {
  const prompt = (tool: string) =>
    hash(launcher[(JSON.parse(launcher[tool]!) as { launcherPromptFile: string }).launcherPromptFile]!);
  const expected = { verdict: 'pass', findings: [] as string[] };
  const plain = { id: 'trace-a-local-receipt', input_sha256: hash('Replay a saved receipt'), expected };
  const reviewed = { ...plain, expected: { ...expected, criteria: [{ id: 'AC-001', status: 'met' }] } };
  const proof = (role: string, provider: string, model: string, tool: string) => {
    const kase = role.startsWith('review:') ? reviewed : plain;
    return {
      role,
      model: { provider, model },
      prompt_sha256: prompt(tool),
      oracle_sha256: hash('The receipt is named and correctly attributed'),
      cases_sha256: hash(JSON.stringify([kase])),
      results: [{ ...kase, observed: kase.expected }],
    };
  };
  return [
    proof('build', step.build.provider ?? 'anthropic', step.build.model, 'code.json'),
    ...step.scouts.map(({ name, model }) => proof('scout:' + name, 'anthropic', model, 'scout.json')),
    ...step.reviews.map(({ name, model }) => proof('review:' + name, 'anthropic', model, 'review.json')),
  ];
}
