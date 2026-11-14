// The two normalisations of docs/design/evidence-desk.md §5.

/** Tags removed, NFKC, lower case, letters and digits only. */
export function normalizeTitle(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** NFKC, every run of blanks reduced to one space; the case is kept. */
export function normalizePassage(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ');
}
