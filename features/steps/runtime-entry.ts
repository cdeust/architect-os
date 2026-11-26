// The scenarios of features/arch/runtime-entry.feature: the shell entry `aos`, started as a host process from a copy of
// the launcher that holds only what the admission needs, with no node_modules and no dist. spawnSync and spawn:
// node_modules/@types/node/child_process.d.ts.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import type { ArchitectWorld } from '../support/world.js';
import { Given, ROOT, stored, Then, When } from './helpers.js';

const MARKER = '.architect-os-runtime-root';
const REPORT = 'reports/gate-report.md';
const REPORT_TEXT = 'a report of a previous gate\n';
const RUN_NAME = /^r[A-Za-z0-9]{6}$/;
/** What a copy of the launcher holds: the entry, the pin of Node, and the tool without its build. */
const LAUNCHER_FILES = [
  'aos',
  '.nvmrc',
  'tools/runtime/package.json',
  'tools/runtime/admission.json',
  'tools/runtime/node-locations',
  'tools/runtime/src',
];
const NODE_LOCATIONS = 'tools/runtime/node-locations';
const PIN = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
/** The locations the entry sets, and the inherited names it must remove. */
const LOCATIONS = [
  'ARCHITECT_OS_RUNTIME_ROOT',
  'ARCHITECT_OS_RUN_DIR',
  'TMPDIR',
  'TMP',
  'TEMP',
  'npm_config_cache',
  'npm_config_logs_dir',
  'npm_config_userconfig',
  'npm_config_globalconfig',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'NODE_COMPILE_CACHE',
];
/** The handover of the caller's XDG_CONFIG_HOME to the delivery: `set:<value>` or `unset`. */
const HANDED = 'ARCHITECT_OS_HOST_XDG_CONFIG_HOME';
const REMOVED = ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NODE_REDIRECT_WARNINGS'];
/** Spellings npm reads as one of the settings the launcher controls (npm 11.20.0, @npmcli/config, loadEnv). */
const NPM_SPELLINGS = [
  'NPM_CONFIG_CACHE',
  'Npm_Config_Cache',
  'npm_config_CACHE',
  'NPM_CONFIG_LOGS_DIR',
  'npm_config_logs-dir',
  'NPM_CONFIG_LOGS-DIR',
  'npm_config_USERCONFIG',
  'NPM_CONFIG_USERCONFIG',
  'npm_config_globalConfig',
  'NPM_CONFIG_GLOBALCONFIG',
  'npm_config_node_options',
  'NPM_CONFIG_NODE-OPTIONS',
  'npm_config_Node_Options',
];
/** Settings of npm, and a variable, that are not the launcher's: they reach the command as they were. */
const UNRELATED = {
  npm_config_update_notifier: 'false',
  npm_config_fund: 'false',
  NPM_CONFIG_LOGLEVEL: 'warn',
  ARCHITECT_OS_UNRELATED: 'kept',
};
const PROBE_STATUS = 5;
const PROBE = [
  "import { readFileSync } from 'node:fs';",
  `const names = ${JSON.stringify([...LOCATIONS, HANDED, ...REMOVED])};`,
  'const env = Object.fromEntries(names.map((name) => [name, process.env[name] ?? null]));',
  'const npm = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^npm_config_/i.test(name)));',
  "const unrelated = process.env['ARCHITECT_OS_UNRELATED'] ?? null;",
  "const stdin = readFileSync(0, 'utf8');",
  'process.stdout.write(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), stdin, env, npm, unrelated }));',
  `process.exitCode = ${PROBE_STATUS};`,
].join('\n');

interface Launcher {
  /** The copy of the launcher. */
  readonly copy: string;
  readonly spy: string;
  readonly work: string;
  /** The runtime root, marked by the Background. */
  readonly root: string;
  /** The setting given to the entry; none when the scenario gives none. */
  setting: string | undefined;
  /** The PATH given to the entry. */
  path: string;
  /** Inherited variables beyond PATH, HOME and the setting. */
  inherited: Record<string, string>;
  /** Inherited variables the scenario removes from the environment it starts the launcher with. */
  readonly unset: Set<string>;
  result?: SpawnSyncReturns<string>;
}

const launcher = (world: ArchitectWorld): Launcher => stored<Launcher>(world, 'launcher');
const unescape = (text: string): string => JSON.parse(`"${text.replaceAll('\n', '\\n')}"`) as string;
const list = (text: string): string[] => JSON.parse(`[${text}]`) as string[];

/** A directory for one scenario, removed after it, whose path holds a space and is its own real path. */
function scratch(world: ArchitectWorld, prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), `${prefix} `)));
  world.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Each directory from this one up to the root of the filesystem. */
function upwards(directory: string): string[] {
  const parent = dirname(directory);
  return parent === directory ? [directory] : [directory, ...upwards(parent)];
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? [path, ...walk(path)] : [path];
  });
}

Given('a copy of the launcher with no node_modules and no dist, at a path that holds a space', function () {
  const copy = scratch(this, 'launcher copy');
  for (const file of LAUNCHER_FILES) {
    cpSync(join(ROOT, file), join(copy, file), {
      recursive: true,
      filter: (source) => !/(^|\/)(node_modules|dist)(\/|$)/.test(relative(ROOT, source)),
    });
  }
  mkdirSync(join(copy, 'bench'));
  const names = walk(copy).map((path) => basename(path));
  assert.ok(
    !names.includes('node_modules') && !names.includes('dist'),
    'the copy holds no node_modules nor dist',
  );
  for (const directory of upwards(copy)) {
    assert.ok(!existsSync(join(directory, 'node_modules')), `no node_modules in ${directory} nor above it`);
  }
  // The floors of the copy: one byte, so that an admission does not depend on the free space of this machine.
  setFloors(copy, '1', '1');
  // The trusted location of the copy: one directory, whose node is the Node of this suite.
  const trusted = scratch(this, 'trusted bin');
  symlinkSync(process.execPath, join(trusted, 'node'));
  writeFileSync(join(copy, NODE_LOCATIONS), `${trusted}\n`);
  this.state['launcherCopy'] = copy;
});

