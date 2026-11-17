// What `check` says of a source (docs/design/anthropic-watch.md §3): pure functions of what was observed and of what the
// repository holds. Every string built here holds ids and paths of the register, versions, addresses, hashes and counts
// only.
import type { SeenChangelog, SeenIndex, SeenPage, SeenPin } from './observe.js';
import type { Reason } from './ports.js';

export type Finding =
  /** `keepable` is declared absent so that it reads on every finding, without a test of the state before it. */
  | { state: 'current'; keepable?: undefined }
  /** `summary` follows « en retard, »; `lines` are printed under the source; `keepable`: the new text may be kept. */
  | { state: 'behind'; summary: string; lines: string[]; keepable: boolean };

/** A source whose text could not be read, or was refused. */
export interface Unreadable {
  state: 'unreadable';
  reason: Reason;
}

const behind = (summary: string, keepable = false, lines: string[] = []): Finding => ({
  state: 'behind',
  summary,
  lines,
  keepable,
});

const count = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

/** A pin: the version each manifest pins (undefined when it pins none) against the version published. */
export function comparePin(seen: SeenPin, pins: { path: string; version: string | undefined }[]): Finding {
  const distinct = [...new Set(pins.map((pin) => pin.version))];
  if (distinct.length > 1) {
    const each = pins.map((pin) => `${pin.path} ${pin.version}`).join(', ');
    return behind(`les manifestes n'épinglent pas la même version : ${each}, publié ${seen.published}`);
  }
  return distinct.includes(seen.published)
    ? { state: 'current' }
    : behind(`épinglé ${distinct.join()}, publié ${seen.published}`);
}

export function compareChangelog(seen: SeenChangelog): Finding {
  const { read } = seen.source;
  if (read === undefined) return behind('jamais lu', true);
  if (seen.latest === read.version) return { state: 'current' };
  const head = `lu jusqu'à ${read.version} le ${read.on}, publié ${seen.latest}`;
  const above = seen.versions.indexOf(read.version);
  return behind(
    above === -1
      ? `${head}, la version lue n'est plus dans le fichier`
      : `${head}, ${count(above, 'version', 'versions')} au-dessus`,
    true,
  );
}

export function comparePage(seen: SeenPage): Finding {
  const { read, mechanisms } = seen.source;
  if (read === undefined) return behind('jamais lu', true);
  if (read.sha256 === seen.sha256) return { state: 'current' };
  return behind(`la page a changé depuis le ${read.on} ; à relire : ${mechanisms.join(', ')}`, true);
}

/** An index: the addresses seen against the committed list, which is absent when the index was never read. */
export function compareIndex(seen: SeenIndex, committed: string[] | undefined): Finding {
  if (committed === undefined) return behind('jamais lu');
  const added = seen.addresses.filter((address) => !committed.includes(address));
  const removed = committed.filter((address) => !seen.addresses.includes(address));
  if (added.length === 0 && removed.length === 0) return { state: 'current' };
  return behind(
    `${count(added.length, 'page ajoutée', 'pages ajoutées')}, ${count(removed.length, 'retirée', 'retirées')}`,
    false,
    [...added.map((address) => `    + ${address}`), ...removed.map((address) => `    - ${address}`)],
  );
}

/** The exit code of `check`: 3 when a source is unreadable, else 1 when one is behind, else 0. */
export function exitCode(findings: readonly (Finding | Unreadable)[]): number {
  if (findings.some((finding) => finding.state === 'unreadable')) return 3;
  return findings.some((finding) => finding.state === 'behind') ? 1 : 0;
}

/** The lines of one source in the output of `check`; `kept`: its new text was kept. */
export function render(id: string, finding: Finding, kept: boolean): string[] {
  if (finding.state === 'current') return [`- ${id} : à jour`];
  return [`- ${id} : en retard, ${finding.summary}${kept ? ' ; texte gardé' : ''}`, ...finding.lines];
}

/** The line of a source that could not be read, in the output of `check` and of `read`. */
export function renderUnreadable(id: string, reason: Reason): string[] {
  return [`- ${id} : illisible, ${reason}`];
}
