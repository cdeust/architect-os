// What the sessions of this repository may not do on the forge (docs/design/exigences-spec.md, §5): merge a pull
// request, set the owner's approval label, bypass the rules of a branch as an administrator, have the forge update a
// branch, or push a protected branch. The merge belongs to the automaton of the repository, on the owner's approval.
//
// The rule is coarse and closed by default, and it does not depend on the form of the command (Spec #406 learned in four
// rounds of review that a list of command forms always misses one). The whole text of the call is normalized as the
// shell would read a word: quotes and backslashes removed, case ignored, blanks folded. A call that names a vehicle to
// GitHub anywhere, and a forbidden object anywhere, is refused. The only exception is a narrow list of reads, each
// recognized on the whole call, with nothing left over. This is a barrier against mistakes and naive injection, not a
// security boundary: the sessions act under the owner's account, and what this file cannot see is written in the design.

/** A rule a call breaks: a closed list of fixed strings, never a text read from the call. */
export type Refusal =
  | 'la fusion appartient à l’automate du dépôt, sur approbation du propriétaire'
  | 'le label d’approbation est posé par le propriétaire seul'
  | 'le contournement administrateur est refusé'
  | 'la mise à jour de branche par la forge est refusée'
  | 'la poussée directe sur une branche protégée est refusée'
  | 'appel illisible';

/** The branches the rulesets of the repository protect (`gh api repos/cdeust/architect-os/rulesets`). */
export const PROTECTED_BRANCHES = ['main', 'feat/gate-1a'] as const;

/** The label on which the automaton of the repository merges; only the owner sets it. */
export const APPROVAL_LABEL = 'owner-approved';

const MERGE = 'la fusion appartient à l’automate du dépôt, sur approbation du propriétaire';
const LABEL = 'le label d’approbation est posé par le propriétaire seul';
const ADMIN = 'le contournement administrateur est refusé';
const UPDATE = 'la mise à jour de branche par la forge est refusée';
const PUSH = 'la poussée directe sur une branche protégée est refusée';
const UNREADABLE = 'appel illisible';

/** The text of a call as the shell would read its words: no quote, no backslash, lower case, single spaces. */
export function normalized(text: string): string {
  return text
    .replaceAll(/['"`\\]/g, '')
    .toLowerCase()
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** A vehicle to GitHub, anywhere in the call: `gh` as a word (by any path), an HTTP client, an address of GitHub. */
const VEHICLE = /\bgh\b|\bcurl\b|\bwget\b|\bhttp\b|\bhub\b|github\.com|mcp__.*github/;
/** The approval label by name, a label by its identifier, or a label taken from a value the call does not show. */
const LABEL_OBJECT = new RegExp(
  [
    APPROVAL_LABEL,
    'addlabelstolabelable',
    'labelids',
    '\\bla_[a-z0-9]',
    '(--add-label|--label|\\s-l)[ =]?(\\$|<)',
    '--input\\b',
    '=@',
  ].join('|'),
);
const MERGE_OBJECT = /\bmerge\b|mergepullrequest|automerge|auto_merge|merge_pull_request|merge-queue/;
// The call is normalized to single spaces: the flag follows one.
const ADMIN_OBJECT = / --admin\b/;
const UPDATE_OBJECT = /update-branch|update_pull_request_branch|updatepullrequestbranch/;
/** A protected branch as a word, a destination (`:main`, `+main`) or a full reference (`refs/heads/main`). */
const PROTECTED = new RegExp(`(^|[\\s:+/])(${PROTECTED_BRANCHES.join('|')})($|[\\s;&|)])`);

/**
 * A read, recognized on the whole call with nothing left over: `gh` and one of a few subcommands that only read,
 * followed by words with no separator, redirection, substitution or variable. Anything else is not a read.
 */
const READ =
  /^gh (pr (view|list|checks|diff|status)|issue (view|list)|label list|run (view|list|watch))( [^\s;&|<>$()]+)*$/;

/** The rule the text of a call breaks; `text` is the command of a Bash call, or the name and input of an MCP tool. */
export function textRefusal(text: string): Refusal | undefined {
  const call = normalized(text);
  const pushed = /\bgit\b/.test(call) && /\bpush\b/.test(call) && PROTECTED.test(call);
  if (pushed) return PUSH;
  if (!VEHICLE.test(call)) return undefined;
  if (ADMIN_OBJECT.test(call)) return ADMIN;
  if (UPDATE_OBJECT.test(call)) return UPDATE;
  if (READ.test(call)) return undefined;
  if (LABEL_OBJECT.test(call)) return LABEL;
  if (MERGE_OBJECT.test(call)) return MERGE;
  return undefined;
}

/**
 * The rule a tool call breaks, from the input Claude Code gives a PreToolUse hook: for Bash its command, for an MCP
 * tool its name and its whole input. The file tools (Read, Edit, Write) reach no forge and are not read: a file
 * written now and run later without naming the label is one of the paths this guard does not see (design, §5).
 * `Object` reads a missing or a primitive input as an object without fields.
 */
export function callRefusal(input: unknown): Refusal | undefined {
  const call = Object(input) as { tool_name?: unknown; tool_input?: unknown };
  const tool = call.tool_name;
  if (typeof tool !== 'string') return UNREADABLE;
  if (/^mcp__/.test(tool)) return textRefusal(`${tool} ${JSON.stringify(call.tool_input ?? null)}`);
  if (tool !== 'Bash') return undefined;
  const command = (Object(call.tool_input) as { command?: unknown }).command;
  // `String`: whatever the test reads, the command is read as text and never throws.
  return typeof command === 'string' ? textRefusal(String(command)) : UNREADABLE;
}
