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
