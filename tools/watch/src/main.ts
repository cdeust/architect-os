// The composition root of `npm run watch` (docs/design/anthropic-watch.md §3): the one place that builds objects. The
// entry `cli.ts` only hands it the process.
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './application/check.js';
import { loadRegister } from './application/load.js';
import { readSources } from './application/read.js';
import type { Files } from './domain/ports.js';
import { defaultLimits, FetchSources, type Limits } from './infrastructure/fetch-sources.js';
import { FsFiles } from './infrastructure/fs-files.js';
import { parseRegister } from './infrastructure/register-schema.js';

const USAGE = 'usage: watch check [--keep <dossier>] | watch read <id> [<id>...] [--keep <dossier>]';

/** What the command needs from its process; every one of them is injected. */
export interface WatchDependencies {
  /** The arguments after the script: the command and its operands. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** The root of the repository, where `tools/watch/watch.json` is. */
  readonly root: string;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  readonly fetch: typeof fetch;
  readonly clock: () => Date;
  /** The time and size limits per source; a scenario gives small ones. */
  readonly limits: Limits;
}

/** The path made absolute, its deepest existing ancestor canonical (`/tmp` is a link on macOS). */
function canonical(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    missing.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return join(realpathSync(ancestor), ...missing);
}

/**
 * The command; its exit code is 0 (up to date, or read), 1 (a source is behind), 2 (a refusal, one line on stderr) or 3
 * (a source is unreadable, or an error nobody foresaw): a caller that reads the code alone tells them apart.
 */
export async function runWatch(deps: WatchDependencies): Promise<number> {
  try {
    return await command(deps);
  } catch {
    deps.stderr.write('architect-os watch: erreur inattendue\n');
    return 3;
  }
}

async function command(deps: WatchDependencies): Promise<number> {
  const refuse = (reason: string): number => {
    deps.stderr.write(`architect-os watch: ${reason}\n`);
    return 2;
  };
  const [name, ...operands] = deps.argv;
  if (name !== 'check' && name !== 'read') return refuse(USAGE);

  const ids: string[] = [];
  let keepArgument: string | undefined;
  for (let i = 0; i < operands.length; i++) {
    const operand = operands[i] as string;
    if (operand === '--keep') {
      i++;
      const folder = operands[i];
      if (folder === undefined || keepArgument !== undefined) return refuse(USAGE);
      keepArgument = folder;
    } else if (operand.startsWith('-') || name === 'check') {
      return refuse(USAGE);
    } else {
      ids.push(operand);
    }
  }

  const root = canonical(deps.root);
  let keep: Files | undefined;
  if (keepArgument !== undefined) {
    const folder = canonical(resolve(deps.cwd, keepArgument));
    // Outside the repository: the way from its root to the folder starts by going up. The repository itself is `''`.
    const way = relative(root, folder);
    if (way.split(sep)[0] !== '..') return refuse(`--keep ${keepArgument} est dans le dépôt`);
    keep = new FsFiles(folder);
  }

  const repository = new FsFiles(root);
  const loaded = loadRegister(repository, parseRegister);
  if (!loaded.ok) return refuse(loaded.reason);
  const sources = new FetchSources(deps.fetch, deps.limits);

  if (name === 'check') {
    const report = await check({ sources, repository, keep }, loaded.register);
    deps.stdout.write(`${report.lines.join('\n')}\n`);
    return report.code;
  }
  const today = deps.clock().toISOString().slice(0, 10);
  const outcome = await readSources({ sources, repository, keep, today }, loaded.register, ids);
  if ('refusal' in outcome) return refuse(outcome.refusal);
  deps.stdout.write(`${outcome.lines.join('\n')}\n`);
  return outcome.code;
}

/** The process, as far as the command reads it. */
export interface WatchProcess {
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  cwd(): string;
}

/** The real dependencies: the streams of the process, `fetch`, the clock, the repository this module sits in. */
export function watchDependencies(proc: WatchProcess): WatchDependencies {
  return {
    argv: proc.argv.slice(2),
    cwd: proc.cwd(),
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    stdout: proc.stdout,
    stderr: proc.stderr,
    fetch,
    clock: () => new Date(),
    limits: defaultLimits(),
  };
}
