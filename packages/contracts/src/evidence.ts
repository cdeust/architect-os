import { z } from 'zod';

// The contracts of the evidence desk, docs/design/evidence-desk.md §4. What Science writes is data: it is parsed against these.

export const EVIDENCE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** The `text` of a source: a bare file name of the `in` folder of the desk. */
export const EVIDENCE_TEXT_NAME = /^[A-Za-z0-9._-]{1,120}\.txt$/;

/** The nine reason codes of §5, in the order of the table. */
export const EVIDENCE_REASON_CODES = [
  'ANSWER_INVALID',
  'ANSWER_ID_MISMATCH',
  'QUESTION_UNKNOWN',
  'DOI_UNKNOWN',
  'TITLE_MISMATCH',
  'RETRACTED',
  'SOURCE_TEXT_MISSING',
  'TEXT_NOT_OF_DOI',
  'QUOTE_ABSENT',
] as const;
export type EvidenceReasonCode = (typeof EVIDENCE_REASON_CODES)[number];

const identifier = z.string().regex(EVIDENCE_ID);
const instant = z.iso.datetime({ offset: true });
const doi = z
  .string()
  .max(200)
  .regex(/^10\.\d{4,9}\/\S+$/);
const quote = z.string().min(40).max(600);
const statement = z.string().min(1).max(600);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const rank = z.int().min(0).nullable();

export const EvidenceQuestionSchema = z.strictObject({
  id: identifier,
  question: z.string().min(1).max(2000),
  asked_at: instant,
});
export type EvidenceQuestion = z.infer<typeof EvidenceQuestionSchema>;

const SourceSchema = z.strictObject({
  doi,
  title: z.string().min(1),
  quote,
  text: z.string().regex(EVIDENCE_TEXT_NAME),
});
export type EvidenceSource = z.infer<typeof SourceSchema>;

export const EvidenceAnswerSchema = z
  .strictObject({
    id: identifier,
    claims: z.array(z.strictObject({ statement, sources: z.array(SourceSchema).min(1) })),
    not_found: z.array(z.string().min(1)),
  })
  .refine((answer) => answer.claims.length + answer.not_found.length > 0, {
    message: 'claims and not_found are both empty',
  });
export type EvidenceAnswer = z.infer<typeof EvidenceAnswerSchema>;

export const EvidenceVerifiedSchema = z.strictObject({
  id: identifier,
  question: z.string().min(1).max(2000),
  verified_at: instant,
  level: z.literal('quote_in_supplied_text'),
  claims: z.array(
    z.strictObject({
      statement,
      sources: z.array(
        z.strictObject({
          doi,
          title: z.string().min(1),
          year: z.int().nullable(),
          quote,
          text_sha256: sha256,
        }),
      ),
    }),
  ),
  not_found: z.array(z.string().min(1)),
});
export type EvidenceVerified = z.infer<typeof EvidenceVerifiedSchema>;

export const EvidenceRejectionSchema = z.strictObject({
  id: identifier,
  rejected_at: instant,
  answer_sha256: sha256,
  reasons: z.array(
    z.strictObject({ code: z.enum(EVIDENCE_REASON_CODES), claim: rank, source: rank, detail: z.string() }),
  ),
});
export type EvidenceRejection = z.infer<typeof EvidenceRejectionSchema>;
