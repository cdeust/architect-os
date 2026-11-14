import { z } from 'zod';

/** Contrat de `prompts/review-verdict.schema.json`, que le fichier committé doit égaler. */
export const ReviewVerdictSchema = z.strictObject({
  verdict: z.enum(['accept', 'request_changes']),
  findings: z.array(
    z.strictObject({
      level: z.enum(['correctness', 'contradiction', 'proposal']),
      file: z.string(),
      line: z.number().int(),
      quote: z.string(),
      reason: z.string(),
    }),
  ),
  not_checked: z.array(z.string()),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const parseReviewVerdict = (raw: unknown): ReviewVerdict => ReviewVerdictSchema.parse(raw);

/** Un verdict qui contredit ses propres constats bloque : `accept` avec un constat de correction ou de contradiction. */
export const blocks = (verdict: ReviewVerdict): boolean =>
  verdict.verdict === 'request_changes' ||
  verdict.findings.some((finding) => finding.level === 'correctness' || finding.level === 'contradiction');
