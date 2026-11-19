# Step V.1, last pass: one description re-wrapped

The pass before (`steps/design-truth-9/`) was accepted; its review left one proposal: the description at the top of `modules/broker/features/broker-start.feature` holds a line of 148 characters since the message of refusal changed, and the next line was wrapped for the shorter text.

## What to do

Re-wrap the description of `modules/broker/features/broker-start.feature` so that its lines are no longer than the other lines of descriptions in `modules/broker/features/` (measure them, and say the width you used), changing no word. Then read the descriptions of the other features of `modules/broker/features/` the same way and re-wrap any that is uneven; list them. Touch nothing else.

## Checklist

- [ ] `npx prettier --check .`: green. `npx cucumber-js --profile replay modules/broker/features/broker-start.feature --dry-run`: give the count of scenarios, unchanged.
- [ ] `git diff --word-diff` on the files you changed shows no changed word.
