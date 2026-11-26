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

/**
 * The floor of the file: the options every git of the host must be given whatever the file adds, a security floor
 * written in code (CLAUDE.md, « Descriptive files before code »). The variables are exactly the two that say the same.
 */
const FLOOR = [
  '--no-replace-objects',
  '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  'core.fsmonitor=false',
  'core.hooksPath=/dev/null',
  'diff.ignoreSubmodules=all',
  'core.attributesFile=/dev/null',
];

const ClosedGitSchema = z
  .object({
    options: z
      .array(z.string().min(1))
      .refine((options) => FLOOR.every((option) => options.includes(option))),
    environment: z
      .object({ GIT_ATTR_NOSYSTEM: z.literal('1'), GIT_NO_REPLACE_OBJECTS: z.literal('1') })
      .strict(),
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
  return parsed.success ? parsed.data : { failure: 'git-closed.json : schéma refusé' };
}

/** The closed options and variables of git in `text`; a refused text throws, and no git is started. */
export function loadClosedGit(text: string): ClosedGit {
  const parsed = parseClosedGit(text);
  if ('failure' in parsed) throw new Error(parsed.failure);
  return parsed;
}

/** The committed file of the launcher package, never one of the checkout under inspection. A refused file throws. */
export function closedGit(): ClosedGit {
  const path = fileURLToPath(
    new URL('../git-closed.json', import.meta.resolve('@architect-os/sandbox/runtime-context')),
  );
  return loadClosedGit(new TextDecoder().decode(readFileSync(path)));
}
