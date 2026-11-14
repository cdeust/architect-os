import {
  EVIDENCE_ID,
  EVIDENCE_REASON_CODES,
  EVIDENCE_TEXT_NAME,
  EvidenceAnswerSchema,
  EvidenceQuestionSchema,
  EvidenceRejectionSchema,
  EvidenceVerifiedSchema,
  type EvidenceAnswer,
  type EvidenceQuestion,
  type EvidenceReasonCode,
  type EvidenceRejection,
  type EvidenceSource,
  type EvidenceVerified,
} from '@architect-os/contracts';

// The contracts of docs/design/evidence-desk.md §4 live in packages/contracts; the domain names them and parses with them.

export const IDENTIFIER = EVIDENCE_ID;
export const SOURCE_TEXT_NAME = EVIDENCE_TEXT_NAME;
export const REASON_CODES = EVIDENCE_REASON_CODES;
export const QuestionSchema = EvidenceQuestionSchema;
export const VerifiedSchema = EvidenceVerifiedSchema;
export type ReasonCode = EvidenceReasonCode;
export type Question = EvidenceQuestion;
export type Source = EvidenceSource;
export type Answer = EvidenceAnswer;
export type Verified = EvidenceVerified;
export type Rejection = EvidenceRejection;

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: string };

type Json = { ok: true; value: unknown } | { ok: false; value: undefined; issues: string };

/** `undefined` is not JSON: String(undefined) does not parse. */
function parseJson(raw: string | undefined): Json {
  try {
    return { ok: true, value: JSON.parse(String(raw)) };
  } catch {
    return { ok: false, value: undefined, issues: '$ is not JSON' };
  }
}

/** The issues of a parse as text: one line per issue, its path (`$` is the root) then its message. */
export function issuesOf(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .map((issue) => `${['$', ...issue.path.map(String)].join('.')} ${issue.message}`)
    .join('\n');
}

/** The answer, or the issues as text. */
export function parseAnswer(raw: string): Parsed<Answer> {
  const json = parseJson(raw);
  if (!json.ok) return { ok: false, issues: json.issues };
  const result = EvidenceAnswerSchema.safeParse(json.value);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: issuesOf(result.error) };
}

/** A rejection the host wrote and Science may have altered: a text that is absent, not JSON or off contract reads as absent. */
export function parseRejection(raw: string | undefined): Rejection | undefined {
  return EvidenceRejectionSchema.safeParse(parseJson(raw).value).data;
}
