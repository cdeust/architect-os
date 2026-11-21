import type { ReadFailure } from './violation.js';

export type Command =
  | {
      readonly name:
        'plan' | 'check' | 'inventory' | 'inventory-check' | 'inventory-project' | 'inventory-collect';
      readonly shard?: 1 | 2;
      readonly job: string;
    }
  /** Writes the mutation debt registry from the mutation report. */
  | { readonly name: 'debt' }
  /** `debt realign`: puts the entries of the registry back on their text. */
  | { readonly name: 'realign' }
  /** Replays the verdicts of the mutation report: the perimeter and the canary, or `--all` of them. */
  | { readonly name: 'replay'; readonly all: boolean; readonly shard?: 1 | 2 }
  | { readonly name: 'replay-collect' };

const USAGE =
  'usage : test-gate plan|check|inventory|inventory-check|inventory-project|inventory-collect [--job <nom>] (inventory|inventory-project --shard <1|2>) | debt [realign] | replay [--all | --shard <1|2>] | replay-collect';

/** `plan|check [--job <name>]` (the job defaults to linux), `debt [realign]`, or `replay [--all]`. */
export function parseArguments(args: readonly string[]): Command | ReadFailure {
  const [name, ...options] = args;
  if (name === 'debt') {
    if (options.length === 0) return { name };
    return options.length === 1 && options[0] === 'realign' ? { name: 'realign' } : { failure: USAGE };
  }
  if (name === 'replay-collect' && options.length === 0) return { name };
  if (name === 'replay') {
    const [mode, shard] = options;
    if (options.length === 2 && mode === '--shard' && (shard === '1' || shard === '2'))
      return { name, all: false, shard: shard === '1' ? 1 : 2 };
    if (options.length === 0) return { name, all: false };
    return options.length === 1 && options[0] === '--all' ? { name, all: true } : { failure: USAGE };
  }
  if (
    name !== 'plan' &&
    name !== 'check' &&
    name !== 'inventory' &&
    name !== 'inventory-check' &&
    name !== 'inventory-project' &&
    name !== 'inventory-collect'
  )
    return { failure: USAGE };
  if (options.length === 0) return { name, job: 'linux' };
  const [flag, job, ...rest] = options;
  if (
    (name === 'inventory' || name === 'inventory-project') &&
    flag === '--shard' &&
    rest.length === 0 &&
    (job === '1' || job === '2')
  )
    return { name, job: 'linux', shard: job === '1' ? 1 : 2 };
  if (flag !== '--job' || job === undefined || rest.length > 0) return { failure: USAGE };
  return { name, job };
}
