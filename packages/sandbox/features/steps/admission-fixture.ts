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
  // A routed Step can run each pass of its ladder: one specimen per builder, and per review that does not wait.
  const routing = subject.step.routing;
  const builds = routing
    ? routing.ladder.flatMap(({ build, review }, index) => {
        const suffix = index === 0 ? '' : `:pass-${index + 1}`;
        return [
          {
            role: 'build' + suffix,
            provider: build.provider,
            model: build.model,
            prompt: 'prompts/build.md',
          },
          ...(review.waiting
            ? []
            : [
                {
                  role: 'review:independent' + suffix,
                  provider: review.provider,
                  model: review.model,
                  prompt: 'prompts/review.md',
                },
              ]),
        ];
      })
    : [
        {
          role: 'build',
          provider: subject.step.build.provider ?? 'anthropic',
          model: subject.step.build.model,
          prompt: 'prompts/build.md',
        },
      ];
  const slots = [
    ...builds,
    ...subject.step.scouts.map(({ name, model }) => ({
      role: 'scout:' + name,
      provider: 'anthropic',
      model,
      prompt: 'prompts/scout.md',
    })),
    ...subject.step.reviews.map(({ name, model }) => ({
      role: 'review:' + name,
      provider: 'anthropic',
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
  // The review of a promoted pass is proven on a case with a status for each finding of the pass before (R5).
  const promotedCase = {
    ...reviewCase,
    id: 'rule-on-prior-findings',
    expected: { ...reviewCase.expected, prior_findings: [{ id: 'PF-1', status: 'resolved' }] },
  };
  const casesOf = (role: string) =>
    /^review:independent:pass-\d+$/.test(role) ? [reviewCase, promotedCase] : [reviewCase];
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
    specimens: slots.map(({ role, provider, model, prompt }) => ({
      role,
      model: { provider, model },
      prompt_sha256: hash(subject.launcher[prompt]!),
      oracle_sha256: hash('The receipt is named and correctly attributed'),
      ...(role.startsWith('review:')
        ? {
            cases_sha256: hash(
              JSON.stringify(
                casesOf(role).map(({ id, input_sha256, expected }) => ({ id, input_sha256, expected })),
              ),
            ),
            results: casesOf(role).map((item) => ({ ...item, observed: item.expected })),
          }
        : {
            cases_sha256: hash(JSON.stringify([caseInput])),
            results: [{ ...caseInput, observed: expected }],
          }),
    })),
  };
  return { version: 1, approved_sha256: hash(JSON.stringify(payload)), payload };
}