function setFloors(copy: string, root: string, home: string): void {
  const file = join(copy, 'tools/runtime/admission.json');
  const policy = JSON.parse(readFileSync(file, 'utf8')) as {
    environments: Record<string, Record<string, string>>;
  };
  for (const reserve of Object.values(policy.environments)) {
    reserve['rootFloorBytes'] = root;
    reserve['homeFloorBytes'] = home;
  }
  writeFileSync(file, JSON.stringify(policy));
}

Given('a spy npm on the PATH of the launcher', function () {
  const spy = scratch(this, 'spy bin');
  for (const program of ['npm', 'npx']) {
    writeFileSync(join(spy, program), `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(spy, 'entered')}'\n`, {
      mode: 0o755,
    });
  }
  this.state['spy'] = spy;
});

Given('a working directory of the launcher that holds an existing report', function () {
  const work = scratch(this, 'work dir');
  mkdirSync(join(work, 'reports'));
  writeFileSync(join(work, REPORT), REPORT_TEXT);
  writeFileSync(join(work, 'probe.mjs'), PROBE);
  this.state['work'] = work;
});

Given('a runtime root for the launcher marked {string}', function (marker: string) {
  const root = scratch(this, 'runtime root');
  writeFileSync(join(root, MARKER), unescape(marker));
  const launcherState: Launcher = {
    copy: stored<string>(this, 'launcherCopy'),
    spy: stored<string>(this, 'spy'),
    work: stored<string>(this, 'work'),
    root,
    setting: root,
    path: [stored<string>(this, 'spy'), dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    inherited: {},
    unset: new Set(),
  };
  this.state['launcher'] = launcherState;
});

Given('the launcher is given no runtime root setting', function () {
  launcher(this).setting = undefined;
});

Given('the launcher is given the runtime root setting {string}', function (setting: string) {
  launcher(this).setting = setting;
});

Given('the launcher is given a runtime root setting below a directory that does not exist', function () {
  launcher(this).setting = join(launcher(this).root, 'gone', 'aos');
});

Given('the launcher is given its runtime root through a symbolic link', function () {
  const link = join(scratch(this, 'link to the root'), 'root');
  symlinkSync(launcher(this).root, link);
  launcher(this).setting = link;
});

Given('the runtime root of the launcher loses its marker', function () {
  rmSync(join(launcher(this).root, MARKER));
});

Given('the runtime root of the launcher is marked {string}', function (marker: string) {
  writeFileSync(join(launcher(this).root, MARKER), unescape(marker));
});

Given(
  'the policy of the launcher copy has the root floor {string} and the home floor {string}',
  function (root: string, home: string) {
    setFloors(launcher(this).copy, root, home);
  },
);

Given('no trusted location of the launcher copy holds a node', function () {
  writeFileSync(join(launcher(this).copy, NODE_LOCATIONS), `${scratch(this, 'empty bin')}\n`);
});

Given(
  'the first trusted location of the launcher copy holds a node that reports {string}',
  function (version: string) {
    const bin = scratch(this, 'other node');
    writeFileSync(join(bin, 'node'), `#!/bin/sh\necho '${version}'\n`, { mode: 0o755 });
    const list = join(launcher(this).copy, NODE_LOCATIONS);
    writeFileSync(list, `${bin}\n${readFileSync(list, 'utf8')}`);
  },
);

Given(
  'the list of trusted Node locations of the launcher copy names {string} first',
  function (location: string) {
    const list = join(launcher(this).copy, NODE_LOCATIONS);
    writeFileSync(list, `${location}\n${readFileSync(list, 'utf8')}`);
  },
);

Given(
  'the PATH of the launcher finds first a node that reports the pinned version and records each time it is entered',
  function () {
    const bin = scratch(this, 'caller node');
    const witness = join(bin, 'entered');
    writeFileSync(join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${witness}'\necho 'v${PIN}'\n`, {
      mode: 0o755,
    });
    launcher(this).path = [bin, launcher(this).path].join(':');
    this.state['callerNode'] = witness;
  },
);

Given(
  'the PATH of the launcher holds a program named {string} that prints its arguments',
  function (name: string) {
    const bin = scratch(this, 'odd bin');
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$@"\n`, { mode: 0o755 });
    launcher(this).path = [bin, launcher(this).path].join(':');
    this.state['oddBin'] = bin;
  },
);

Given('the policy decoder of the launcher copy throws an error nobody foresaw', function () {
  writeFileSync(
    join(launcher(this).copy, 'tools/runtime/src/infrastructure/policy-file.ts'),
    "export function decodePolicy(): never {\n  throw new Error('a decoder that fails as nobody foresaw');\n}\n",
  );
});

Given('the launcher copy has lost tools\\/runtime\\/src\\/cli.ts', function () {
  rmSync(join(launcher(this).copy, 'tools/runtime/src/cli.ts'));
});

Given(
  'the launcher inherits conflicting locations, a NODE_OPTIONS that would stop any node, and a coverage output',
  function () {
    const { work } = launcher(this);
    const elsewhere = join(work, 'elsewhere');
    launcher(this).inherited = {
      ...Object.fromEntries(
        LOCATIONS.filter((name) => name !== 'ARCHITECT_OS_RUNTIME_ROOT').map((name) => [name, elsewhere]),
      ),
      ...Object.fromEntries(NPM_SPELLINGS.map((name) => [name, elsewhere])),
      [HANDED]: 'set:/a/forged/handover',
      NODE_OPTIONS: `--require=${join(work, 'no such hook.cjs')}`,
      NODE_V8_COVERAGE: join(work, 'coverage'),
      NODE_REDIRECT_WARNINGS: join(work, 'warnings.txt'),
    };
  },
);

