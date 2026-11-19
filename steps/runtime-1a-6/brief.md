# Step 1a, commit 1: the 21 mutants the gate of the CI found alive

Commit 1 of step (1a) is the last commit of this worktree (`HEAD`, not published): read `steps/runtime-1a-1/` to `-5/`. Its delivery stopped: the gate of the CI, on Linux, mutated the 1,158 mutants of the changed production lines of `tools/runtime/` and found 20 that survived and 1 that no scenario covers. The rule of the repository (`CLAUDE.md`, « Adding a brick », 6): a changed production line has 0 surviving mutant; an equivalent mutant is marked `// Stryker disable next-line <Mutator>: équivalent: <invariant>`, with the invariant that makes it equivalent.

The 21, as the report of the gate gives them (file:line, mutator, status, the replacement, the line):

- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:240` BooleanLiteral (NoCoverage): replaced by `true` — line: `if (!this.empty(path)) return false;`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:68` ObjectLiteral (Survived): replaced by `{}` — line: `this.nodes.set(path, { kind: 'special' });`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:68` StringLiteral (Survived): replaced by `""` — line: `this.nodes.set(path, { kind: 'special' });`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:124` MethodExpression (Survived): replaced by `known.endsWith(`${path}/`)` — line: `if (known === path || known.startsWith(`${path}/`)) this.nodes.delete(known);`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:164` MethodExpression (Survived): replaced by `below.some(isComponent)` — line: `if (below.length === 0 || !below.every(isComponent)) return 'unsafe';`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:182` UpdateOperator (Survived): replaced by `--this.inodes` — line: `this.make(path, { kind: 'directory', device: this.deviceOfParent(path), inode: ++this.inodes });`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:199` UpdateOperator (Survived): replaced by `--this.inodes` — line: `const inode = ++this.inodes;`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:207` UpdateOperator (Survived): replaced by `--this.inodes` — line: `this.make(path, { kind: 'directory', device: this.deviceOfParent(path), inode: ++this.inodes });`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:240` ConditionalExpression (Survived): replaced by `false` — line: `if (!this.empty(path)) return false;`
- `tools/runtime/src/infrastructure/memory-runtime-filesystem.ts:279` UpdateOperator (Survived): replaced by `--this.inodes` — line: `this.nodes.set(replaced, { kind: 'directory', device, inode: ++this.inodes });`
- `tools/runtime/src/application/admit.ts:55` ConditionalExpression (Survived): replaced by `false` — line: `if (marker.kind === 'unreadable' || marker.device !== state.device) return refuse('RUNTIME_MARKER_INVALID');`
- `tools/runtime/src/application/admit.ts:55` StringLiteral (Survived): replaced by `""` — line: `if (marker.kind === 'unreadable' || marker.device !== state.device) return refuse('RUNTIME_MARKER_INVALID');`
- `tools/runtime/src/application/admit.ts:62` ConditionalExpression (Survived): replaced by `false` — line: `if (home === undefined) return refuse('RUNTIME_SPACE_UNAVAILABLE');`
- `tools/runtime/src/domain/root.ts:18` StringLiteral (Survived): replaced by `""` — line: `return setting.slice(1).split('/').every(isComponent) ? 'canonical' : 'unsafe';`
- `tools/runtime/src/infrastructure/node-runtime-filesystem.ts:197` BooleanLiteral (Survived): replaced by `true` — line: `const stats = lstatSync(path, { bigint: true, throwIfNoEntry: false });`
- `tools/runtime/src/infrastructure/node-runtime-filesystem.ts:198` OptionalChaining (Survived): replaced by `stats.isDirectory` — line: `if (stats?.isDirectory() !== true || stats.dev !== device) return 'unsafe';`
- `tools/runtime/src/infrastructure/node-runtime-filesystem.ts:217` ConditionalExpression (Survived): replaced by `false` — line: `if (path === undefined) return false;`
- `tools/runtime/src/infrastructure/node-runtime-filesystem.ts:229` ConditionalExpression (Survived): replaced by `false` — line: `if (path === undefined) return false;`
- `tools/runtime/src/infrastructure/policy-file.ts:28` ArrowFunction (Survived): replaced by `() => undefined` — line: `const missing = keys.find((key) => !Object.hasOwn(object, key));`
- `tools/runtime/src/infrastructure/policy-file.ts:29` ConditionalExpression (Survived): replaced by `false` — line: `if (missing !== undefined) throw new Offending(`${field}.${missing}`);`
- `tools/runtime/src/main.ts:40` ConditionalExpression (Survived): replaced by `false` — line: `const decoded = text === undefined ? undefined : decodePolicy(text);`

## What to do

For each of the 21, at its cause:

1. Read the line and what it decides. If a scenario should notice the change and none does, the scenario is missing: write it, in the feature and with the steps where its neighbours live, as a pair where it helps (the refusal and its closest legitimate neighbour). A survivor in the in-memory adapter is a hole in the contract of the port: the case goes in the contract, so that it runs on both adapters, unless it concerns a behaviour only the memory adapter has (then say so).
2. If the mutant is truly equivalent (no input can tell the two lines apart), mark it in the justified form, with the invariant, and say in the report how you established it (which inputs you tried). An equivalent mark is not a way out of writing a scenario: if you can write an input that tells them apart, it is not equivalent.
3. If a line is dead or redundant (the mutant survives because the line decides nothing), remove the line and say why.

Then, for the lines you changed and the 21 lines above, play the mutation yourself if your sandbox allows it (`npx stryker run --mutate "<file>:<line>-<line>,..."` on exactly those ranges), and give the count; else say so plainly: the host plays it.

The commit stays commit 1: no script of `package.json`, no workflow changes. If the count of the suite changes, recount it the way the README says and correct the README.

## Report

A table of the 21: killed by which scenario (name the feature and the title), marked equivalent (the invariant and the inputs tried), or the line removed (why).

## Checklist

- [ ] `npx tsc -b`, `npx prettier --check .`, `npm run arch`: green.
- [ ] `npx cucumber-js --profile replay tools/runtime/features features/arch features/descriptive`: green; give the counts. (With a formatter that does not write the report of the gate.)
