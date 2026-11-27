// What « append-only » means for a file of the delivery (deliver.json, `appendOnly`): the bytes it had at the base the
// gate judged are, unchanged, the first bytes it has at the delivered commit. A line inserted, rewritten or removed
// anywhere before the end, a final line break removed, or the file deleted, breaks it; bytes added at the end do not.

/** `before` and `after` are the bytes of the file at the base and at the commit; undefined where it is absent. */
export function onlyAppended(before: Uint8Array | undefined, after: Uint8Array | undefined): boolean {
  if (before === undefined) return true;
  if (after === undefined) return false;
  // A shorter `after` has no byte at the last indexes of `before`, and `undefined` equals no byte.
  return before.every((byte, index) => after[index] === byte);
}
