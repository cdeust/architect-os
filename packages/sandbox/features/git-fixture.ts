import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

/** Git for setting up disposable scenario repositories, independent of the adapters being mutated. */
export function gitInFixture(directory: string, args: readonly string[]): string {
  return gitBytesInFixture(directory, args).toString('utf8');
}

/** The same Git, its output as the bytes Git wrote: a path that is not UTF-8 is not rewritten. */
export function gitBytesInFixture(directory: string, args: readonly string[], input?: Buffer): Buffer {
  return execFileSync('/usr/bin/git', args, {
    cwd: directory,
    ...(input === undefined ? {} : { input }),
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

/** Two independent ignore files. On Linux, lossy UTF-8 would give both parent directories the same name. */
export function commitDistinctIgnorePaths(directory: string): void {
  const prefix = Buffer.from(directory + '/');
  const opaque = process.platform === 'linux' ? Buffer.from([0xff]) : Buffer.from('ordinary');
  const paths = [
    { name: opaque, ignored: 'cache-a' },
    { name: Buffer.from('\uFFFD'), ignored: 'cache-b' },
  ];
  for (const { name, ignored } of paths) {
    const path = Buffer.concat([prefix, name]);
    mkdirSync(path);
    writeFileSync(Buffer.concat([path, Buffer.from('/.gitignore')]), ignored + '/\n');
    const cache = Buffer.concat([path, Buffer.from('/' + ignored)]);
    mkdirSync(cache);
    // A plain marker suffices: no repository program is installed or executed.
    writeFileSync(Buffer.concat([cache, Buffer.from('/.git')]), 'fixture\n');
  }
  gitInFixture(directory, ['add', '-A']);
  gitInFixture(directory, [
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'two distinct pathnames',
  ]);
}
