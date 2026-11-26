import { z } from 'zod';
import { rejection } from './scout-facts.js';

/** Au plus dix lignes citées, chacune un fichier, une ligne et le texte d'une seule ligne que l'hôte y retrouve. */
function proofs() {
  return z
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
    .max(10);
}

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
      evidence: proofs(),
      reason: z.string(),
    }),
  ),
  // Un statut par écart que la construction a déclaré et que l'hôte a validé, dans l'ordre de ses identifiants
  // (`src/build-claims.ts`) : l'affirmation est vérifiée, réfutée ou non vérifiée, avec les preuves du relecteur.
  claims: z.array(
    z.strictObject({
      id: z.string().regex(/^CL-\d{1,9}$/),
      status: z.enum(['verified', 'refuted', 'not_checked']),
      evidence: proofs(),
      reason: z.string(),
    }),
  ),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const parseReviewVerdict = (raw: unknown): ReviewVerdict => ReviewVerdictSchema.parse(raw);

/**
 * Un verdict qui contredit ses propres constats bloque : `accept` avec un constat de correction ou de contradiction,
 * avec un critère d'acceptation qui n'est pas satisfait, ou avec un écart déclaré que la revue n'a pas vérifié.
 */
export const blocks = (verdict: ReviewVerdict): boolean =>
  verdict.verdict === 'request_changes' ||
  verdict.findings.some((finding) => finding.level === 'correctness' || finding.level === 'contradiction') ||
  verdict.criteria.some((criterion) => criterion.status !== 'met') ||
  verdict.claims.some((claim) => claim.status !== 'verified');

/** Pourquoi l'hôte refuse l'une des preuves d'une entrée, ou `undefined` s'il les retrouve toutes. */
function proofsRefusal(
  id: string,
  evidence: ReviewVerdict['criteria'][number]['evidence'],
  read: (path: string) => string | undefined,
): string | undefined {
  for (const proof of evidence) {
    const reason = rejection(proof, read);
    if (reason !== undefined) return `${id} : preuve refusée (${reason})`;
  }
  return undefined;
}

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
    const refused = proofsRefusal(id, evidence, read);
    if (refused !== undefined) return refused;
  }
  return undefined;
}

/**
 * Pourquoi l'hôte refuse les revendications d'un verdict, ou `undefined` s'il les reçoit. Le verdict nomme exactement
 * les écarts que la construction a déclarés, dans leur ordre ; une revendication vérifiée ou réfutée porte au moins une
 * preuve, et chaque preuve citée, quel que soit le statut, est une ligne que l'hôte retrouve telle quelle dans le
 * worktree. Juger que la preuve tient reste au relecteur.
 */
export function claimsRefusal(
  verdict: ReviewVerdict,
  expected: readonly string[],
  read: (path: string) => string | undefined,
): string | undefined {
  const named = verdict.claims.map(({ id }) => id);
  if (JSON.stringify(named) !== JSON.stringify(expected))
    return `revendications du verdict ${JSON.stringify(named)}, attendues ${JSON.stringify(expected)}`;
  for (const { id, status, evidence } of verdict.claims) {
    if (status !== 'not_checked' && evidence.length === 0) return `${id} ${status} sans preuve`;
    const refused = proofsRefusal(id, evidence, read);
    if (refused !== undefined) return refused;
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
