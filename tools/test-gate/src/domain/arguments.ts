import type { ReadFailure } from './violation.js';

export type Command =
  | { readonly name: 'plan' | 'check' | 'inventory' | 'inventory-check'; readonly job: string }
  /** Writes the mutation debt registry from the mutation report. */
  | { readonly name: 'debt' }
  /** `debt realign`: puts the entries of the registry back on their text. */
  | { readonly name: 'realign' }
  /** Replays the verdicts of the mutation report: the perimeter and the canary, or `--all` of them. */
  | { readonly name: 'replay'; readonly all: boolean };

const USAGE =
  'usage : test-gate plan|check|inventory|inventory-check [--job <nom>] | debt [realign] | replay [--all]';

/** `plan|check [--job <name>]` (the job defaults to linux), `debt [realign]`, or `replay [--all]`. */
export function parseArguments(args: readonly string[]): Command | ReadFailure {
  const [name, ...options] = args;
  if (name === 'debt') {
    if (options.length === 0) return { name };
    return options.length === 1 && options[0] === 'realign' ? { name: 'realign' } : { failure: USAGE };
  }
  if (name === 'replay') {
    if (options.length === 0) return { name, all: false };
    return options.length === 1 && options[0] === '--all' ? { name, all: true } : { failure: USAGE };
  }
  if (name !== 'plan' && name !== 'check' && name !== 'inventory' && name !== 'inventory-check')
    return { failure: USAGE };
  if (options.length === 0) return { name, job: 'linux' };
  const [flag, job, ...rest] = options;
  if (flag !== '--job' || job === undefined || rest.length > 0) return { failure: USAGE };
  return { name, job };
}
