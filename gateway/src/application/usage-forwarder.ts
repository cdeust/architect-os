import { UsageRecordSchema } from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type { BrokerControl, Scheduler, TaskGrant, UsageSink } from '../domain/ports.js';

/** Where the registry stands for the gateway, and what it lost or refused since the gateway started. */
export interface UsageState {
  readonly data: 'up' | 'down';
  /** Records not written: received while data was down, or whose write found it down. */
  readonly lost: number;
  /** Records refused: invalid against the contract of the broker, or refused by data. */
  readonly refused: number;
}

/**
 * The gateway between the broker and data for usage (docs/design/platform-v3-srt.md, §2, Mesure du coût, brick 1b.3).
 * Every record of the broker is written to data with the layer `broker`, one parent stdio per process, no link broker
 * to data. When a write finds data unavailable, the tokens of every task are revoked (the broker answers 401 to new
 * calls) and the records received meanwhile are lost (R-9); data is probed every `probeMs`, and once it answers, the
 * tokens still granted are granted again. A task opened while data is down gets its token at the return of data.
 */
export class UsageForwarder {
  private readonly book = new Map<string, TaskGrant>();
  private up = true;
  private lost = 0;
  private refused = 0;

  constructor(
    private readonly sink: UsageSink,
    private readonly broker: BrokerControl,
    private readonly scheduler: Scheduler,
    private readonly probeMs: number,
  ) {}

  state(): UsageState {
    return { data: this.up ? 'up' : 'down', lost: this.lost, refused: this.refused };
  }

  /** Grants the token of a task now, or at the return of data if it is down. */
  async grant(grant: TaskGrant): Promise<void> {
    this.book.set(grant.token, grant);
    if (this.up) await this.broker.grant(grant);
  }

  /** Ends the token of a task: out of the book, revoked at the broker whatever the state of data. */
  async retire(token: string): Promise<void> {
    this.book.delete(token);
    await this.broker.revoke(token);
  }

  /** One usage notification of the broker. */
  async receive(data: unknown): Promise<void> {
    const record = UsageRecordSchema.safeParse(data);
    if (!record.success) {
      this.refused += 1;
      return;
    }
    if (!this.up) {
      this.lost += 1;
      return;
    }
    let outcome;
    try {
      outcome = await this.sink.append({ ...record.data, layer: 'broker' });
    } catch (error) {
      if (!(error instanceof GatewayError && error.code === 'SERVICE_UNAVAILABLE')) throw error;
      this.lost += 1;
      await this.down();
      return;
    }
    if (outcome === 'refused') this.refused += 1;
  }

  /**
   * The state turns down before any await, so that the writes failing together revoke once; the tokens are those of the
   * book at that instant, a task opened afterwards waits for the return of data.
   */
  private async down(): Promise<void> {
    if (!this.up) return;
    this.up = false;
    for (const token of [...this.book.keys()]) await this.broker.revoke(token);
    this.scheduler.after(this.probeMs, () => void this.probe());
  }

  private async probe(): Promise<void> {
    if (!(await this.sink.available())) {
      this.scheduler.after(this.probeMs, () => void this.probe());
      return;
    }
    // The book is read before the state turns up: a task opened from then on is granted by grant() itself, once.
    // A broker that cannot take a grant back rejects unhandled and ends the gateway, as a broker gone would.
    const grants = [...this.book.values()];
    this.up = true;
    // A task retired meanwhile is out of the book: its token is not granted again.
    for (const grant of grants) if (this.book.get(grant.token) === grant) await this.broker.grant(grant);
  }
}
