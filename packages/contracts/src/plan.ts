import { z } from 'zod';

export function parsePlanProposal(raw: unknown) {
  const text = z.string().trim().min(1);
  return z
    .strictObject({
      step: text,
      objective: text,
      verification: text,
      acceptance_ids: z.array(text).min(1),
    })
    .parse(raw);
}

export function parsePlanPolicy(raw: unknown) {
  return z
    .strictObject({
      step: z.unknown(),
      // z.record ignores an own __proto__ key. Reject it before parsing the question map.
      scout_questions: z
        .unknown()
        .refine((value) => !Object.hasOwn(Object(value), '__proto__'))
        .pipe(
          z.record(
            z.string(),
            z.string().refine((text) => text.trim() !== ''),
          ),
        ),
    })
    .parse(raw);
}

export function parsePlanApproval(raw: unknown) {
  return z
    .strictObject({
      version: z.literal(1),
      decision: z.literal('approve'),
      approval_sha256: z.string(),
    })
    .parse(raw);
}

/** ai-architect-mcp-spec packages/orchestration/src/verified-plan.ts, verified_plan_v1. */
export function parseVerifiedPlanReply(content: readonly unknown[]) {
  const [part] = z.tuple([z.object({ type: z.literal('text'), text: z.string() })]).parse(content);
  const sha = z.string().regex(/^[a-f0-9]{64}$/);
  return z
    .strictObject({
      verified_plan: z.strictObject({
        version: z.literal(1),
        run_id: z.string(),
        define_sha256: sha,
        proposal_sha256: sha,
        plan_sha256: sha,
        proposal: z.unknown().transform(parsePlanProposal),
      }),
    })
    .parse(JSON.parse(part.text));
}

const reviewSha = z.string().regex(/^[a-f0-9]{64}$/);
const planActor = z.strictObject({
  provider: z.enum(['anthropic', 'openai', 'google']),
  model: z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/),
});
const asWritten = z.string().refine((text) => text.trim().length > 0);
const clearAxis = z.strictObject({
  status: z.literal('clear'),
  citations: z.array(z.strictObject({ source_id: asWritten, quote: asWritten })),
});
const exactPlan = z.strictObject({
  step: asWritten,
  objective: asWritten,
  verification: asWritten,
  acceptance_ids: z.array(asWritten).min(1),
});
const planReview = z
  .strictObject({
    reviewed_plan: z.strictObject({
      version: z.literal(1),
      run_id: z.string(),
      define_sha256: reviewSha,
      proposal_sha256: reviewSha,
      plan_sha256: reviewSha,
      proposal: exactPlan,
      drafter: planActor,
      reviewer: planActor,
      verdict: z.strictObject({ plan_sha256: reviewSha, status: z.literal('clear'), findings: z.tuple([]) }),
    }),
    define_review: z.strictObject({
      version: z.literal(1),
      define_sha256: reviewSha,
      input_sha256: reviewSha,
      drafter: planActor,
      reviewer: planActor,
      axes: z.strictObject({ scope_creep: clearAxis, missing_edge_case: clearAxis }),
    }),
  })
  .refine(
    ({ reviewed_plan: plan, define_review: define }) =>
      plan.drafter.provider !== plan.reviewer.provider &&
      plan.drafter.model !== plan.reviewer.model &&
      define.drafter.provider !== define.reviewer.provider &&
      define.drafter.model !== define.reviewer.model &&
      plan.define_sha256 === define.define_sha256 &&
      plan.verdict.plan_sha256 === plan.plan_sha256,
  );

export function parseReviewedPlan(raw: unknown) {
  return planReview.parse(raw);
}

export function parseReviewedPlanReply(content: readonly unknown[]) {
  const [part] = z.tuple([z.object({ type: z.literal('text'), text: z.string() })]).parse(content);
  return parseReviewedPlan(JSON.parse(part.text));
}
