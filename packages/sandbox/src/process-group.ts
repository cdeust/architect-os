/**
 * Tue tout le groupe d'un processus lancé avec `detached` : `kill(-pgid)`, jamais le seul chef, qui laisse ses
 * descendants (10 sur 11 sous Linux pour srt) [T-06]. Un groupe déjà disparu n'est pas une erreur.
 */
export function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* groupe déjà disparu */
  }
}
