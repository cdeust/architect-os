import { resolve } from 'node:path';
import { readDefine } from './application/read-define.js';
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
  source: (node: string, root: string) => DefineSource = prdGenSource,
): Promise<number> {
  const [runId, root, ...extra] = proc.argv.slice(2);
  const refuse = (error: string, code: number): number => {
    proc.stderr.write(`architect-os define: ${error}\n`);
    return code;
  };
  if (!runId || !root || extra.length) return refuse('usage: define <run_id> <prd-gen-plugin-root>', 2);
  try {
    const result = await readDefine(runId, source(proc.execPath, resolve(root)));
    if ('error' in result) return refuse(result.error, 2);
    proc.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    return refuse('DEFINE_TRANSPORT_FAILED', 3);
  }
}
