import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * What every git the host starts is given, whoever starts it (the fingerprint, the gate, its guard, the delivery), so
 * that what a session wrote in the tree or its repository decides nothing of what git does for the host: the options
 * before the subcommand (no replace object or graft, the attributes of the empty tree and none of an attributes file
 * the configuration names, no file monitor, no hook, no descent into a nested repository) and the variables that set
 * the same (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »). One descriptive file,
 * packages/sandbox/git-closed.json, read by the three TypeScript callers here and by tools/test-gate/with-tree-lock.py.
 */
export interface ClosedGit {
  readonly options: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

const ClosedGitSchema = z
  .object({
    options: z.array(z.string().min(1)).min(1),
    environment: z.record(z.string().regex(/^GIT_[A-Z_]+$/), z.string().min(1)),
  })
  .strict();

/** The closed options and variables of git in `text`, or the reason they are refused. */
export function parseClosedGit(text: string): ClosedGit | { failure: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { failure: 'git-closed.json : JSON invalide' };
  }
  const parsed = ClosedGitSchema.safeParse(json);
  return parsed.success ? parsed.data : { failure: 'git-closed.json : ' + parsed.error.issues[0]?.message };
}

/** The committed file of the launcher package, never one of the checkout under inspection. A refused file throws. */
export function closedGit(): ClosedGit {
  const path = fileURLToPath(
    new URL('../git-closed.json', import.meta.resolve('@architect-os/sandbox/runtime-context')),
  );
  const parsed = parseClosedGit(readFileSync(path, 'utf8'));
  if ('failure' in parsed) throw new Error(parsed.failure);
  return parsed;
}
