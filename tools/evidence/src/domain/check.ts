import type { ReasonCode, Source } from './contract.js';
import { normalizePassage, normalizeTitle } from './normalize.js';
import type { Lookup } from './ports.js';

export interface Reason {
  code: ReasonCode;
  detail: string;
}

/**
 * The reasons to refuse one source, in the order of the table of docs/design/evidence-desk.md §5. `unavailable` is not
 * an input: the use case defers the whole answer before checking.
 */
export function checkSource(
  source: Source,
  lookup: Exclude<Lookup, { kind: 'unavailable' }>,
  text: string | undefined,
): Reason[] {
  const reasons: Reason[] = [];
  if (lookup.kind === 'unknown') {
    reasons.push({ code: 'DOI_UNKNOWN', detail: `${source.doi} is not registered` });
  } else {
    if (normalizeTitle(source.title) !== normalizeTitle(lookup.title)) {
      reasons.push({ code: 'TITLE_MISMATCH', detail: `registry title: ${lookup.title}` });
    }
    if (lookup.retracted) reasons.push({ code: 'RETRACTED', detail: 'the registry lists a retraction' });
  }
  if (text === undefined) {
    reasons.push({
      code: 'SOURCE_TEXT_MISSING',
      detail: `${source.text} is absent, not a regular file or too large`,
    });
    return reasons;
  }
  if (lookup.kind === 'found' && !normalizeTitle(text).includes(normalizeTitle(lookup.title))) {
    reasons.push({ code: 'TEXT_NOT_OF_DOI', detail: `${source.text} does not contain the registry title` });
  }
  if (!normalizePassage(text).includes(normalizePassage(source.quote))) {
    reasons.push({ code: 'QUOTE_ABSENT', detail: `the quote is not in ${source.text}` });
  }
  return reasons;
}
