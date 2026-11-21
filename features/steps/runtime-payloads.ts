import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectWorld } from '../support/world.js';
import { Given, ROOT, stored, Then, When } from './helpers.js';

interface PublicScripts {
  scripts: Record<string, string>;
  guard: string;
}

Given('the public scripts from {string}', function (manifest: string) {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8')) as Pick<
    PublicScripts,
    'scripts'
  >;
  assert.ok(Object.keys(scripts).length > 0);
  const path = manifest === 'bench/package.json' ? '../scripts/require-run.mjs' : 'scripts/require-run.mjs';
  this.state['payloadScripts'] = { scripts, guard: `node ${path} && ` };
});

function unguarded({ scripts, guard }: PublicScripts): string[] {
  return Object.keys(scripts).filter((name) => {
    const command = scripts[name]!;
    return !command.startsWith(guard) || command.slice(guard.length).trim() === '';
  });
}

Then('all public scripts run the admission guard before a payload', function () {
  assert.deepEqual(unguarded(stored<PublicScripts>(this, 'payloadScripts')), []);
});

Then('running every public script without admission stops at that guard', function () {
  const { scripts, guard } = stored<PublicScripts>(this, 'payloadScripts');
  const root = temporaryDirectory(this);
  const cwd = guard.includes('../scripts/') ? join(root, 'bench') : root;
  mkdirSync(cwd, { recursive: true });
  symlinkSync(join(ROOT, 'scripts'), join(root, 'scripts'), 'dir');
  for (const [name, command] of Object.entries(scripts)) {
    start(this, '/bin/sh', ['-c', command], cwd);
    assertRefusal(stored<SpawnSyncReturns<string>>(this, 'payloadResult'), name);
  }
});

When('a copy of script {string} loses its initial admission guard', function (script: string) {
  const { scripts, guard } = stored<PublicScripts>(this, 'payloadScripts');
  assert.ok(scripts[script]?.startsWith(guard));
  this.state['payloadScripts'] = {
    guard,
    scripts: { ...scripts, [script]: scripts[script]!.slice(guard.length) },
  };
});

Then('only public script {string} is reported as unguarded', function (script: string) {
  assert.deepEqual(unguarded(stored<PublicScripts>(this, 'payloadScripts')), [script]);
});

function temporaryDirectory(world: ArchitectWorld): string {
  const cwd = mkdtempSync(join(tmpdir(), 'runtime-payload-'));
  world.cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function start(world: ArchitectWorld, command: string, argv: string[], cwd: string): void {
  const result = spawnSync(command, argv, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'), HOME: cwd, TMPDIR: cwd },
  });
  assert.ifError(result.error);
  world.state['payloadResult'] = result;
}

When('the unadmitted process starts repository entry {string}', function (entry: string) {
  const argv = entry.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : [];
  start(this, process.execPath, [...argv, join(ROOT, entry)], temporaryDirectory(this));
});

function assertRefusal(result: SpawnSyncReturns<string>, entry: string): void {
  assert.deepEqual(
    { signal: result.signal, code: result.status, stdout: result.stdout, stderr: result.stderr },
    { signal: null, code: 2, stdout: '', stderr: 'aos: RUNTIME_ENTRY_REQUIRED\n' },
    entry,
  );
}

Then(
  'the repository entry refuses admission with exit 2, empty stdout and the exact diagnostic',
  function () {
    assertRefusal(stored<SpawnSyncReturns<string>>(this, 'payloadResult'), 'direct repository entry');
  },
);

const report = 'reports/gate-report.md';
const previousReport = 'existing verdict from the previous run\n';

Given('a previous Gate report in a disposable working directory', function () {
  const cwd = temporaryDirectory(this);
  mkdirSync(join(cwd, 'reports'));
  writeFileSync(join(cwd, report), previousReport);
  this.state['payloadWork'] = cwd;
});

When('the unadmitted process starts the real Gate shell script there', function () {
  start(this, '/bin/sh', [join(ROOT, 'tools/test-gate/gate.sh')], stored<string>(this, 'payloadWork'));
});

Then('the previous Gate report still has its original bytes', function () {
  assert.deepEqual(
    readFileSync(join(stored<string>(this, 'payloadWork'), report)),
    Buffer.from(previousReport),
  );
});
