import { producerDigest } from './infrastructure/producer.js';

interface DigestProcess {
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

/** Print the digest the operator pins for a provisioned producer: `producer:digest <prd-gen-plugin-root>`. */
export function runDigest(proc: DigestProcess, digest = producerDigest): number {
  const [root, ...extra] = proc.argv.slice(2);
  if (!root || extra.length) {
    proc.stderr.write('usage: producer:digest <prd-gen-plugin-root>\n');
    return 2;
  }
  try {
    proc.stdout.write(`${digest(root)}\n`);
    return 0;
  } catch (error) {
    proc.stderr.write(`architect-os producer: ${(error as Error).message}\n`);
    return 2;
  }
}
