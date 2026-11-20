import { loadConfiguration, loadSources, runCucumber } from '@cucumber/cucumber/api';

function refuse(issue: string): never {
  process.stderr.write('AOS_REPLAY_SELECTION: ' + issue + '\n');
  process.exit(2);
}

// Resolve the effective paths and filters before running any support steps.
const [, , profile, report, ...locations] = process.argv;
if (!profile || !report || locations.length === 0) refuse('arguments de rejeu invalides');
const prepared = await (async () => {
  const { runConfiguration } = await loadConfiguration({
    profiles: [profile],
    provided: { paths: locations, format: ['message:' + report] },
  });
  if (runConfiguration.sources.shard || (runConfiguration.plugins?.specifiers.length ?? 0) !== 0) {
    refuse('profil de rejeu invalide');
  }
  const sources = await loadSources(runConfiguration.sources);
  return { runConfiguration, ...sources };
})().catch(() => refuse('précontrôle Cucumber impossible'));

const { plan, errors, runConfiguration } = prepared;
const expected = new Set(locations);
const actual = new Set(plan.map(({ uri, location }) => uri + ':' + location.line));
const extra = [...actual].find((location) => !expected.has(location));
const missing = [...expected].find((location) => !actual.has(location));
if (errors.length !== 0) refuse('sources de rejeu illisibles');
if (extra !== undefined) refuse('scénario de rejeu inattendu : ' + extra);
if (missing !== undefined) refuse('scénario de rejeu manquant : ' + missing);
if (actual.size !== plan.length) refuse('scénario de rejeu répété');
const { retry, dryRun, failFast, parallel } = runConfiguration.runtime;
if (retry !== 0 || dryRun || failFast || parallel !== 0) refuse('profil de rejeu invalide');

process.stderr.write('AOS_REPLAY_PLAN_VALID\n');
const { success } = await runCucumber(runConfiguration);
process.exitCode = success ? 0 : 1;
