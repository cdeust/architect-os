// The suite starts git from about twenty helpers, in throwaway repositories, with the environment this process
// inherited. A `GIT_DIR`, a `GIT_INDEX_FILE` or a `GIT_CONFIG_COUNT` in the environment of whoever ran the suite (a
// hook of git sets some of them, and so does a shell of a maintainer) would point those helpers at another repository
// or give them a configuration (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »).
// This file removes every variable whose name starts with `GIT_` from `process.env`, once, when the suite loads, so that
// no helper inherits one from the host. A helper that sets a `GIT_` variable for one scenario keeps doing so: it sets
// it after this file ran.

/** Removes from `env` every variable whose name starts with `GIT_`. */
export function removeGitVariables(env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) {
    if (name.startsWith('GIT_')) delete env[name];
  }
}

removeGitVariables(process.env);
