// The composition root of the session guard (docs/design/exigences-spec.md, P7 and P8). Claude Code starts `cli.ts`
// before every Bash or MCP call of a session of this repository (`.claude/settings.json`, `hooks.PreToolUse`), gives
// it the call as JSON on stdin, and blocks the call when the hook exits with 2, showing Claude its stderr
// (https://code.claude.com/docs/en/hooks.md, « Blocking error: your hook exits 2 »). Any other non-zero exit lets the
// call through, so the guard never throws: an unreadable call, or a failure of its own, is refused.
import { readFileSync } from 'node:fs';
import { callRefusal, type Refusal } from '#guard/domain/refusal.js';

export interface GuardDependencies {
  /** The text Claude Code wrote on stdin; it may throw when stdin cannot be read. */
  readonly stdin: () => string;
  readonly stderr: { write(text: string): unknown };
}

/** The dependencies of the process: stdin read whole as UTF-8 (file descriptor 0), and its stderr. */
export function guardDependencies(
  proc: { readonly stderr: GuardDependencies['stderr'] },
  read: (fd: number, encoding: 'utf8') => string = readFileSync,
): GuardDependencies {
  return { stdin: () => read(0, 'utf8'), stderr: proc.stderr };
}

function refusalOf(deps: GuardDependencies): Refusal | undefined {
  try {
    return callRefusal(JSON.parse(deps.stdin()));
  } catch {
    return 'appel illisible';
  }
}

/** The exit code of the hook: 0 to let the call through, 2 to block it with one line on stderr. */
export function runGuard(deps: GuardDependencies): number {
  const refusal = refusalOf(deps);
  if (refusal === undefined) return 0;
  deps.stderr.write(`architect-os session-guard: ${refusal}\n`);
  return 2;
}
