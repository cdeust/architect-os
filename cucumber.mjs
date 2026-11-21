// Cucumber configuration. Options: node_modules/@cucumber/cucumber/lib/configuration/types.d.ts.
// tsx refuses to be a --loader (node_modules/tsx/dist/register-*.mjs), so it is registered here with its documented
// ESM API (node_modules/tsx/package.json exports './esm/api'); cucumber imports the support code after this file.
// tsx reads TSX_TSCONFIG_PATH: features/tsconfig.json carries the `paths` that map @architect-os/contracts to its sources.
import { register } from 'tsx/esm/api';
import { COMPONENTS, mutationPaths } from './cucumber-paths.mjs';

process.env['TSX_TSCONFIG_PATH'] ??= new URL('./features/tsconfig.json', import.meta.url).pathname;
register();

const config = {
  paths: ['features/**/*.feature', ...COMPONENTS.map((c) => `${c}/features/**/*.feature`)],
  import: [
    'features/support/**/*.ts',
    'features/steps/**/*.ts',
    ...COMPONENTS.map((c) => `${c}/features/steps/**/*.ts`),
  ],
  format: ['message:reports/cucumber.ndjson', 'progress'],
  retry: 0,
  strict: true,
};

export default config;

// The gate-macos job (docs/design/platform-v3-srt.md §7) runs features/sandbox only: `cucumber-js --profile macos`.
// A scope by path, not a filter: tools/test-gate/gate.json scopes the static count of the job identically.
export const macos = { ...config, paths: ['features/sandbox/**/*.feature'] };

// The mutation profile is used only by Stryker (stryker.config.mjs: cucumber.profile). It is a scope by area, and the
// two areas features/repository and features/arch are outside it as wholes. This comment is the one place that says
// why; every other file points here. Stryker runs the tests in a sandbox copy (.stryker-tmp/sandbox-*) of instrumented,
// unformatted sources. A feature that executes no production line in process can kill no mutant.
// - features/repository: two scenarios, each run in a child process (features/steps/repository.ts). The format check
//   (`prettier --check .`) fails on the copy by design: the instrumented sources are unformatted. The typecheck
//   (`tsc -b`) is not shown to fail on the copy; it kills no mutant because it executes no production line in process.
// - features/arch/guard: dependency-cruiser in a child process on zz-fixture-* files it writes into the tree; no
//   production line in process. Workers that collide on those files made it fail: the configuration runs one worker
//   (stryker.config.mjs), and the collision is what happened when it ran several and would happen again if raised.
// - features/arch/closed-git-environment-text: reads the text of three production files that Stryker instruments, so on
//   the copy it would judge another text; no production line in process.
// - features/arch/no-container-command: reads the text of the files git tracks or would track, outside Markdown, any
//   directory named results and the records of the steps, production sources included, so the same holds on the copy;
//   no production line in process.
// - features/arch/isolation-diagram: reads five profile files and two images, and calls one production function, the
//   loader of the profiles, which the mutation judges elsewhere (packages/sandbox/features/profile.feature). It is
//   outside only because its area is.
// - features/arch/runtime-entry: starts the shell entry `aos` as a host process, from a copy of the launcher whose
//   sources would be the instrumented ones on the copy; a child process executes no production line in process. The
//   decisions of the admission are judged in process by tools/runtime/features. It also reads the import specifiers of
//   tools/runtime/src as text, which on the copy would be another text.
// Both areas stay in the default profile (`npm test`, and the counted run of the gate's Linux job); the mutation
// profile lists the other four root areas, and the components' features.
// A scope by path, like `macos`: `features/**` is spelled as the root areas other than repository and arch;
// features/descriptive/cucumber-profiles.feature checks that no area is forgotten.
export const mutation = { ...config, paths: mutationPaths };

// The replay profile is used only by `test-gate replay` (tools/test-gate/src/infrastructure/replay.ts), which names the
// scenarios of one mutant as `<feature>:<line>` and its own `--format message:<file>`. Cucumber adds the paths and
// formats of the command line to those of the profile (lib/configuration/merge_configurations.js: ADDITIVE_ARRAYS), so
// this profile has none: with the default ones, a replay would run the whole suite and overwrite reports/cucumber.ndjson.
export const replay = { import: config.import, retry: 0, strict: true };

// The live profile is a command of the owner, `npm run broker:live`, never the gate nor `npm test`: its one scenario
// spends on the real upstream with the owner's test key (T-04R), and gate.yml holds no secret (platform-v3-srt.md §7).
// modules/broker/live is outside every path above, so no other profile counts it.
export const live = {
  ...config,
  paths: ['modules/broker/live/**/*.feature'],
  import: [...config.import, 'modules/broker/live/steps/**/*.ts'],
  format: ['progress'],
};
