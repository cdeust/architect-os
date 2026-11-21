// The named refusals of the admission (docs/design/orchestration-fable-5-2.md §14, « Un seul lieu d'écriture »). Each
// is printed as `aos: <CODE>` on stderr, with exit code 2. Four of them are decided by the shell entry `aos` before
// Node runs, and are listed here so that the closed list is in one place; they come first, in the order `aos` checks
// them: USAGE, RUNTIME_ROOT_REQUIRED when the setting is absent or empty, then RUNTIME_NODE_MISSING and
// RUNTIME_NODE_UNSUPPORTED. The rest follow in the order of the admission (src/application/admit.ts), where
// RUNTIME_ROOT_UNSAFE is decided twice: on the spelling of the setting, before the policy, and on the disk, after
// RUNTIME_ROOT_UNAVAILABLE, where it is listed.
export const REFUSAL_CODES = [
  'USAGE',
  'RUNTIME_ROOT_REQUIRED',
  'RUNTIME_NODE_MISSING',
  'RUNTIME_NODE_UNSUPPORTED',
  'RUNTIME_POLICY_INVALID',
  'RUNTIME_ROOT_UNAVAILABLE',
  'RUNTIME_ROOT_UNSAFE',
  'RUNTIME_MARKER_MISSING',
  'RUNTIME_MARKER_INVALID',
  'RUNTIME_ENVIRONMENT_UNKNOWN',
  'RUNTIME_SPACE_UNAVAILABLE',
  'RUNTIME_ROOT_SPACE_LOW',
  'RUNTIME_HOME_SPACE_LOW',
  'RUNTIME_SETUP_FAILED',
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];
