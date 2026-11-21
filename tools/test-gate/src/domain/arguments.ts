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
  const [flag, value, ...rest] = options;
  if (name === 'replay') {
    switch (flag) {
      case undefined:
        return { name, all: false };
      case '--all':
        return options.length === 1 ? { name, all: true } : { failure: USAGE };
      case '--shard': {
        const shard = parseShard(value, rest);
        return shard === undefined ? { failure: USAGE } : { name, all: false, shard };
      }
    }
  }
  switch (name) {
    case 'inventory':
    case 'inventory-project':
      if (flag === '--shard') {
        const shard = parseShard(value, rest);
        return shard === undefined ? { failure: USAGE } : { name, job: 'linux', shard };
      }
      break;
    case 'inventory-check':
    case 'inventory-collect':
    case 'plan':
    case 'check':
      break;
    default:
      return { failure: USAGE };
  }
  if (options.length === 0) return { name, job: 'linux' };
  const job = value;
  if (flag !== '--job' || job === undefined || rest.length > 0) return { failure: USAGE };
  return { name, job };
}

function parseShard(value: string | undefined, rest: readonly string[]): 1 | 2 | undefined {
  if (rest.length !== 0) return undefined;
  switch (value) {
    case '1':
      return 1;
    case '2':
      return 2;
  }
}
