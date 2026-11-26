/**
 * The effective jobs of a run of `current` attempts: the newest execution of each name, read from the current attempt
 * back to the first. A rerun of the failed jobs executes only some jobs again, so an older attempt holds the latest
 * execution of the others. With `names`, the reading stops once every name has an execution; without, every attempt is
 * read. A current attempt without a job is a run that has not started again: it has no effective job. Executions of
 * one name within one attempt are all kept, for `ciState` to refuse.
 */
export function effectiveJobs<Job extends { readonly name: string }>(
  current: number,
  jobsOf: (attempt: number) => readonly Job[],
  names?: readonly string[],
): Job[] {
  const effective: Job[] = [];
  const seen = new Set<string>();
  for (let attempt = current; attempt >= 1; attempt--) {
    const rows = jobsOf(attempt);
    if (attempt === current && rows.length === 0) return [];
    const fresh = rows.filter((row) => !seen.has(row.name));
    effective.push(...fresh);
    for (const row of fresh) seen.add(row.name);
    if (names?.every((name) => seen.has(name))) break;
  }
  return effective;
}
