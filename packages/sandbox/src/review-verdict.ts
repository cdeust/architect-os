import { z } from 'zod';
import { rejection } from './scout-facts.js';

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
  // Un statut par critère d'acceptation du brief approuvé, dans son ordre (exigence R2, docs/design/exigences-spec.md).
  criteria: z.array(
    z.strictObject({
      id: z.string().regex(/^AC-\d{1,9}$/),
      status: z.enum(['met', 'unmet', 'not_established']),
      evidence: z
        .array(
          z.strictObject({
            file: z.string().min(1).max(300),
            line: z.number().int().min(1),
            quote: z
              .string()
              .min(1)
              .max(300)
              .regex(/^[^\r\n]*$/),
          }),
        )
        .max(10),
      reason: z.string(),
    }),
  ),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const parseReviewVerdict = (raw: unknown): ReviewVerdict => ReviewVerdictSchema.parse(raw);

/**
 * Un verdict qui contredit ses propres constats bloque : `accept` avec un constat de correction ou de contradiction,
 * ou avec un critère d'acceptation qui n'est pas satisfait.
 */
export const blocks = (verdict: ReviewVerdict): boolean =>
  verdict.verdict === 'request_changes' ||
  verdict.findings.some((finding) => finding.level === 'correctness' || finding.level === 'contradiction') ||
  verdict.criteria.some((criterion) => criterion.status !== 'met');

/**
 * Pourquoi l'hôte refuse les critères d'un verdict, ou `undefined` s'il les reçoit. Le verdict nomme exactement les
 * critères de l'étape, dans leur ordre ; un critère satisfait porte au moins une preuve, et chaque preuve est une ligne
 * que l'hôte retrouve telle quelle dans le worktree (`rejection`, la vérification des citations d'éclaireurs). Juger qu'une ligne satisfait le
 * critère reste au relecteur ; l'hôte établit seulement que ce qu'il cite existe.
 */
export function criteriaRefusal(
  verdict: ReviewVerdict,
  expected: readonly string[],
  read: (path: string) => string | undefined,
): string | undefined {
  const named = verdict.criteria.map(({ id }) => id);
  if (JSON.stringify(named) !== JSON.stringify(expected))
    return `critères du verdict ${JSON.stringify(named)}, attendus ${JSON.stringify(expected)}`;
  for (const { id, status, evidence } of verdict.criteria) {
    if (status !== 'met') continue;
    if (evidence.length === 0) return `${id} satisfait sans preuve`;
    for (const proof of evidence) {
      const reason = rejection(proof, read);
      if (reason !== undefined) return `${id} : preuve refusée (${reason})`;
    }
  }
  return undefined;
}

/**
 * Le bloc que les revues reçoivent après le brief quand l'étape porte des critères : les identifiants que le verdict
 * doit couvrir, dans l'ordre, chacun encodé en chaîne JSON. Leur texte est dans le brief approuvé ; ce bloc ne porte
 * aucune consigne venue d'un fichier.
 */
export function renderAcceptance(ids: readonly string[]): string {
  return [
    '## Acceptance criteria the verdict covers',
    '',
    'The host requires `criteria` to give one entry for each identifier below, in this order, and no other.',
    '',
    ...ids.map((id) => `- ${JSON.stringify(id)}`),
    '',
  ].join('\n');
}
