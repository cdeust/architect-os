import { runLocations } from '@architect-os/sandbox/runtime-context';

/** Pass only the launcher binding and its controlled paths to a closed host-command fixture. */
export function admittedEnvironment(): Record<string, string> {
  const keys = [
    'ARCHITECT_OS_RUNTIME_ROOT',
    'ARCHITECT_OS_RUN_DIR',
    'ARCHITECT_OS_ADMISSION_BINDING',
    'ARCHITECT_OS_HOST_XDG_CONFIG_HOME',
    ...Object.keys(runLocations('/', '/run')),
  ];
  return Object.fromEntries(
    keys.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
  );
}
