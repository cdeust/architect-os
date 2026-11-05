import { startRelay, type Relay, type UsageRecord } from '@architect-os/sandbox';
import type { BrokerConfig } from './config.js';
import { readKeyFile } from './key-file.js';

/**
 * The listener of the broker: the relay of packages/sandbox with the API key in `x-api-key`, read from its file at each
 * request (503 if it cannot be), and a key worth what `authorize` says.
 */
export function startBrokerRelay(
  config: BrokerConfig,
  authorize: (key: string) => { task: string; parent?: string } | null,
  onUsage: (record: UsageRecord) => void,
  port: number = config.port,
): Promise<Relay> {
  return startRelay({
    upstream: config.upstream,
    routes: config.routes,
    betas: config.betas,
    policy: config.policy,
    scheme: 'x-api-key',
    credential: async () => ({ accessToken: readKeyFile(config.keyFile) }),
    credentialUnavailable: 'broker key unavailable: see the key file of the broker',
    authorize,
    onUsage,
    port,
  });
}
