# Step G.1, eleventh pass: a scenario that depended on the environment of the host, found by CI

The change of this step was committed and its delivery started: the gate of the host was green, and the Linux job of CI was red. Two scenarios of `features/descriptive/closed-git-environment.feature` failed there, and with them the first run of the mutation tool:

```
Scenario: a child that does not load the support file keeps its GIT_ variables
  ✖ Then the child printed "GITHUB_TOKEN, GIT_DIR, GIT_EDITOR"
    + 'GITHUB_ACTION, GITHUB_ACTIONS, GITHUB_ACTION_REF, GITHUB_ACTION_REPOSITORY, GITHUB_ACTOR, …'
Scenario: a child that loads the support file keeps no variable that starts with GIT_
  ✖ Then the child printed "GITHUB_TOKEN"
    + 'GITHUB_ACTION, GITHUB_ACTIONS, …'
```

`features/steps/closed-git-environment.ts` starts its child `node` with `{ ...process.env, GIT_DIR, GIT_EDITOR, GITHUB_TOKEN }` and prints the names that start with `GIT`. A runner of GitHub Actions sets some forty `GITHUB_…` variables: the scenario, written to prove that the suite does not inherit the environment of the host, itself inherits it. The first brief asked for a scenario that « proves it without depending on the host ».

Do this, and nothing else:

1. The child of these two scenarios is started with a closed environment: what `node` and `tsx` need to start (`PATH`, and `HOME` and `TMPDIR` if they are needed: try without first), and the three variables of the scenario; nothing else of the process. The expected output stays what the feature says.
2. Prove it in the scenario's own terms: run the two scenarios with forty variables named `GITHUB_SOMETHING_<n>` set in the process (set them in the shell that starts cucumber for this check, not in the step), and say in the report that they pass.
3. Look, in every step file this step added or changed (`git diff --stat 9b720b2` and the untracked files), for a process started with the whole environment of the suite, or an assertion on names or values of variables the scenario did not set itself. Say which you found in the report and correct them the same way; if none, say none. The production files are already held by `features/arch/closed-git-environment-text.feature`.

## Not in this step

Everything else. Production files are not changed. Nothing is written under `steps/` by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive/closed-git-environment.feature`: green, without and with the forty variables set in the shell; give both counts.
