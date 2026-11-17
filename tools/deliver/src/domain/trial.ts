// The name of the trial branch (docs/design/orchestration-fable-5-2.md §14, threat T: no option, no path).

/** The trial branch for a name, or undefined when the name is refused. */
export function trialBranch(prefix: string, name: string): string | undefined {
  return /^[a-z][a-z0-9-]{0,30}$/.test(name) ? `${prefix}${name}` : undefined;
}
