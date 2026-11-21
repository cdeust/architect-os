# Step 1a, commit 1: two equivalence marks that hide killable mutants

The pass before (`steps/runtime-1a-6/`: read its brief and its report) treated the 21 mutants the CI found alive. Its review found that two of the equivalence marks it added are wider than the equivalence they claim: a mark of the form `// Stryker disable next-line <Mutator>: …` turns off **every** mutant of that mutator on the line, and on both lines one of them is killed by the suite today. A mark that hides a mutant the suite can kill is a weakening of the gate. Each at its cause:

1. `tools/runtime/src/application/admit.ts`, the line that refuses an unreadable marker or a marker on another device (near line 56): of its two string literals, `'unreadable'` → `""` is equivalent (an unreadable marker carries no device, so the second condition refuses it with the same code), and `refuse('RUNTIME_MARKER_INVALID')` → `refuse("")` is not (the reviewer applied it by hand: 4 scenarios fail). Remove the redundancy the equivalent mutant points to instead of marking it: if the second condition alone decides, the first is redundant and goes; if each must stay for a reason, split the line so that each literal stands on a line of its own and only the equivalent one carries the mark, with its invariant. Remove the mark that covers the killable literal.
2. `tools/runtime/src/main.ts` near line 40: the mark covers `false ?` (equivalent: the decoder of the policy turns a missing text into the same refusal) and `true ?` (not equivalent: 10 scenarios kill it). Delete the redundant branch, as the review proposes (the decoder takes the text or an empty string, or accepts `undefined`), so that no conditional is left on the line and no mark is needed.
3. `tools/runtime/features/steps/admit.ts` near line 97: the step that patches the memory adapter's `sample` to answer for an `undefined` path, which the type of the port does not allow, gets a comment that says why: on the real adapter the same case ends in an unexpected error, and the stub is the only way to show the refusal code the line decides.

Then read every other `Stryker disable` mark this step added (search `tools/runtime/` for them) the same way: for each, list in the report every mutant of that mutator on that line, and show that each is equivalent; where one is not, do as in point 1.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay tools/runtime/features features/arch features/descriptive`: green; give the counts. (With a formatter that does not write the report of the gate.)
- [ ] The table of the marks of point 4 in the report.
