import type { UsageAppendInput } from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type { AppendOutcome, BrokerControl, Scheduler, TaskGrant, UsageSink } from '../domain/ports.js';

/** The broker of a scenario: the tokens it honours, and every call it got, in order. A token granted twice is refused. */
export class InMemoryBrokerControl implements BrokerControl {
  readonly granted = new Map<string, TaskGrant>();
  readonly calls: string[] = [];

  async grant(grant: TaskGrant): Promise<void> {
    this.calls.push(`grant ${grant.token}`);
    if (this.granted.has(grant.token)) throw new Error('token already granted');
    this.granted.set(grant.token, { ...grant });
  }

  async revoke(token: string): Promise<void> {
    this.calls.push(`revoke ${token}`);
    this.granted.delete(token);
  }
}

/** The registry of a scenario: the records it keeps; unreachable, it fails as data gone; refusing, it answers no. */
export class InMemoryUsageSink implements UsageSink {
  readonly records: UsageAppendInput[] = [];
  reachable = true;
  refusing = false;

  async append(record: UsageAppendInput): Promise<AppendOutcome> {
    if (!this.reachable) throw new GatewayError('SERVICE_UNAVAILABLE', 'data unavailable');
    if (this.refusing) return 'refused';
    this.records.push({ ...record });
    return 'stored';
  }

  async available(): Promise<boolean> {
    return this.reachable;
  }
}

/** The scheduler of a scenario: work waits until the scenario runs it. */
export class ManualScheduler implements Scheduler {
  private pending: { ms: number; work: () => void }[] = [];

  after(ms: number, work: () => void): void {
    this.pending.push({ ms, work });
  }

  /** The delays of the work waiting, in order. */
  waiting(): number[] {
    return this.pending.map(({ ms }) => ms);
  }

  /** Runs the work waiting now; work it schedules waits for the next run. */
  run(): void {
    const due = this.pending;
    this.pending = [];
    for (const { work } of due) work();
  }
}
