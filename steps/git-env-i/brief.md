# Step G.1, ninth pass: a scenario that depends on how fast a process starts

The earlier passes are in the worktree (`steps/git-env-a/` to `steps/git-env-h/`). The eighth pass did its two points and was stopped by the check `scenarios`, before its review, on a scenario it had not touched:

```
Scenario: a git call that never answers is stopped at the bound: read-tree HEAD   # packages/sandbox/features/tree-fingerprint.feature
  When I try to take the fingerprint of the directory with a bound of 300 milliseconds
  Then the fingerprint throws "l'empreinte de l'arbre a échoué : git read-tree HEAD"
  + "l'empreinte de l'arbre a échoué : git rev-parse HEAD"
```

The call that was meant to answer at once, `rev-parse HEAD`, was itself stopped at the bound. Since the first pass of this step the fake git is a node script started through `process.execPath`: a bound of 300 milliseconds is of the order of the start of a node process, and on a loaded machine the start alone exceeds it. The scenario passes or fails with the load of the machine: it proves nothing reliably.

Do this, and nothing else:

1. `packages/sandbox/features/tree-fingerprint.feature` and its steps: the bound of that outline must be far above the start of a process and far below the time the fake git stays silent. Give it 5 seconds against a silence of at least 60, and say in the description of the outline why these two numbers and not smaller ones. If the fake git can be made to start faster without losing what it records (its arguments, the names of its environment, its answers read from files), do that as well and say so; do not trade the proof for speed.
2. Look for the same kind in the scenarios this step added or changed in `tools/test-gate/features/` and `tools/deliver/features/`: an assertion that holds only if a process starts or ends within a small time. Say which you found in the report, and correct them the same way; if none, say none.

## Not in this step

Everything else. Production files are not changed. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay packages/sandbox/features/tree-fingerprint.feature packages/sandbox/features/tree-fingerprint-fresh.feature`: green, three times in a row; give the three counts and durations.