/** The closed environment an entry is started with: PATH, HOME, the setting, and what the scenario makes it inherit. */
function environment(world: ArchitectWorld): Record<string, string> {
  const state = launcher(world);
  const env: Record<string, string> = { PATH: state.path, HOME: userInfo().homedir, ...state.inherited };
  if (state.setting !== undefined) env['ARCHITECT_OS_RUNTIME_ROOT'] = state.setting;
  for (const name of state.unset) delete env[name];
  return env;
}

/** Starts an entry with the closed environment of the scenario. */
function start(
  world: ArchitectWorld,
  entry: string,
  args: readonly string[],
  cwd: string,
  input = '',
  timeout = 20_000,
): void {
  launcher(world).result = spawnSync(entry, args, {
    cwd,
    env: environment(world),
    input,
    encoding: 'utf8',
    timeout,
  });
}

When('the launcher copy runs {string} from the working directory', function (command: string) {
  start(this, join(launcher(this).copy, 'aos'), ['--', ...command.split(' ')], launcher(this).work);
});

When(
  'the committed launcher of this checkout runs {string} from the working directory',
  function (command: string) {
    start(this, join(ROOT, 'aos'), ['--', ...command.split(' ')], launcher(this).work);
  },
);

When(
  'the launcher copy runs {} with the argument {string} from the working directory',
  function (program: string, argument: string) {
    const programs: Record<string, string> = {
      'the spy npx': 'npx',
      node: 'node',
      'the Node of the suite': process.execPath,
    };
    const named = programs[program];
    assert.ok(named !== undefined, `no such program in these scenarios: ${program}`);
    start(this, join(launcher(this).copy, 'aos'), ['--', named, argument], launcher(this).work);
  },
);

When('the launcher copy runs with the arguments {} from the working directory', function (args: string) {
  start(this, join(launcher(this).copy, 'aos'), list(args), launcher(this).work);
});

When(
  'the launcher copy runs the program named {string} by its path, with the arguments {}',
  function (name: string, args: string) {
    const program = join(stored<string>(this, 'oddBin'), name);
    start(this, join(launcher(this).copy, 'aos'), ['--', program, ...list(args)], launcher(this).work);
  },
);

When(
  'the launcher copy runs the probe with the arguments {string}, {string} and {string} and the stdin {string} from the working directory',
  function (first: string, second: string, third: string, stdin: string) {
    const { copy, work } = launcher(this);
    start(
      this,
      join(copy, 'aos'),
      ['--', process.execPath, 'probe.mjs', first, second, third],
      work,
      unescape(stdin),
    );
  },
);

When(
  'the probe is run through {string} from the directory {string} of the launcher copy',
  function (entry: string, directory: string) {
    const { copy, work } = launcher(this);
    start(this, entry, ['--', process.execPath, join(work, 'probe.mjs')], join(copy, directory));
  },
);

const result = (world: ArchitectWorld): SpawnSyncReturns<string> => {
  const outcome = launcher(world).result;
  assert.ok(outcome !== undefined, 'the launcher ran');
  assert.equal(outcome.error, undefined);
  return outcome;
};

Then('the launcher exits {int} with {string} alone on stderr', function (status: number, line: string) {
  const outcome = result(this);
  assert.deepEqual(
    { status: outcome.status, stderr: outcome.stderr, stdout: outcome.stdout },
    { status, stderr: `${line}\n`, stdout: '' },
  );
});

Then('the launcher exits {int}, its stderr ending with {string}', function (status: number, line: string) {
  const outcome = result(this);
  assert.equal(outcome.status, status);
  assert.ok(outcome.stderr.endsWith(`${line}\n`), outcome.stderr);
  assert.equal(outcome.stdout, '');
});

Then('the launcher exits {int}', function (status: number) {
  const outcome = result(this);
  assert.equal(outcome.status, status, outcome.stderr);
});

Then('the spy npm was never entered', function () {
  assert.equal(existsSync(join(launcher(this).spy, 'entered')), false);
});

Then('the spy npm was entered with the arguments {}', function (args: string) {
  assert.equal(
    readFileSync(join(launcher(this).spy, 'entered'), 'utf8'),
    list(args)
      .map((arg) => `${arg}\n`)
      .join(''),
  );
});

Then('the existing report of the working directory is unchanged', function () {
  assert.equal(readFileSync(join(launcher(this).work, REPORT), 'utf8'), REPORT_TEXT);
});

Then('nothing was written under the runtime root of the launcher', function () {
  const { root } = launcher(this);
  assert.deepEqual(
    readdirSync(root).filter((name) => name !== MARKER),
    [],
  );
  assert.equal(existsSync(join(root, 'gone')), false);
});

Then('the launcher exits with the status of the probe, {int}', function (status: number) {
  const outcome = result(this);
  assert.equal(outcome.status, status, outcome.stderr);
  assert.equal(status, PROBE_STATUS);
  this.state['probe'] = JSON.parse(outcome.stdout) as unknown;
});

interface Probe {
  cwd: string;
  argv: string[];
  stdin: string;
  env: Record<string, string | null>;
  npm: Record<string, string>;
  unrelated: string | null;
}

const probe = (world: ArchitectWorld): Probe => stored<Probe>(world, 'probe');

Then('the probe saw the working directory, the three arguments and the stdin unchanged', function () {
  const seen = probe(this);
  assert.equal(seen.cwd, launcher(this).work);
  assert.deepEqual(seen.argv, ['a b', '', '-c']);
  assert.equal(seen.stdin, 'question\nline 2');
});

