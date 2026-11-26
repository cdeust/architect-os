import { resolve } from 'node:path';
import { readDefine } from './application/read-define.js';
import { isBundleDigest } from './domain/bundle.js';
import type { DefineSource } from './domain/source.js';
import { prdGenSource } from './infrastructure/prd-gen.js';

interface DefineProcess {
  readonly argv: readonly string[];
  readonly execPath: string;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

export async function runDefine(
  proc: DefineProcess,
  source: (node: string, root: string, sha256: string) => DefineSource = prdGenSource,
): Promise<number> {
  const [runId, root, sha256, ...extra] = proc.argv.slice(2);
  const refuse = (error: string, code: number): number => {
    proc.stderr.write(`architect-os define: ${error}\n`);
    return code;
  };
  if (!runId || !root || !isBundleDigest(sha256) || extra.length)
    return refuse('usage: define <run_id> <prd-gen-plugin-root> <bundle-sha256>', 2);
  try {
    const result = await readDefine(runId, source(proc.execPath, resolve(root), sha256));
    if ('error' in result) return refuse(result.error, 2);
    proc.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message === 'SPEC_BUNDLE_MISMATCH') return refuse(error.message, 2);
    return refuse('DEFINE_TRANSPORT_FAILED', 3);
  }
}
