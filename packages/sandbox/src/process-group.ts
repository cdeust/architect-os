/**
 * Tue tout le groupe d'un processus lancé avec `detached` : `kill(-pgid)`, jamais le seul chef, qui laisse ses
 * descendants (10 sur 11 sous Linux pour srt) [T-06]. Un groupe déjà disparu n'est pas une erreur, ni un processus
 * jamais lancé : sans pid, `kill(NaN)` lève ERR_INVALID_ARG_TYPE, rattrapée comme un groupe disparu.
 */
export function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  try {
    process.kill(-(pid ?? Number.NaN), signal);
  } catch {
    /* groupe déjà disparu, ou jamais lancé */
  }
}