Then(
  'the probe saw exactly the locations of one new run under the runtime root, and no NODE_OPTIONS nor coverage output',
  function () {
    const { root } = launcher(this);
    const runs = readdirSync(join(root, 'run'));
    assert.equal(runs.length, 1);
    const [id] = runs as [string];
    assert.match(id, RUN_NAME);
    const run = join(root, 'run', id);
    const { [HANDED]: _handed, ...seen } = probe(this).env;
    assert.deepEqual(seen, {
      ARCHITECT_OS_RUNTIME_ROOT: root,
      ARCHITECT_OS_RUN_DIR: run,
      TMPDIR: join(run, 'tmp'),
      TMP: join(run, 'tmp'),
      TEMP: join(run, 'tmp'),
      npm_config_cache: join(root, 'cache/npm'),
      npm_config_logs_dir: join(run, 'npm-logs'),
      npm_config_userconfig: join(run, 'config/npm/user.npmrc'),
      npm_config_globalconfig: join(run, 'config/npm/global.npmrc'),
      XDG_CONFIG_HOME: join(run, 'config'),
      XDG_DATA_HOME: join(run, 'data'),
      XDG_STATE_HOME: join(run, 'state'),
      XDG_CACHE_HOME: join(root, 'cache/xdg'),
      NODE_COMPILE_CACHE: join(root, 'cache/node'),
      ...Object.fromEntries(REMOVED.map((name) => [name, null])),
    });
    assert.deepEqual(probe(this).npm, {
      npm_config_cache: join(root, 'cache/npm'),
      npm_config_logs_dir: join(run, 'npm-logs'),
      npm_config_userconfig: join(run, 'config/npm/user.npmrc'),
      npm_config_globalconfig: join(run, 'config/npm/global.npmrc'),
    });
    this.state['probeRun'] = run;
  },
);

Then(
  'the probe saw the XDG_CONFIG_HOME of the caller handed over, not the one the launcher inherited under that name',
  function () {
    assert.equal(probe(this).env[HANDED], `set:${join(launcher(this).work, 'elsewhere')}`);
  },
);

Then('the probe saw the handed-over XDG_CONFIG_HOME {string}', function (handed: string) {
  assert.equal(probe(this).env[HANDED], handed);
});

Then('the run of the probe holds its directories, two empty npm configurations and a receipt', function () {
  const run = stored<string>(this, 'probeRun');
  assert.deepEqual(
    walk(run)
      .map((path) => relative(run, path))
      .sort(),
    [
      'admission.json',
      'config',
      'config/npm',
      'config/npm/global.npmrc',
      'config/npm/user.npmrc',
      'data',
      'npm-logs',
      'state',
      'tmp',
    ],
  );
  assert.equal(readFileSync(join(run, 'config/npm/user.npmrc'), 'utf8'), '');
  assert.equal(readFileSync(join(run, 'config/npm/global.npmrc'), 'utf8'), '');
  for (const shared of ['cache/npm', 'cache/xdg', 'cache/node', 'state']) {
    assert.ok(existsSync(join(launcher(this).root, shared)), shared);
  }
});

Then(
  'the receipt of the run of the probe names {string} and the command kind {string}, and holds no argument, no stdin, no path and no inherited value',
  function (environment: string, kind: string) {
    const run = stored<string>(this, 'probeRun');
    const text = readFileSync(join(run, 'admission.json'), 'utf8');
    const receipt = JSON.parse(text) as {
      environment: string;
      run: string;
      floors: unknown;
      command: string;
    };
    assert.equal(receipt.environment, environment);
    assert.equal(receipt.command, kind);
    assert.equal(receipt.run, basename(run));
    assert.deepEqual(receipt.floors, { rootBytes: '1', homeBytes: '1' });
    const { root, work } = launcher(this);
    for (const absent of [
      'a b',
      '-c',
      'question',
      'line 2',
      'elsewhere',
      'NODE_OPTIONS',
      'probe.mjs',
      process.execPath,
      root,
      work,
      userInfo().homedir,
    ]) {
      assert.ok(!text.includes(absent), `the receipt holds ${JSON.stringify(absent)}`);
    }
  },
);

Then('the working directory holds no coverage output and no redirected warnings', function () {
  const { work } = launcher(this);
  assert.equal(existsSync(join(work, 'coverage')), false);
  assert.equal(existsSync(join(work, 'warnings.txt')), false);
  assert.equal(existsSync(join(work, 'elsewhere')), false);
});

Then(
  'the probe saw the directory {string} of the launcher copy as its working directory',
  function (directory: string) {
    assert.equal(probe(this).cwd, join(launcher(this).copy, directory));
  },
);

/** The one run under the runtime root, and its receipt. */
function onlyReceipt(world: ArchitectWorld): { run: string; command: string } {
  const { root } = launcher(world);
  const runs = readdirSync(join(root, 'run'));
  assert.equal(runs.length, 1, runs.join(', '));
  return JSON.parse(readFileSync(join(root, 'run', runs[0] as string, 'admission.json'), 'utf8')) as {
    run: string;
    command: string;
  };
}

Then(
  'the receipt of the one run under the runtime root names the command kind {string}',
  function (kind: string) {
    assert.equal(result(this).status, 0, result(this).stderr);
    assert.equal(onlyReceipt(this).command, kind);
  },
);

Then("the node of the caller's PATH was never entered", function () {
  assert.equal(existsSync(stored<string>(this, 'callerNode')), false);
});

Then("the node of the caller's PATH was entered once, with the arguments {}", function (args: string) {
  assert.equal(readFileSync(stored<string>(this, 'callerNode'), 'utf8'), `${list(args).join(' ')}\n`);
});

