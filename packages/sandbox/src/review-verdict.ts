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
  // Une revue après une promotion statue sur chaque constat bloquant de la passe d'avant (PF-1, PF-2…) ; l'hôte
  // refuse un verdict qui en omet un (docs/design/orchestration-fable-5-2.md, §13).
  prior_findings: z
    .array(
      z.strictObject({
        id: z.string().regex(/^PF-\d{1,3}$/),
        status: z.enum(['resolved', 'unresolved']),
      }),
    )
    .optional(),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const parseReviewVerdict = (raw: unknown): ReviewVerdict => ReviewVerdictSchema.parse(raw);

/**
 * Un verdict qui contredit ses propres constats bloque : `accept` avec un constat de correction ou de contradiction, ou
 * avec un constat de la passe d'avant qu'il dit non résolu.
 */
export const blocks = (verdict: ReviewVerdict): boolean =>
  verdict.verdict === 'request_changes' ||
  (verdict.prior_findings ?? []).some(({ status }) => status === 'unresolved') ||
  verdict.findings.some((finding) => finding.level === 'correctness' || finding.level === 'contradiction');

/**
 * Ce qui manque ou déborde dans les statuts d'un verdict sur les constats de la passe d'avant : chaque id attendu une
 * fois, aucun autre. `undefined` quand le verdict statue exactement sur les ids attendus.
 */
export function priorFindingsDefect(verdict: ReviewVerdict, expected: readonly string[]): string | undefined {
  const given = (verdict.prior_findings ?? []).map(({ id }) => id);
  const missing = expected.filter((id) => !given.includes(id));
  if (missing.length > 0) return `la revue ne statue pas sur ${missing.join(', ')}`;
  const extra = given.filter((id, index) => !expected.includes(id) || given.indexOf(id) !== index);
  if (extra.length > 0) return `la revue statue sur un constat inconnu ou répété : ${extra.join(', ')}`;
  return undefined;
}
