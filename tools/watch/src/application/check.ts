// `check` (docs/design/anthropic-watch.md §3): one line per source, nothing written in the repository.
import {
  compareChangelog,
  compareIndex,
  comparePage,
  comparePin,
  exitCode,
  render,
  renderUnreadable,
  type Finding,
  type Unreadable,
} from '../domain/compare.js';
import { observe, type Seen } from '../domain/observe.js';
import type { Files, Reason, Sources } from '../domain/ports.js';
import type { Register, Source } from '../domain/register.js';
import { addressOf, committedOf, pinsOf } from './gather.js';

export interface CheckDependencies {
  readonly sources: Sources;
  readonly repository: Files;
  /** The folder of `--keep`, when given. */
  readonly keep: Files | undefined;
}

interface Verdict {
  outcome: Finding | Unreadable;
  lines: string[];
}

const unreadable = (id: string, reason: Reason): Verdict => ({
  outcome: { state: 'unreadable', reason },
  lines: renderUnreadable(id, reason),
});

/** What the source says against what the repository holds, reading from the repository only what its kind needs. */
function compareSeen(seen: Seen, repository: Files): Finding {
  switch (seen.kind) {
    case 'pin':
      return comparePin(seen, pinsOf(seen.source, repository));
    case 'changelog':
      return compareChangelog(seen);
    case 'page':
      return comparePage(seen);
    case 'index':
      return compareIndex(seen, committedOf(seen.source, repository));
  }
}

/** What `check` finds of one source; its new text is kept when the source is behind and the text may be kept. */
async function find(deps: CheckDependencies, source: Source): Promise<Verdict> {
  const reading = await deps.sources.fetch(addressOf(source));
  if (reading.kind === 'unreadable') return unreadable(source.id, reading.reason);
  const seen = observe(source, reading.text);
  if (seen === undefined) return unreadable(source.id, 'contenu refusé');
  const finding = compareSeen(seen, deps.repository);
  if (deps.keep !== undefined && finding.keepable) {
    deps.keep.write(`${source.id}.new.txt`, reading.text);
    return { outcome: finding, lines: render(source.id, finding, true) };
  }
  return { outcome: finding, lines: render(source.id, finding, false) };
}

export async function check(
  deps: CheckDependencies,
  register: Register,
): Promise<{ lines: string[]; code: number }> {
  const verdicts = await Promise.all(register.sources.map((source) => find(deps, source)));
  return {
    lines: [`veille : ${register.sources.length} sources`, ...verdicts.flatMap((verdict) => verdict.lines)],
    code: exitCode(verdicts.map((verdict) => verdict.outcome)),
  };
}