Then('the program named {string} printed the arguments {}', function (_name: string, args: string) {
  assert.equal(
    result(this).stdout,
    list(args)
      .map((arg) => `${arg}\n`)
      .join(''),
  );
});

// The committed list of trusted Node locations.

const locationLines = (): string[] => {
  const text = readFileSync(join(ROOT, NODE_LOCATIONS), 'utf8');
  assert.ok(text.endsWith('\n'), 'the list ends with a line end');
  return text.slice(0, -1).split('\n');
};

Then(
  'each line of tools\\/runtime\\/node-locations is an absolute directory, given once, ending with a line end',
  function () {
    const lines = locationLines();
    assert.ok(lines.length > 0);
    assert.equal(new Set(lines).size, lines.length, 'each location once');
    for (const line of lines) {
      assert.match(line, /^\/[^\n]*[^/]$/, line);
      assert.ok(
        !line
          .split('/')
          .slice(1)
          .some((part) => ['', '.', '..'].includes(part)),
        line,
      );
    }
  },
);

Then(
  "each location of tools\\/runtime\\/node-locations in the runner's tool cache names the version of .nvmrc",
  function () {
    const cached = locationLines().filter((line) => line.includes('/hostedtoolcache/'));
    assert.ok(cached.length > 0, 'the runner has a location');
    for (const line of cached)
      assert.match(line, new RegExp(`/hostedtoolcache/node/${PIN.replaceAll('.', '\\.')}/`));
  },
);

// The umask of the admitted command.

When(
  'the launcher copy runs, from a caller with the umask 000, a command that creates a file in its temporary directory',
  function () {
    const { copy, work } = launcher(this);
    const before = join(work, 'made before the launcher');
    writeFileSync(
      join(work, 'create.mjs'),
      "import { writeFileSync } from 'node:fs';\nwriteFileSync(`${process.env.TMPDIR}/made`, 'x');\nprocess.stdout.write(`${process.env.TMPDIR}/made`);\n",
    );
    this.state['madeBefore'] = before;
    launcher(this).result = spawnSync(
      '/bin/sh',
      [
        '-c',
        'umask 000 && : > "$BEFORE" && exec "$0" "$@"',
        join(copy, 'aos'),
        '--',
        process.execPath,
        'create.mjs',
      ],
      { cwd: work, env: { ...environment(this), BEFORE: before }, encoding: 'utf8', timeout: 20_000 },
    );
  },
);

const modeOf = (path: string): string => (statSync(path).mode & 0o777).toString(8);

Then('the file the caller created before the launcher has the mode 666', function () {
  assert.equal(result(this).status, 0, result(this).stderr);
  assert.equal(modeOf(stored<string>(this, 'madeBefore')), '666');
});

Then('the file the admitted command created has the mode 600', function () {
  const made = result(this).stdout;
  assert.ok(made.startsWith(join(launcher(this).root, 'run')), made);
  assert.equal(modeOf(made), '600');
});

// Overlapping launches on a fresh root.

When(
  '{int} launches of the launcher copy start together on the runtime root, each running the probe',
  async function (count: number) {
    const { copy, work } = launcher(this);
    const env = environment(this);
    const launches = Array.from(
      { length: count },
      () =>
        new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
          const child = spawn(join(copy, 'aos'), ['--', process.execPath, 'probe.mjs'], {
            cwd: work,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
          child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
          child.on('close', (status) => resolve({ status, stdout, stderr }));
        }),
    );
    this.state['launches'] = await Promise.all(launches);
  },
);

Then(
  'each launch exits with the status of the probe, in its own run directly under the runtime root',
  function () {
    const launches = stored<{ status: number | null; stdout: string; stderr: string }[]>(this, 'launches');
    const { root } = launcher(this);
    const runs = launches.map(({ status, stdout, stderr }) => {
      assert.equal(status, PROBE_STATUS, stderr);
      const run = (JSON.parse(stdout) as Probe).env['ARCHITECT_OS_RUN_DIR'] as string;
      assert.equal(dirname(run), join(root, 'run'));
      return run;
    });
    assert.equal(new Set(runs).size, launches.length);
    assert.deepEqual(readdirSync(join(root, 'run')).sort(), runs.map((run) => basename(run)).sort());
    this.state['overlappingRuns'] = runs;
  },
);

Then('each of those runs holds a receipt that names it', function () {
  for (const run of stored<string[]>(this, 'overlappingRuns')) {
    const receipt = JSON.parse(readFileSync(join(run, 'admission.json'), 'utf8')) as { run: string };
    assert.equal(receipt.run, basename(run));
  }
});

// The settings of npm, through each shell.

Given(
  'the launcher inherits the npm settings of every spelling, and settings that are not its own',
  function () {
    const { work } = launcher(this);
    const elsewhere = join(work, 'elsewhere');
    launcher(this).inherited = {
      ...launcher(this).inherited,
      ...Object.fromEntries(
        NPM_SPELLINGS.map((name) => [
          name,
          /node.options/i.test(name) ? '--require=/no/such/hook.cjs' : elsewhere,
        ]),
      ),
      npm_config_cache: elsewhere,
      ...UNRELATED,
      HOME: scratch(this, 'npm home'),
    };
  },
);

Given('the PATH of the launcher finds the real npm of the Node of the suite', function () {
  launcher(this).path = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');
});

/** The runs under the runtime root. */
const runsOf = (world: ArchitectWorld): string[] => {
  const runs = join(launcher(world).root, 'run');
  return existsSync(runs) ? readdirSync(runs) : [];
};

