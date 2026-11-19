# Step V.1, last pass: one table of examples re-padded

The pass before (`steps/design-truth-8/`) changed the message of refusal of the key file of the broker; its review accepted it and left two proposals. The maintainer takes the first and keeps the second as it is: the descriptions of `modules/broker/features/broker-scheme.feature`, `broker.feature` and `live/broker-live.feature` that speak of a « 0600 file » describe how the test or the owner provisions the file, which is true, and `broker-live.feature` already says « a file only its owner reads (0600) ».

## What to do

1. `modules/broker/features/broker-start.feature`: the longer message broke the alignment of a table of `Examples`. Re-pad every column of that table (the header and every row) to its widest cell, as the other tables of the file are padded. Change no cell.
2. Read every other table of `Examples` in `modules/broker/features/` the same way and re-pad any that is out of line; list them.

Touch nothing else.

## Checklist

- [ ] `npx prettier --check .`: green. `npx cucumber-js --profile replay modules/broker/features/broker-start.feature --dry-run`: give the count of scenarios, unchanged from before the pass. (Run it yourself.)
- [ ] `git diff -w` on the files you changed is empty (only spaces changed); show it.
