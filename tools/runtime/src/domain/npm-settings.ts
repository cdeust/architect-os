// The settings of npm that the shell entry `aos` controls: the four locations it gives its command (`cache`, `logs-dir`,
// `userconfig`, `globalconfig`) and `node-options`, which npm turns into the NODE_OPTIONS of every lifecycle child
// (npm 11.20.0: node_modules/@npmcli/config/lib/set-envs.js, `env.NODE_OPTIONS = cliConf['node-options']`). npm reads
// a setting from any variable whose name starts with `npm_config_` in any case; the rest of the name, but a leading
// `_`, has its `_` turned into `-` and is put in lower case (node_modules/@npmcli/config/lib/index.js, `loadEnv`): two
// spellings, `NPM_CONFIG_LOGS_DIR` and `npm_config_logs-dir`, compete for one setting, and the last one npm reads wins.
// So `aos` removes every inherited spelling of these five, then gives the four locations one value each.

/** The settings of npm whose every inherited spelling is removed. */
export const CONTROLLED_NPM_SETTINGS = [
  'cache',
  'logs-dir',
  'userconfig',
  'globalconfig',
  'node-options',
] as const;

const PREFIX = /^npm_config_/i;

/** The setting of npm a variable name stands for, as npm reads it; none when the name does not start with its prefix. */
export function npmSettingOf(name: string): string | undefined {
  if (!PREFIX.test(name)) return undefined;
  const key = name.slice('npm_config_'.length);
  // A key that starts with `//` is the setting of a registry, which npm leaves as it is written.
  return key.startsWith('//') ? key : key.replace(/(?!^)_/g, '-').toLowerCase();
}

/** The names, among those of an environment, that npm reads as one of the controlled settings; in their order. */
export function controlledNpmNames(names: readonly string[]): string[] {
  return names.filter((name) =>
    (CONTROLLED_NPM_SETTINGS as readonly (string | undefined)[]).includes(npmSettingOf(name)),
  );
}
