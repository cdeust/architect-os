import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import type { Relay } from '@architect-os/sandbox';
import { BrokerService } from './application/broker-service.js';
import { TokenTable } from './domain/tokens.js';
import { loadBrokerConfig, type BrokerConfig } from './infrastructure/config.js';
import { readKeyFile } from './infrastructure/key-file.js';
import { startBrokerRelay } from './infrastructure/relay.js';
import { openChannel, stdioTransport } from './presentation/mcp-server.js';

/** The transport of the broker's MCP server: its stdio in production, a pair of streams in a scenario. */
export type BrokerTransport = Parameters<typeof openChannel>[1];

export interface StartedBroker {
  readonly service: BrokerService;
  readonly relay: Relay;
  close(): Promise<void>;
}

/**
 * Starts the broker (docs/design/platform-v3-srt.md, §2, Broker): its key file is checked first (a broker that cannot
 * spend does not start), then its MCP server on `transport`, then its one listener. A listener that cannot listen
 * closes the server.
 */
export async function start(
  config: BrokerConfig,
  transport: BrokerTransport,
  port = config.port,
): Promise<StartedBroker> {
  readKeyFile(config.keyFile);
  const service = new BrokerService(new TokenTable());
  const channel = await openChannel(service, transport);
  let relay: Relay;
  try {
    relay = await startBrokerRelay(config, (key) => service.authorize(key), channel.notify, port);
  } catch (error) {
    await channel.close();
    throw error;
  }
  return {
    service,
    relay,
    close: async () => {
      await relay.close();
      await channel.close();
    },
  };
}

/** The file of the configuration: `BROKER_CONFIG`, or the `broker.json` of the module. */
export const configFile = (env: Readonly<Record<string, string | undefined>>): string =>
  env['BROKER_CONFIG'] ?? new URL('../broker.json', import.meta.url).pathname;

/**
 * The process of the broker, child of the gateway: MCP on stdin and stdout, nothing else written to stdout. It ends when
 * its stdin ends, its parent gone: 0; a broker that cannot start writes why on stderr: 1.
 */
export async function serve(
  env: Readonly<Record<string, string | undefined>>,
  stdin: Readable,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  let broker: StartedBroker;
  try {
    broker = await start(loadBrokerConfig(configFile(env)), stdioTransport(stdin, stdout));
  } catch (error) {
    stderr.write(`broker: ${(error as Error).message}\n`);
    return 1;
  }
  if (!stdin.readableEnded) await once(stdin, 'end');
  await broker.close();
  return 0;
}
