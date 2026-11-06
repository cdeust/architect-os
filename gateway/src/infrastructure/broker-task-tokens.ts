import type { BrokerControl, TaskGrant } from '../domain/ports.js';
import type { TaskTokens } from '../domain/routing.js';

/**
 * The tokens of the tasks at the broker (docs/design/platform-v3-srt.md, §2, Broker): granted when the task opens,
 * revoked when it ends, so that its worker spends with it only while the task lives.
 */
export class BrokerTaskTokens implements TaskTokens {
  constructor(private readonly broker: BrokerControl) {}

  grant(grant: TaskGrant): Promise<void> {
    return this.broker.grant(grant);
  }

  retire(token: string): Promise<void> {
    return this.broker.revoke(token);
  }
}
