import type { TaskGrant, TokenTable } from '../domain/tokens.js';

/** The two calls of the gateway, and the question of the relay: what is this key worth? */
export class BrokerService {
  constructor(private readonly tokens: TokenTable) {}

  grant(input: { token: string; task: string; parent?: string }): void {
    const { token, ...grant } = input;
    this.tokens.grant(token, grant);
  }

  revoke(token: string): boolean {
    return this.tokens.revoke(token);
  }

  authorize(key: string): TaskGrant | null {
    return this.tokens.resolve(key);
  }
}
