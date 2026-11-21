import { loadConfiguration, loadSources } from '@cucumber/cucumber/api';

function uniqueLocations(locations: Iterable<string>): ReadonlySet<string> {
  const reported = [...locations];
  const unique = new Set(reported);
  if (unique.size !== reported.length) throw new Error('scénario de mutation répété');
  return unique;
}

/** Independently establish the full scenario universe before a static replay can use it. */
export async function mutationCatalog(root: string): Promise<ReadonlySet<string>> {
  const environment = { cwd: root };
  const { runConfiguration } = await loadConfiguration({ profiles: ['mutation'] }, environment);
  const { plan, errors } = await loadSources(runConfiguration.sources, environment);
  if (errors.length > 0 || plan.length === 0) throw new Error('profil de mutation incomplet ou illisible');
  return uniqueLocations(plan.map(({ uri, location }) => uri + ':' + location.line));
}

export async function verifyMutationCatalog(
  root: string,
  tests: ReadonlyMap<string, string>,
  catalog?: ReadonlySet<string>,
): Promise<void> {
  const expected = catalog ?? (await mutationCatalog(root));
  const actual = uniqueLocations(tests.values());
  const missing = [...expected].find((location) => !actual.has(location));
  const extra = [...actual].find((location) => !expected.has(location));
  if (missing !== undefined || extra !== undefined)
    throw new Error('catalogue des scénarios de mutation différent : ' + (missing ?? extra));
}
