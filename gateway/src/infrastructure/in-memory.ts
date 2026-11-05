import type { UsageAppendInput } from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type {
  AppendOutcome,
  BrokerControl,
  Scheduler,
  TaskGrant,
  UsageSink,
  AuditEntry,
  AuditLog,
  Authenticator,
  Clock,
  Identity,
  Presented,
  QuotaPolicy,
  ServiceClient,
  ServiceResponse,
} from '../domain/ports.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Authenticator backed by a token table. Local development and tests; swap for an identity provider adapter in production. */
export class InMemoryAuthenticator implements Authenticator {
  constructor(private readonly tokens: ReadonlyMap<string, Identity>) {}

  async authenticate(presented: Presented): Promise<Identity> {
    const identity = presented.token === undefined ? undefined : this.tokens.get(presented.token);
    if (identity === undefined) throw new GatewayError('UNAUTHORIZED', 'missing or invalid token');
    return identity;
  }
}

/** Fixed-window quota kept in this process. */
export class InMemoryQuota implements QuotaPolicy {
  private readonly windows = new Map<string, { start: number; used: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  async consume(identity: Identity, tool: string): Promise<void> {
    const key = `${identity.subject}:${tool}`;
    const now = this.clock.now().getTime();
    const current = this.windows.get(key);
    const window =
      current !== undefined && now - current.start < this.windowMs ? current : { start: now, used: 0 };
    if (window.used >= this.limit) {
      throw new GatewayError('QUOTA_EXCEEDED', `quota exceeded for ${identity.subject} on ${tool}`);
    }
    window.used += 1;
    this.windows.set(key, window);
  }
}

export class InMemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ServiceResponse>;

/** ServiceClient that dispatches to in-process handlers keyed by "service/tool". */
export class InMemoryServiceClient implements ServiceClient {
  constructor(private readonly handlers: ReadonlyMap<string, ToolHandler>) {}

  async invoke(service: string, tool: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    const handler = this.handlers.get(`${service}/${tool}`);
    if (handler === undefined)
      throw new GatewayError('SERVICE_UNAVAILABLE', `service ${service} has no handler for ${tool}`);
    return handler(args);
  }
}

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
