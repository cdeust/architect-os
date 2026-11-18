# Step R.1b, third pass: two points of the gate rule left by the review of the second

The two earlier passes are in the worktree (`steps/briefs-b/`, `steps/briefs-b2/`: read their briefs, they still hold). Their review found the documentation stale, which the maintainer has corrected in `docs/`, and left two points about `features/steps/steps-folder.ts`. Do these two, and nothing else.

## 1. The whole folder removed from the disk while git still lists it

Inside a repository, when `steps/` is absent from the disk and git still lists paths under it (tracked, removed and not yet from the index), the rule returns no defect and git is never asked. Apply the principle of the second pass one level up: git still lists the paths, so the rule answers with a reason, `steps: is not a directory`, the one that exists. When the folder is absent and git lists nothing under it, there is still no defect: that is the state of a repository where no step has been played. One scenario for each case, on a copy that is a repository.

## 2. The git of the scenarios does not read the configuration of the host

The scenarios of `features/descriptive/steps.feature` that make a repository run `git init`, `git add`, `git commit` from `features/steps/steps-folder.ts`. Only the identity and the signature are overridden: a hook, a template or an exclusion file of the host's global configuration could change what they prove. Run every git command of these steps with no global and no system configuration (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`) and with the hooks switched off, in one helper that all of them use. The scenario that sets an exclusion file of the host keeps doing so on purpose, for the call of the rule itself: say in a comment why that one differs. The rule's own call to git (`committable`) is production behaviour of the gate and keeps reading what it reads today.

## Not in this step

Everything the first brief excluded, `docs/` included. Nothing is written under `steps/` of this worktree by a scenario or by hand.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive`: green; give the count.
- [ ] The seventeen broken copies and the scenarios of the second pass still pass, their reasons word for word.
- [ ] No file changed outside `features/steps/steps-folder.ts` and `features/descriptive/steps.feature`.
