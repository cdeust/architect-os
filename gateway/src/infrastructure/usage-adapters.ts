import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { USAGE_LOGGER, type UsageAppendInput } from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type { AppendOutcome, BrokerControl, Scheduler, TaskGrant, UsageSink } from '../domain/ports.js';

type Caller = Pick<Client, 'callTool'>;

/**
 * Data, as the gateway reaches it on its stdio (data/src/presentation/mcp-server.ts). Unavailable: the `tools/call`
 * fails (data gone, its transport closed) or data answers INTERNAL (its store unreachable). Any other refusal is an
 * answer: the record is refused, data is up.
 */
export class McpUsageSink implements UsageSink {
  constructor(private readonly data: Caller) {}

  /**
   * Whether data answered (false: it refused); it rejects with SERVICE_UNAVAILABLE when data is unavailable. A refusal of
   * data carries `{ code, message }` as `structuredContent` (data/src/presentation/mcp-server.ts); one of the MCP SDK,
   * arguments outside the schema, carries none.
   */
  private async call(name: string, args: Record<string, unknown>): Promise<boolean> {
    let response;
    try {
      response = await this.data.callTool({ name, arguments: args });
    } catch (error) {
      throw new GatewayError('SERVICE_UNAVAILABLE', `data unavailable: ${String(error)}`);
    }
    if (response.isError !== true) return true;
    if ((response.structuredContent as { code?: unknown } | undefined)?.code === 'INTERNAL') {
      throw new GatewayError('SERVICE_UNAVAILABLE', 'data cannot reach its store');
    }
    return false;
  }

  async append(record: UsageAppendInput): Promise<AppendOutcome> {
    return (await this.call('usage.append', record as unknown as Record<string, unknown>))
      ? 'stored'
      : 'refused';
  }

  /** A read of the store, which a ping of the MCP session would not reach: available when it does not reject. */
  async available(): Promise<boolean> {
    // Stryker disable next-line ObjectLiteral: équivalent: la sonde ne lit que l'issue de la lecture ; limit: 1 n'en borne que le coût (défaut 100)
    return this.call('usage.aggregate', { limit: 1 }).then(
      () => true,
      () => false,
    );
  }
}

/** The broker, as the gateway reaches it on its stdio (modules/broker/src/presentation/mcp-server.ts). */
export class McpBrokerControl implements BrokerControl {
  constructor(private readonly broker: Caller) {}

  private async call(name: string, args: Record<string, unknown>): Promise<void> {
    const response = await this.broker.callTool({ name, arguments: args });
    if (response.isError === true)
      throw new Error(`broker refused ${name}: ${JSON.stringify(response.content)}`);
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
