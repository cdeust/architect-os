# Step D.0, fourth pass: a published scenario that needs a writable /tmp

The third pass (`steps/deps-measure-d/`: read its brief, it still holds) did its ten points on `bench/deps-store/` and was stopped before its review by the check `docs`, on a scenario it had not touched:

```
Scenario: a child that loads the support file keeps no variable that starts with GIT_   # features/descriptive/closed-git-environment.feature:13
  Error: EPERM: operation not permitted, mkdir '/tmp/tsx-501'
```

`features/steps/closed-git-environment.ts` starts a child `node --import tsx` with a closed environment that holds no `TMPDIR`. tsx then keeps its cache under `/tmp`, which the sandbox of a check cannot write; on the host that directory existed until the machine was restarted. The scenario depends on a directory of the machine: the kind of dependence the step that wrote it was removing.

Do this, and nothing else:

1. The child of those scenarios receives the `TMPDIR` of the process as well, when the process has one: it is where a program is allowed to write. Say so in the comment of the helper. The expected output of the scenarios does not change.
2. Look in `features/steps/` and in the step files under `packages/*/features/steps/` and `tools/*/features/steps/` for another child started with a closed environment that holds no `TMPDIR` while it starts `node` with `tsx`, and give it the same; say which in the report, or none.

The maintainer's change to `docs/design/orchestration-fable-5-2.md` is not to be reported nor touched. `bench/deps-store/` is not changed by this pass: its review comes with this one.

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive`: green in your sandbox; give the count.
