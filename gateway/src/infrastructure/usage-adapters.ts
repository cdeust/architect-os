import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { USAGE_LOGGER, type UsageAppendInput } from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type { AppendOutcome, BrokerControl, Scheduler, TaskGrant, UsageSink } from '../domain/ports.js';

type Caller = Pick<Client, 'callTool'>;

const textOf = (response: Awaited<ReturnType<Caller['callTool']>>): string =>
  (response.content as { type: string; text?: string }[] | undefined)?.[0]?.text ?? '';

/** A refusal of data is `{ code, message }` in that order (data/src/presentation/mcp-server.ts); INTERNAL: no store. */
const INTERNAL = '{"code":"INTERNAL"';

/**
 * Data, as the gateway reaches it on its stdio (data/src/presentation/mcp-server.ts). Unavailable: the `tools/call`
 * fails (data gone, its transport closed) or data answers INTERNAL (its store unreachable). Any other refusal is an
 * answer: the record is refused, data is up.
 */
export class McpUsageSink implements UsageSink {
  constructor(private readonly data: Caller) {}

  /** Whether data answered or refused; it rejects with SERVICE_UNAVAILABLE when data is unavailable. */
  private async call(name: string, args: Record<string, unknown>): Promise<'answered' | 'refused'> {
    let response;
    try {
      response = await this.data.callTool({ name, arguments: args });
    } catch (error) {
      throw new GatewayError('SERVICE_UNAVAILABLE', `data unavailable: ${String(error)}`);
    }
    if (response.isError !== true) return 'answered';
    if (textOf(response).startsWith(INTERNAL)) {
      throw new GatewayError('SERVICE_UNAVAILABLE', 'data cannot reach its store');
    }
    return 'refused';
  }

  async append(record: UsageAppendInput): Promise<AppendOutcome> {
    const outcome = await this.call('usage.append', record as unknown as Record<string, unknown>);
    return outcome === 'answered' ? 'stored' : 'refused';
  }

  /** A read of one group: it reaches the store, which a ping of the MCP session would not. */
  async available(): Promise<boolean> {
    return this.call('usage.aggregate', { limit: 1 }).then(
      (outcome) => outcome === 'answered',
      () => false,
    );
  }
}

/** The broker, as the gateway reaches it on its stdio (modules/broker/src/presentation/mcp-server.ts). */
export class McpBrokerControl implements BrokerControl {
  constructor(private readonly broker: Caller) {}

  private async call(name: string, args: Record<string, unknown>): Promise<void> {
    const response = await this.broker.callTool({ name, arguments: args });
    if (response.isError === true) throw new Error(`broker refused ${name}: ${textOf(response)}`);
  }

  /** A parent left undefined is absent on the wire: JSON drops it. */
  grant(grant: TaskGrant): Promise<void> {
    return this.call('token_grant', { ...grant });
  }

  revoke(token: string): Promise<void> {
    return this.call('token_revoke', { token });
  }
}

/** Hands every usage notification of the broker (logger `usage`) to `receive`; other loggers are not usage. */
export function onUsage(
  broker: Pick<Client, 'setNotificationHandler'>,
  receive: (data: unknown) => Promise<void>,
): void {
  broker.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    if (notification.params.logger === USAGE_LOGGER) return receive(notification.params.data);
  });
}

/** The scheduler of production: a timer that does not keep the gateway alive. */
export class TimerScheduler implements Scheduler {
  after(ms: number, work: () => void): void {
    setTimeout(work, ms).unref();
  }
}
