import { loadConfiguration, loadSources, runCucumber, type IRunEnvironment } from '@cucumber/cucumber/api';

const cucumber = { loadConfiguration, loadSources, runCucumber };

export async function runReplayCucumber(
  args: readonly string[],
  stderr: { write(text: string): unknown },
  environment: IRunEnvironment = {},
  engine = cucumber,
): Promise<number> {
  const refuse = (issue: string) => {
    stderr.write('AOS_REPLAY_SELECTION: ' + issue + '\n');
    return 2;
  };
  const [profile, report, ...locations] = args;
  if (!profile || !report || locations.length === 0) return refuse('arguments de rejeu invalides');
  const prepared = await (async () => {
    const { runConfiguration } = await engine.loadConfiguration(
      {
        profiles: [profile],
        provided: { paths: locations, format: ['message:' + report] },
      },
      environment,
    );
    if (runConfiguration.sources.shard || (runConfiguration.plugins?.specifiers.length ?? 0) !== 0)
      return null;
    const sources = await engine.loadSources(runConfiguration.sources, environment);
    return { runConfiguration, ...sources };
  })().catch(() => undefined);
  if (prepared === undefined) return refuse('précontrôle Cucumber impossible');
  if (prepared === null) return refuse('profil de rejeu invalide');

  const { plan, errors, runConfiguration } = prepared;
  const expected = new Set(locations);
  const actual = new Set(plan.map(({ uri, location }) => uri + ':' + location.line));
  const extra = [...actual].find((location) => !expected.has(location));
  const missing = [...expected].find((location) => !actual.has(location));
  if (errors.length !== 0) return refuse('sources de rejeu illisibles');
  if (extra !== undefined) return refuse('scénario de rejeu inattendu : ' + extra);
  if (missing !== undefined) return refuse('scénario de rejeu manquant : ' + missing);
  if (actual.size !== plan.length) return refuse('scénario de rejeu répété');
  const { retry, dryRun, failFast, parallel } = runConfiguration.runtime;
  if (retry !== 0 || dryRun || failFast || parallel !== 0) return refuse('profil de rejeu invalide');

  stderr.write('AOS_REPLAY_PLAN_VALID\n');
  const { success } = await engine.runCucumber(runConfiguration, environment);
  return success ? 0 : 1;
}
