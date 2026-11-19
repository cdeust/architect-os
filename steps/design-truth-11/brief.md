# Step V.1, closing: the count of the suite, and one comment re-wrapped

The passes before are in the worktree (`steps/design-truth-1/` to `-10/`). Two rows of `Examples` were added to `modules/broker/features/broker-start.feature` (design-truth-8): the suite counts two more scenarios than the README says. The maintainer counted on the host: a dry run of the default profile over its paths gives 3,116.

## What to do

1. `README.md` near line 159 says « The whole suite is 3,114 scenarios ». Count the suite the way that sentence says it is counted, write the number you obtain, and search the README, `docs/` (outside the two journals and `steps/`) and `CLAUDE.md` for every other statement of the whole count; correct each. A count of a part of the suite (one feature, one area) is corrected only if this change altered that part.
2. `modules/broker/src/infrastructure/key-file.ts`, the comment near line 4 is 126 characters while its neighbours are 117 and 106: re-wrap it, word for word, to the width of its neighbours. Change no code.

Touch nothing else. The unpublished section 105 of the journal does not give the count: leave it.

## Checklist

- [ ] `npx prettier --check .`: green. `npx tsc -p modules/broker --noEmit --composite false --incremental false`: green.
- [ ] `git diff --word-diff -- modules/broker/src/infrastructure/key-file.ts` shows no changed word.