/** Runs the launcher copy by a shell, as `<shell> <copy>/aos -- <args>`, and keeps the run it allocated. */
function byShell(
  world: ArchitectWorld,
  shell: string,
  args: readonly string[],
  cwd: string,
): SpawnSyncReturns<string> {
  const before = runsOf(world);
  start(world, shell, [join(launcher(world).copy, 'aos'), '--', ...args], cwd, '', 60_000);
  const outcome = result(world);
  assert.equal(outcome.status, args[0] === process.execPath ? PROBE_STATUS : 0, outcome.stderr);
  const made = runsOf(world).filter((name) => !before.includes(name));
  assert.equal(made.length, 1, 'one run for the launch');
  world.state['lastRun'] = join(launcher(world).root, 'run', made[0] as string);
  return outcome;
}

When('the launcher copy is run by {string} with the probe', function (shell: string) {
  const outcome = byShell(this, shell, [process.execPath, 'probe.mjs'], launcher(this).work);
  this.state['probe'] = JSON.parse(outcome.stdout) as unknown;
});

Then(
  "the probe saw, of the npm settings, only the four locations of its run and the settings that are not the launcher's",
  function () {
    const { root } = launcher(this);
    const run = probe(this).env['ARCHITECT_OS_RUN_DIR'] as string;
    assert.deepEqual(probe(this).npm, {
      npm_config_cache: join(root, 'cache/npm'),
      npm_config_logs_dir: join(run, 'npm-logs'),
      npm_config_userconfig: join(run, 'config/npm/user.npmrc'),
      npm_config_globalconfig: join(run, 'config/npm/global.npmrc'),
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
      NPM_CONFIG_LOGLEVEL: 'warn',
    });
    assert.equal(probe(this).unrelated, 'kept');
    assert.equal(probe(this).env['NODE_OPTIONS'], null);
  },
);

When('the launcher copy is run by {string} with {string}', function (shell: string, command: string) {
  this.state['npmOut'] = byShell(this, shell, command.split(' '), launcher(this).work).stdout;
});

Then('npm printed the four locations of its run and no node-options', function () {
  const { root } = launcher(this);
  const run = stored<string>(this, 'lastRun');
  assert.equal(
    stored<string>(this, 'npmOut'),
    [
      `cache=${join(root, 'cache/npm')}`,
      `logs-dir=${join(run, 'npm-logs')}`,
      `userconfig=${join(run, 'config/npm/user.npmrc')}`,
      `globalconfig=${join(run, 'config/npm/global.npmrc')}`,
      'node-options=null',
      '',
    ].join('\n'),
  );
});

When(
  'the launcher copy is run by {string} with {string} from a package whose script runs the probe',
  function (shell: string, command: string) {
    const { work } = launcher(this);
    writeFileSync(
      join(work, 'package.json'),
      JSON.stringify({ name: 'probe', private: true, scripts: { probe: 'node probe.mjs || true' } }),
    );
    const outcome = byShell(this, shell, command.split(' '), work);
    this.state['probe'] = JSON.parse(outcome.stdout) as unknown;
  },
);

Then(
  "the lifecycle child of npm saw no NODE_OPTIONS, and npm's cache and log locations of its run",
  function () {
    const { root } = launcher(this);
    const run = probe(this).env['ARCHITECT_OS_RUN_DIR'] as string;
    assert.equal(probe(this).env['NODE_OPTIONS'], null);
    assert.equal(probe(this).npm['npm_config_cache'], join(root, 'cache/npm'));
    assert.equal(probe(this).npm['npm_config_logs_dir'], join(run, 'npm-logs'));
    assert.equal(probe(this).npm['npm_config_userconfig'], join(run, 'config/npm/user.npmrc'));
    const spelled = Object.keys(probe(this).npm).filter((name) => NPM_SPELLINGS.includes(name));
    assert.deepEqual(spelled, []);
  },
);

// The delivery through the launcher (R1 of the decisions on the review of step 1a).

interface Delivery {
  readonly repository: string;
  readonly work: string;
  readonly bare: string;
  readonly hash: string;
  readonly home: string;
  readonly config: string;
  readonly answers: string;
  readonly identity: string;
  readonly gateWitness: string;
  readonly scripts: string;
  /** The configuration directory of the caller, when it has one of its own. */
  hostConfig?: string;
}

const delivery = (world: ArchitectWorld): Delivery => stored<Delivery>(world, 'delivery');

