// A hosted job captures only the locations that its initial aos admission supplied.
// Each later step keeps its own credentials and must present the same job identity.
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
import { hasAdmittedRun, runLocations } from '../../packages/sandbox/src/runtime-context.ts';
import { checkPrivateDirectory } from '../../packages/sandbox/src/state-journal.ts';
import { controlledNpmNames } from './src/domain/npm-settings.ts';
const env = process.env;
function refuse() {
  throw new Error('invalid hosted Gate allocation');
}
function main() {
  const root = env.ARCHITECT_OS_RUNTIME_ROOT;
  if (!root || root !== join(realpathSync(env.RUNNER_TEMP), 'a') || realpathSync(root) !== root) refuse();
  const identity = [
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_JOB',
    'GITHUB_SHA',
    'AOS_GATE_JOB',
  ].map((key) => env[key]);
  if (!identity.every(Boolean)) refuse();
  const [action, ...args] = process.argv.slice(2);
  const state = join(root, 'state');
  checkPrivateDirectory(state, lstatSync(root, { bigint: true }).dev);
  const path = join(state, 'gate-job.json');
  const keys = [
    'ARCHITECT_OS_RUNTIME_ROOT',
    'ARCHITECT_OS_RUN_DIR',
    'ARCHITECT_OS_ADMISSION_BINDING',
    'ARCHITECT_OS_HOST_XDG_CONFIG_HOME',
    ...Object.keys(runLocations(root, '')),
  ];
  if (action === 'capture' && !args.length) {
    if (
      !hasAdmittedRun(env) ||
      !env.GITHUB_OUTPUT ||
      readFileSync(join(root, '.architect-os-runtime-root'), 'utf8') !==
        'architect-os-runtime-root/v2\nenvironment=hosted-runner\n'
    )
      refuse();
    const context = Object.fromEntries(keys.map((key) => [key, env[key]]));
    const reports = join(env.ARCHITECT_OS_RUN_DIR, 'reports');
    mkdirSync(reports, { mode: 0o700, recursive: true });
    checkPrivateDirectory(reports, lstatSync(root, { bigint: true }).dev);
    const bytes = JSON.stringify({ identity, context });
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 });
    appendFileSync(env.GITHUB_OUTPUT, 'context_sha=' + digest(bytes) + '\n');
    return;
  }
  if (action !== '--' || !args.length || args[0].startsWith('-')) refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let saved;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o400)
      refuse();
    const bytes = readFileSync(fd);
    if (digest(bytes) !== env.AOS_GATE_CONTEXT_SHA) refuse();
    saved = JSON.parse(bytes.toString('utf8'));
  } finally {
    closeSync(fd);
  }
  if (
    JSON.stringify(identity) !== JSON.stringify(saved.identity) ||
    saved.context.ARCHITECT_OS_RUNTIME_ROOT !== root ||
    !hasAdmittedRun(saved.context)
  )
    refuse();
  checkPrivateDirectory(
    join(saved.context.ARCHITECT_OS_RUN_DIR, 'reports'),
    lstatSync(root, { bigint: true }).dev,
  );
  const child = { ...env };
  delete child.AOS_GATE_CONTEXT_SHA;
  for (const key of controlledNpmNames(Object.keys(child))) delete child[key];
  for (const key of keys) child[key] = saved.context[key];
  // execve does not search PATH. The shell forwards each original argument literally.
  process.umask(0o077);
  process.execve('/bin/sh', ['sh', '-c', 'exec "$@"', 'gate-job', ...args], child);
}
try {
  main();
} catch {
  process.stderr.write('aos: GATE_JOB_ADMISSION_REQUIRED\n');
  process.exitCode = 2;
}
