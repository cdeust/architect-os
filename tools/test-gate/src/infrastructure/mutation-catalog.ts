import { loadConfiguration, loadSources } from '@cucumber/cucumber/api';

/** Independently establish the full scenario universe before a static replay can use it. */
export async function mutationCatalog(root: string): Promise<ReadonlySet<string>> {
  const environment = { cwd: root };
  const { runConfiguration } = await loadConfiguration({ profiles: ['mutation'] }, environment);
  const { plan, errors } = await loadSources(runConfiguration.sources, environment);
  if (errors.length > 0 || plan.length === 0) throw new Error('profil de mutation incomplet ou illisible');
  const expected = new Set(plan.map(({ uri, location }) => uri + ':' + location.line));
  if (expected.size !== plan.length) throw new Error('scénario de mutation répété');
  return expected;
}

export async function verifyMutationCatalog(
  root: string,
  tests: ReadonlyMap<string, string>,
  catalog?: ReadonlySet<string>,
): Promise<void> {
  const expected = catalog ?? (await mutationCatalog(root));
  const actual = new Set(tests.values());
  if (actual.size !== tests.size) throw new Error('scénario de mutation répété');
  const missing = [...expected].find((location) => !actual.has(location));
  const extra = [...actual].find((location) => !expected.has(location));
  if (missing !== undefined || extra !== undefined)
    throw new Error('catalogue des scénarios de mutation différent : ' + (missing ?? extra));
}