/** git for the fixture: a closed environment, no configuration of the machine. */
function fixtureGit(cwd: string, ...args: string[]): string {
  const finished = spawnSync(
    'git',
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        LC_ALL: 'C',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(finished.status, 0, `git ${args[0]}: ${finished.stderr}`);
  return finished.stdout;
}

/** The client of the forge of these scenarios: it answers only when it finds its identity where gh would look. */
const SCRIPTED_GH = [
  "import { appendFileSync, readFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  'const [answers, identity, ...args] = process.argv.slice(2);',
  "const names = Object.keys(process.env).filter((name) => name !== '__CF_USER_TEXT_ENCODING').sort();",
  "const xdg = process.env['XDG_CONFIG_HOME'];",
  'appendFileSync(`${answers}.calls`, `${JSON.stringify({ names, xdg: xdg ?? null })}\\n`);',
  "const directory = xdg ? join(xdg, 'gh') : join(process.env['HOME'] ?? '', '.config', 'gh');",
  "let hosts = '';",
  "try { hosts = readFileSync(join(directory, 'hosts.yml'), 'utf8'); } catch {}",
  "if (!hosts.includes(readFileSync(identity, 'utf8'))) process.exit(4);",
  "const planned = JSON.parse(readFileSync(answers, 'utf8'));",
  "const key = args.slice(1).join(' ');",
  'const answer = planned[key] ?? { exit: 1 };',
  "process.stdout.write(answer.stdout ?? '');",
  'process.exitCode = answer.exit ?? 0;',
].join('\n');

/** The gate of these scenarios: it records the XDG_CONFIG_HOME it sees and leaves the verdict of the commit. */
const SCRIPTED_GATE = [
  "import { appendFileSync } from 'node:fs';",
  'const [witness, sha, guard, publisher] = process.argv.slice(2);',
  "await import((await import('node:url')).pathToFileURL(guard).href);",
  "appendFileSync(witness, `${process.env['XDG_CONFIG_HOME'] ?? '(unset)'}\\n`);",
  'const { publishGateReceipt } = await import(publisher);',
  "const base = JSON.stringify({ job: 'linux', sha, count: 1, pickles: ['scenario'] });",
  "const report = '# Porte de test, job linux : VERTE\\n- tête : ' + sha + '\\n';",
  'publishGateReceipt(process.env.ARCHITECT_OS_RUNTIME_ROOT, process.cwd(), process.env.ARCHITECT_OS_RUN_DIR, sha, base, report);',
].join('\n');

/** The delivery command through its composition root, with the process aos made: its environment is not touched. */
const DRIVER = [
  "import { pathToFileURL } from 'node:url';",
  'const [main, config, gh, answers, identity] = process.argv.slice(2);',
  'const { deliverDependencies, runDeliver } = await import(pathToFileURL(main).href);',
  'process.exitCode = await runDeliver({',
  '  ...deliverDependencies(process),',
  "  argv: ['step', '--until', 'ci'],",
  '  gh: { program: process.execPath, prefix: [gh, answers, identity] },',
  '  config,',
  '  setTimer: (handler) => handler(),',
  '});',
].join('\n');

const REPO = 'cdeust/architect-os';

Given(
  'a throwaway repository for a delivery through the launcher, its commit ahead of both branches, and a scripted forge',
  function () {
    const repository = scratch(this, 'delivery repository');
    const bare = join(repository, 'remote.git');
    const work = join(repository, 'work');
    mkdirSync(bare);
    fixtureGit(bare, 'init', '--quiet', '--bare');
    mkdirSync(work);
    fixtureGit(work, 'init', '--quiet');
    fixtureGit(work, 'remote', 'add', 'origin', bare);
    writeFileSync(join(work, 'a.md'), 'a\n');
    fixtureGit(work, 'add', '--all');
    fixtureGit(work, 'commit', '--quiet', '--message', 'p0');
    for (const branch of ['feat/gate-1a', 'main'])
      fixtureGit(work, 'push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`);
    writeFileSync(join(work, '.gitignore'), 'reports/\n');
    fixtureGit(work, 'add', '--all');
    fixtureGit(work, 'commit', '--quiet', '--message', 'h1');
    const hash = fixtureGit(work, 'rev-parse', 'HEAD').trim();

    const scripts = scratch(this, 'delivery scripts');
    const home = scratch(this, 'delivery home');
    const answers = join(scripts, 'answers.json');
    const identity = join(scripts, 'identity');
    const gateWitness = join(scripts, 'gate saw');
    writeFileSync(join(scripts, 'gh.mjs'), SCRIPTED_GH);
    writeFileSync(join(scripts, 'gate.mjs'), SCRIPTED_GATE);
    writeFileSync(join(scripts, 'deliver.mjs'), DRIVER);
    writeFileSync(identity, `fixture-identity-${basename(scripts).replaceAll(' ', '-')}`);
    const committed = JSON.parse(readFileSync(join(ROOT, 'tools/deliver/deliver.json'), 'utf8')) as {
      workflow: string;
      requiredJobs: string[];
      jobDependencies?: Record<
        string,
        { producers: string[]; plannedProducers?: { prefix: string; suffixes: string[] } }
      >;
    };
    const required = new Set([
      ...committed.requiredJobs,
      ...Object.values(committed.jobDependencies ?? {}).flatMap(({ producers, plannedProducers }) => [
        ...producers,
        // The one lane a run always plans, the canary's.
        ...(plannedProducers?.suffixes ?? []).map((suffix) => plannedProducers?.prefix + '1' + suffix),
      ]),
    ]);
    const jobs = [...required].map((name, index) => ({
      id: index + 1,
      name,
      conclusion: 'success',
      runner_name: 'runner-1',
      steps: [{ conclusion: 'success' }],
    }));
    writeFileSync(
      answers,
      JSON.stringify({
        ['repos/' + REPO + '/actions/runs?head_sha=' + hash + '&per_page=100']: {
          stdout: JSON.stringify({
            workflow_runs: [
              { id: 42, name: committed.workflow, head_sha: hash, status: 'completed', run_attempt: 1 },
            ],
          }),
        },
        ['--paginate --slurp repos/' + REPO + '/actions/runs/42/attempts/1/jobs?per_page=100']: {
          stdout: JSON.stringify([{ total_count: jobs.length, jobs }]),
        },
      }),
    );
    const config = join(scripts, 'deliver.json');
    writeFileSync(
      config,
      JSON.stringify({
        ...committed,
        gateCommand: [
          process.execPath,
          join(scripts, 'gate.mjs'),
          gateWitness,
          hash,
          join(ROOT, 'scripts/require-run.mjs'),
          import.meta.resolve('@architect-os/sandbox/gate-receipt'),
        ],
      }),
    );
    const state: Delivery = {
      repository,
      work,
      bare,
      hash,
      home,
      config,
      answers,
      identity,
      gateWitness,
      scripts,
    };
    this.state['delivery'] = state;
  },
);

/** gh's file of identities, holding the identity of the scenario, in a configuration directory. */
function configureIdentity(directory: string, identity: string): void {
  mkdirSync(join(directory, 'gh'), { recursive: true });
  writeFileSync(
    join(directory, 'gh', 'hosts.yml'),
    `github.com:\n    oauth_token: ${readFileSync(identity, 'utf8')}\n    user: fixture\n`,
  );
}

Given('the identity of the scripted forge is configured {}', function (where: string) {
  const state = delivery(this);
  if (where === 'in a configuration directory of its own') {
    state.hostConfig = scratch(this, 'host config');
    configureIdentity(state.hostConfig, state.identity);
  } else {
    assert.equal(where, 'in the default configuration of its home');
    configureIdentity(join(state.home, '.config'), state.identity);
  }
});

Given('the launcher inherits {} and a forged handover of XDG_CONFIG_HOME', function (xdg: string) {
  const state = delivery(this);
  const inherited: Record<string, string> = { HOME: state.home, [HANDED]: 'set:/a/forged/handover' };
  if (xdg === 'the XDG_CONFIG_HOME of that directory')
    inherited['XDG_CONFIG_HOME'] = state.hostConfig as string;
  else if (xdg === 'an empty XDG_CONFIG_HOME') inherited['XDG_CONFIG_HOME'] = '';
  else assert.equal(xdg, 'no XDG_CONFIG_HOME');
  launcher(this).inherited = inherited;
});

When(
  'the launcher copy runs the delivery command with {string} from the throwaway worktree',
  function (argv: string) {
    assert.equal(argv, 'step --until ci');
    const state = delivery(this);
    const tsx = import.meta.resolve('tsx');
    start(
      this,
      join(launcher(this).copy, 'aos'),
      [
        '--',
        process.execPath,
        '--import',
        tsx,
        join(state.scripts, 'deliver.mjs'),
        join(ROOT, 'tools/deliver/src/main.ts'),
        state.config,
        join(state.scripts, 'gh.mjs'),
        state.answers,
        state.identity,
      ],
      state.work,
      '',
      120_000,
    );
  },
);

Then('the delivery through the launcher exits 0, ready', function () {
  const outcome = result(this);
  assert.equal(outcome.status, 0, outcome.stderr);
  const printed = JSON.parse(outcome.stdout) as { outcome: string; hash: string; published: unknown[] };
  assert.deepEqual([printed.outcome, printed.hash, printed.published], ['ready', delivery(this).hash, []]);
});

Then(
  'every call of the scripted forge through the launcher received exactly the names {string} and {}',
  function (names: string, forwarded: string) {
    const state = delivery(this);
    const calls = readFileSync(`${state.answers}.calls`, 'utf8')
      .split('\n')
      .slice(0, -1)
      .map((line) => JSON.parse(line) as { names: string[]; xdg: string | null });
    assert.ok(calls.length > 0);
    const expected: Record<string, string | null> = {
      'the XDG_CONFIG_HOME of that directory': state.hostConfig ?? 'none',
      'no XDG_CONFIG_HOME': null,
      'an empty XDG_CONFIG_HOME': '',
    };
    assert.ok(forwarded in expected, forwarded);
    for (const call of calls) assert.deepEqual(call, { names: names.split(' '), xdg: expected[forwarded] });
  },
);

Then('the gate of the delivery through the launcher saw the XDG_CONFIG_HOME of its run', function () {
  const { root } = launcher(this);
  const runs = readdirSync(join(root, 'run'));
  assert.equal(runs.length, 1);
  const [run] = runs;
  assert.equal(
    readFileSync(delivery(this).gateWitness, 'utf8'),
    `${join(root, 'run', run as string, 'config')}\n`,
  );
});

Then('no configuration nor identity of the forge was copied under the runtime root', function () {
  const { root } = launcher(this);
  const identity = readFileSync(delivery(this).identity, 'utf8');
  for (const path of walk(root)) {
    assert.notEqual(basename(path), 'hosts.yml', path);
    if (lstatSync(path).isFile()) assert.ok(!readFileSync(path, 'latin1').includes(identity), path);
  }
});

// The import check of the admission sources.

const SOURCES = join(ROOT, 'tools/runtime/src');
const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)\s(?:[^'"]*?\sfrom\s)?\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const LAUNCHERS = ['node:child_process', 'node:worker_threads', 'node:cluster'];

function specifiers(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map((match) => (match[1] ?? match[2]) as string);
}

/** The imports of each source that are neither a node: built-in other than a process launcher nor an existing #runtime module. */
function refused(sources: ReadonlyMap<string, string>): [string, string][] {
  return [...sources].flatMap(([file, text]) =>
    specifiers(text)
      .filter((specifier) => {
        if (specifier.startsWith('node:')) return LAUNCHERS.includes(specifier);
        const module = /^#runtime\/(.+)\.js$/.exec(specifier);
        return module === null || !sources.has(`${module[1]}.ts`);
      })
      .map((specifier): [string, string] => [file, specifier]),
  );
}

Given('the committed sources of tools\\/runtime\\/src', function () {
  const files = walk(SOURCES).filter((path) => path.endsWith('.ts'));
  this.state['admissionSources'] = new Map(
    files.map((path) => [relative(SOURCES, path), readFileSync(path, 'utf8')]),
  );
});

Then(
  'each import of the admission sources is a node: built-in other than a process launcher, or a #runtime module that exists',
  function () {
    const sources = stored<Map<string, string>>(this, 'admissionSources');
    assert.ok(sources.has('cli.ts') && sources.has('main.ts') && sources.has('application/admit.ts'));
    assert.ok(
      specifiers(sources.get('main.ts') as string).length >= 5,
      'the check reads the imports of main.ts',
    );
    assert.deepEqual(refused(sources), []);
  },
);

When(
  'the admission source {string} of that copy also imports {string}',
  function (file: string, specifier: string) {
    const sources = stored<Map<string, string>>(this, 'admissionSources');
    sources.set(file, `import { x } from '${specifier}';\n${sources.get(file) as string}`);
  },
);

Then(
  'the import check of the admission sources refuses only {string}, for {string}',
  function (file: string, specifier: string) {
    assert.deepEqual(refused(stored<Map<string, string>>(this, 'admissionSources')), [[file, specifier]]);
  },
);
