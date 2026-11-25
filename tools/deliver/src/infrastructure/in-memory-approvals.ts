import type { ApprovalKind, ApprovalRecord } from '../domain/approval.js';
import type { Approvals } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/** `Approvals` that gives what the scenario set for each kind, absent otherwise, and records each read. */
export class InMemoryApprovals implements Approvals {
  readonly records = new Map<ApprovalKind, ApprovalRecord>();

  constructor(private readonly journal: Journal) {}

  read(kind: ApprovalKind): ApprovalRecord {
    this.journal.record('approval', kind);
    return this.records.get(kind) ?? { state: 'absent' };
  }
}
