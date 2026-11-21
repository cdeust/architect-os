// A host entry checks the read-only binding issued by aos. It never admits or repairs a run.
// Like the installer marker this protects against mistakes and substituted paths; it is not a secret
// or an attestation against a process that already has arbitrary access as the same OS account.
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export function runLocations(root: string, run: string) {
  return {
    TMPDIR: join(run, 'tmp'),
    TMP: join(run, 'tmp'),
    TEMP: join(run, 'tmp'),
    XDG_CONFIG_HOME: join(run, 'config'),
    XDG_DATA_HOME: join(run, 'data'),
    XDG_STATE_HOME: join(run, 'state'),
    XDG_CACHE_HOME: join(root, 'cache/xdg'),
    NODE_COMPILE_CACHE: join(root, 'cache/node'),
    npm_config_cache: join(root, 'cache/npm'),
    npm_config_logs_dir: join(run, 'npm-logs'),
    npm_config_userconfig: join(run, 'config/npm/user.npmrc'),
    npm_config_globalconfig: join(run, 'config/npm/global.npmrc'),
  };
}

/**
 * Verify only the expected bytes. The bootstrap gave those bytes to its child, so the allocation is bounded
 * by the actual inherited environment, irrespective of how large a substituted file reports itself to be.
 */
function matchesFile(path: string, device: bigint, expected: Buffer, privateFile: boolean) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd, { bigint: true });
    if (
      !st.isFile() ||
      st.dev !== device ||
      (privateFile && st.nlink !== 1n) ||
      st.size !== BigInt(expected.length)
    )
      return false;
    const observed = Buffer.alloc(expected.length);
    let offset = 0;
    while (offset < observed.length) {
      const n = readSync(fd, observed, offset, observed.length - offset, null);
      if (n === 0) return false;
      offset += n;
    }
    return observed.equals(expected) && readSync(fd, Buffer.alloc(1)) === 0;
  } finally {
    closeSync(fd);
  }
}

export function hasAdmittedRun(env: Readonly<NodeJS.ProcessEnv>): boolean {
  try {
    const root = env.ARCHITECT_OS_RUNTIME_ROOT!,
      run = env.ARCHITECT_OS_RUN_DIR!;
    const name = basename(run);
    if (
      !/^r[A-Za-z0-9]{6}$/.test(name) ||
      run !== join(root, 'run', name) ||
      root === '/' ||
      realpathSync(root) !== root ||
      realpathSync(run) !== run
    )
      return false;
    const rootStat = statSync(root, { bigint: true }),
      runStat = statSync(run, { bigint: true });
    const binding = env.ARCHITECT_OS_ADMISSION_BINDING!;
    const [, , encoded] = binding.split(':');
    const bytes = Buffer.from(encoded!, 'base64url');
    if (binding !== [runStat.dev, runStat.ino, bytes.toString('base64url')].join(':')) return false;
    const receipt = JSON.parse(bytes.toString('utf8'));
    if (
      receipt.schema !== 'architect-os-runtime-receipt/v1' ||
      receipt.run !== name ||
      receipt.observations.root.device !== String(rootStat.dev) ||
      receipt.observations.root.inode !== String(rootStat.ino) ||
      !matchesFile(join(run, 'admission.json'), rootStat.dev, bytes, true) ||
      !matchesFile(
        join(root, '.architect-os-runtime-root'),
        rootStat.dev,
        Buffer.from('architect-os-runtime-root/v2\nenvironment=' + receipt.environment + '\n'),
        false,
      )
    )
      return false;
    const identity = env.ARCHITECT_OS_HOST_XDG_CONFIG_HOME!;
    if (identity !== 'unset' && !identity.startsWith('set:')) return false;
    const locations = runLocations(root, run);
    for (const [key, value] of Object.entries(locations)) {
      if (env[key] !== value || realpathSync(value) !== value) return false;
      const stat = statSync(value, { bigint: true });
      if (stat.dev !== rootStat.dev) return false;
      if (key === 'npm_config_userconfig' || key === 'npm_config_globalconfig') {
        if (!stat.isFile() || stat.nlink !== 1n || stat.size !== 0n) return false;
      } else if (!stat.isDirectory()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function requireAdmittedRun(): void {
  if (!hasAdmittedRun(process.env)) {
    process.stderr.write('aos: RUNTIME_ENTRY_REQUIRED\n');
    process.exit(2);
  }
}
