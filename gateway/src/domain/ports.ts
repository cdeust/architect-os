import type { UsageAppendInput } from '@architect-os/contracts';

/** What the caller presented to prove who they are (a bearer token, when there is one). */
export interface Presented {
  token?: string | undefined;
}

export interface Identity {
  subject: string;
}

/** Port: who is calling. Rejects with GatewayError UNAUTHORIZED when what was presented is not valid. */
export interface Authenticator {
  authenticate(presented: Presented): Promise<Identity>;
}

/** Port: how much may this identity call. Rejects with GatewayError QUOTA_EXCEEDED when exhausted. */
export interface QuotaPolicy {
  consume(identity: Identity, tool: string): Promise<void>;
}

export interface AuditEntry {
  at: string;
  subject: string;
  tool: string;
  owner: string | null;
  outcome: 'ok' | 'error';
  error_code?: string;
  duration_ms: number;
}

/** Port: append-only journal of every call, allowed or refused. */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

/** What a service answered. The gateway forwards it without interpreting it. */
export interface ServiceResponse {
  structured: Record<string, unknown> | undefined;
  text: string;
  isError: boolean;
}

/** Port: call a tool on the service that owns it. */
export interface ServiceClient {
  invoke(service: string, tool: string, args: Record<string, unknown>): Promise<ServiceResponse>;
}

export interface Clock {
  now(): Date;
}

/** A task token the gateway granted the broker: the task it spends for, and the call that granted it. */
export interface TaskGrant {
  token: string;
  task: string;
  parent?: string | undefined;
}

/** Port: the broker, child of the gateway on stdio (docs/design/platform-v3-srt.md, §2, Broker). */
export interface BrokerControl {
  grant(grant: TaskGrant): Promise<void>;
  /** Makes the token worth nothing: the broker answers 401 to it from then on. */
  revoke(token: string): Promise<void>;
}

/** What data did with one usage record: kept it, or refused it while answering (the record is not kept). */
export type AppendOutcome = 'stored' | 'refused';

/**
 * Port: the registry of usage records, data, child of the gateway on stdio. `append` rejects with GatewayError
 * SERVICE_UNAVAILABLE when the `tools/call` fails or data cannot reach its store.
 */
export interface UsageSink {
  append(record: UsageAppendInput): Promise<AppendOutcome>;
  /** Whether data answers an operation on its store again. */
  available(): Promise<boolean>;
}

/** Port: run work later, once. A scenario runs it at will; production, after the delay. */
export interface Scheduler {
  after(ms: number, work: () => void): void;
}
