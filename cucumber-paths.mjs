export const COMPONENTS = ['packages/*', 'data', 'gateway', 'services/*', 'modules/*', 'tools/*'];
const ROOT_AREAS = ['descriptive', 'infra', 'integration', 'sandbox'];
export const mutationPaths = [
  ...ROOT_AREAS.map((area) => `features/${area}/**/*.feature`),
  ...COMPONENTS.map((component) => `${component}/features/**/*.feature`),
];

// The pinned Cucumber runner accepts a path ordering. A static mutant can stop at its first failing witness.
// Prepend only globs already represented by the mutation profile, so Cucumber's path de-duplication keeps exactly the
// same scenarios even when no witness fails early. Keep exhaustive scope for survivors.
export function mutationFeaturesFor(sources) {
  const components = new Set();
  for (const file of sources) {
    const owner = file.match(
      /^((?:packages|services|modules|tools)\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*|data|gateway)\/(?:src|worker)\//,
    );
    if (owner !== null) components.add(owner[1] + '/features/**/*.feature');
  }
  return [...components, ...mutationPaths];
}
