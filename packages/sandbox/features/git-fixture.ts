import { execFileSync } from 'node:child_process';

/** Git for setting up disposable scenario repositories, independent of the adapters being mutated. */
export function gitInFixture(directory: string, args: readonly string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      PATH: process.env['PATH'] ?? '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_ATTR_NOSYSTEM: '1',
      LC_ALL: 'C',
    },
  });
}
