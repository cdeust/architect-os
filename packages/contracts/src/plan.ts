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
