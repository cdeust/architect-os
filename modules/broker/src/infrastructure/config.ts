import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';

/** `broker.json`: what the broker relays, where, and where its key is. */
export const BrokerConfigSchema = z.strictObject({
  description: z.string().min(1),
  upstream: z.url({ protocol: /^https$/ }),
  routes: z.array(z.string().min(2).startsWith('^')).min(1),
  betas: z.array(z.string().min(1)),
  policy: z.strictObject({
    bodyFields: z.array(z.string().min(1)).min(1),
    maxBodyBytes: z.number().int().positive(),
  }),
  /** The one listener, on 127.0.0.1; the worker profile allows this port only. */
  port: z.number().int().min(1024).max(65535),
  /** `${home}` alone is resolved. */
  keyFile: z.string().min(1),
});
export type BrokerConfig = z.infer<typeof BrokerConfigSchema>;

export const parseBrokerConfig = (raw: unknown): BrokerConfig => {
  const config = BrokerConfigSchema.parse(raw);
  return { ...config, keyFile: config.keyFile.replaceAll('${home}', homedir()) };
};

export const loadBrokerConfig = (file: string): BrokerConfig =>
  // Stryker disable next-line StringLiteral: équivalent: sans encodage, readFileSync rend un Buffer, que JSON.parse lit en UTF-8.
  parseBrokerConfig(JSON.parse(readFileSync(file, 'utf8')));
