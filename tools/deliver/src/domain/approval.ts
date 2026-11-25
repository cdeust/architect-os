// The owner's approvals of a delivery (docs/design/trusted-gate.md, « Step 1 as built »): one record per kind, each
// naming one repository and one full commit hash, for a bounded time. The port reads a record; this decides it.

/** `maintenance` lets a commit that changes the judge reach a trial branch; `publication` lets a commit reach the destinations. */
export type ApprovalKind = 'maintenance' | 'publication';

/** What the port read: nothing, a file that carries no authority (who may write it, its form), or a record. */
export type ApprovalRecord =
  | { readonly state: 'absent' }
  | { readonly state: 'untrusted' }
  | {
      readonly state: 'present';
      readonly repository: string;
      readonly commit: string;
      /** Seconds since the epoch. */
      readonly approvedAt: number;
      readonly expiresAt: number;
    };

/** The four ways a record fails, one reason each, per kind. */
export const APPROVAL_REASONS = {
  maintenance: {
    absent: 'modification du juge sans approbation de maintenance',
    untrusted: 'approbation de maintenance non recevable',
    other: "approbation de maintenance d'un autre commit",
    expired: 'approbation de maintenance périmée',
  },
  publication: {
    absent: 'publication sans approbation du propriétaire',
    untrusted: 'approbation de publication non recevable',
    other: "approbation de publication d'un autre commit",
    expired: 'approbation de publication périmée',
  },
} as const;

export type ApprovalReason =
  (typeof APPROVAL_REASONS)[ApprovalKind][keyof (typeof APPROVAL_REASONS)['publication']];

export interface ApprovalSubject {
  readonly repository: string;
  readonly commit: string;
  /** Seconds since the epoch, from the `Clock`. */
  readonly now: number;
  /** The longest life a record may give itself (`approvalHours` of the policy), in seconds. */
  readonly maxSeconds: number;
}

/** The bounds of the record that approves, or the reason none does. */
export type ApprovalDecision =
  | { readonly approved: { readonly approvedAt: number; readonly expiresAt: number } }
  | { readonly reason: ApprovalReason };

/**
 * The bounds of the record when it approves exactly this commit of this repository now; else the reason. A record whose life
 * is longer than the policy allows, or that starts in the future, is not receivable: the clock that wrote it is not the
 * one that reads it, and a bound the record sets itself bounds nothing.
 */
export function decideApproval(
  kind: ApprovalKind,
  record: ApprovalRecord,
  subject: ApprovalSubject,
): ApprovalDecision {
  const reasons = APPROVAL_REASONS[kind];
  if (record.state === 'absent') return { reason: reasons.absent };
  if (record.state === 'untrusted') return { reason: reasons.untrusted };
  if (record.repository !== subject.repository || record.commit !== subject.commit)
    return { reason: reasons.other };
  const life = record.expiresAt - record.approvedAt;
  if (life <= 0 || life > subject.maxSeconds || record.approvedAt > subject.now)
    return { reason: reasons.untrusted };
  if (subject.now >= record.expiresAt) return { reason: reasons.expired };
  return { approved: { approvedAt: record.approvedAt, expiresAt: record.expiresAt } };
}
