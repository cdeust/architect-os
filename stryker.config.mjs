// Stryker configuration of the CI gate (docs/design/platform-v3-srt.md §7). Options:
// node_modules/@stryker-mutator/api/dist/src-generated/stryker-core.d.ts; cucumber runner options:
// node_modules/@stryker-mutator/cucumber-runner/dist/src-generated/cucumber-runner-options.d.ts.
// `mutate` comes from reports/gate-plan.json, written by `test-gate plan` (the perimeter of rule 5); a
// `--mutate` on the command line overrides it. The runner reads cucumber.mjs (profile `mutation`, below): every
// feature but features/repository and features/arch runs in the dry run; perTest coverage runs only the tests of a mutant.
import { existsSync, readFileSync } from 'node:fs';
import { mutationFeaturesFor } from './cucumber-paths.mjs';

const PLAN = 'reports/gate-plan.json';
const legacyPlan = existsSync(PLAN) ? JSON.parse(readFileSync(PLAN, 'utf8')) : { mutate: [] };
const native = process.env['AOS_NATIVE_MUTATION_LOTS'] === '1';
const inventory = native ? JSON.parse(readFileSync('reports/mutation-inventory.json', 'utf8')) : null;
const mutate =
  inventory === null ? legacyPlan.mutate : (inventory.patterns ?? inventory.lots.map(({ file }) => file));

export default {
  testRunner: 'cucumber',
  plugins: [
    '@stryker-mutator/cucumber-runner',
    ...(native ? ['./tools/test-gate/dist/src/infrastructure/stryker-lot-plugin.js'] : []),
  ],
  ignorers: native ? ['gate-native-lots'] : [],
  // The `mutation` profile of cucumber.mjs: the default profile minus features/repository and features/arch; the
  // reasons are written in cucumber.mjs, at the profile.
  // Option `cucumber.profile`: node_modules/@stryker-mutator/cucumber-runner/dist/src-generated/cucumber-runner-options.d.ts.
  cucumber: {
    profile: 'mutation',
    ...(inventory?.patterns === undefined
      ? {}
      : { features: mutationFeaturesFor(inventory.lots.map(({ file }) => file)) }),
  },
  coverageAnalysis: 'perTest',
  // One worker. The suite is not built to run in parallel: the workers share one sandbox and the machine (fixed ports of
  // the main.ts, files, PostgreSQL), so with several of them the status of a mutant depended on who collided with whom,
  // and the same commit gave different survivors from one run to the next. A verdict must be reproducible.
  concurrency: 1,
  // A fuse against a first run that never ends, not a way to manage the duration of the suite. It is set explicitly so
  // that the suite cannot outgrow a default (5 minutes) without anyone deciding. On 18 November 2026, with 2,896
  // scenarios, the initial run took 4 min 9 s to 4 min 49 s on the host (cucumber alone: 5 min 35 s) and the default
  // bound was reached silently. Journal §101.
  dryRunTimeoutMinutes: 20,
  mutate,
  reporters: ['json', 'clear-text', 'progress'],
  jsonReporter: { fileName: native ? 'reports/mutation/native.json' : 'reports/mutation/mutation.json' },
  thresholds: { high: 100, low: 100, break: null },
};
