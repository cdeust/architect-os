import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NativeLaunchError,
  NativeLauncher,
  type NativeChild,
  type NativeProcess,
} from '../../src/native-launcher.js';
import type { Sandbox, SandboxExit, SandboxRunner } from '../../src/port.js';
import { killGroup } from '../../src/process-group.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';

// The boundary the design asks for, checked by the typecheck scenario: the day one of these two assignments
// compiles, tsc reports the unused directive. A native child is not a sandbox (it has no stop()), and the launcher is
// not a runner of the port.
// @ts-expect-error a native child must not be accepted where a sandbox is expected
export const notASandbox: Sandbox = undefined as unknown as NativeChild;
// @ts-expect-error the native launcher must not be accepted where a sandbox runner is expected
export const notARunner: SandboxRunner = undefined as unknown as NativeLauncher;

/** Real processes: `process.execPath` with `-e`, never a shell. Every one of them ends by itself within a minute. */
const BOUND = 'setTimeout(() => process.exit(9), 60000).unref();';
const node = (script: string): string[] => [process.execPath, '-e', `${BOUND}${script}`];

/** The kills a launcher scheduled: the scenario fires them at will, and sees which were cancelled. */
interface Scheduled {
  ms: number;
  fire: () => void;
  fired: boolean;
  cancelled: boolean;
}

function launcherOf(world: SandboxWorld, processes: Record<string, NativeProcess>, graceMs: number) {
  const scheduled: Scheduled[] = [];
  const logged: { name: string; text: string }[] = [];
  world.state['scheduled'] = scheduled;
  world.state['nativeLog'] = logged;
  return new NativeLauncher(processes, {
    graceMs,
    schedule: (fire, ms) => {
      const entry: Scheduled = { ms, fire, fired: false, cancelled: false };
      scheduled.push(entry);
      return () => void (entry.cancelled = true);
    },
    log: (name, text) => void logged.push({ name, text }),
  });
}

/** A throwaway working directory (its real path), removed at the end of the scenario. */
function folder(world: SandboxWorld): string {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'aos-native-')));
  world.cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

const declare = (world: SandboxWorld, name: string, command: string[], env = {}, graceMs = 1000) => {
  const cwd = folder(world);
  world.state['nativeCwd'] = cwd;
  world.state['launcher'] = launcherOf(world, { [name]: { cwd, command, env } }, graceMs);
};

const launcher = (world: SandboxWorld) => stored<NativeLauncher>(world, 'launcher');
const cwdOf = (world: SandboxWorld) => stored<string>(world, 'nativeCwd');
const childOf = (world: SandboxWorld) => stored<NativeChild>(world, 'nativeChild');
const scheduledOf = (world: SandboxWorld) => stored<Scheduled[]>(world, 'scheduled');

async function attempt(world: SandboxWorld, action: () => unknown): Promise<void> {
  try {
    await action();
    world.state['nativeRefusal'] = null;
  } catch (error) {
    world.state['nativeRefusal'] = error;
  }
}

async function start(world: SandboxWorld, name: string): Promise<NativeChild> {
  const child = await launcher(world).start(name);
  world.state['nativeChild'] = child;
  return child;
}

const readAll = async (child: NativeChild): Promise<string> => {
  let out = '';
  for await (const chunk of child.stdout) out += String(chunk);
  return out;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

Given(
  'a native launcher whose process {string} is node writing the marker file {string} in its working directory',
  function (name: string, marker: string) {
    declare(this, name, node(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`));
  },
);

const NAMES = 'Object.keys(process.env).filter((k) => k !== "__CF_USER_TEXT_ENCODING").sort().join(",")';

Given(
  'a native launcher whose process {string} is node printing {string} and the names of its environment, its declaration changed afterwards to print {string}, to hold the variable {string}, to run elsewhere, and to declare a process {string}',
  function (name: string, first: string, second: string, variable: string, added: string) {
    const print = (label: string) => `console.log(${JSON.stringify(label)} + ":" + ${NAMES} + process.cwd())`;
    const cwd = folder(this);
    const processes: Record<string, { cwd: string; command: string[]; env: Record<string, string> }> = {
      [name]: { cwd, command: node(print(first)), env: {} },
    };
    this.state['nativeCwd'] = cwd;
    this.state['launcher'] = launcherOf(this, processes, 1000);
    const declared = processes[name]!;
    declared.command[2] = `${BOUND}${print(second)}`;
    declared.env[variable] = '1';
    declared.cwd = folder(this);
    processes[added] = { cwd, command: node('0'), env: {} };
  },
);

Given('the host environment holds PATH and HOME', function () {
  assert.ok(process.env['PATH'] !== undefined && process.env['HOME'] !== undefined);
});

Given(
  'a native launcher whose process {string} is node printing the sorted names of its environment, declared with {string} and {string}',
  function (name: string, first: string, second: string) {
    // macOS adds __CF_USER_TEXT_ENCODING to every process at startup, whatever environment it was given.
    declare(this, name, node(`console.log(${NAMES})`), { [first]: '1', [second]: '2' });
  },
);

Given(
  'a native launcher whose process {string} is node printing its working directory',
  function (name: string) {
    declare(this, name, node('console.log(process.cwd())'));
  },
);

Given(
  'a native launcher whose process {string} is the executable {string}',
  function (name: string, path: string) {
    declare(this, name, [path]);
  },
);

Given(
  'a native launcher whose process {string} is node exiting with code {int}',
  function (name: string, code: number) {
    declare(this, name, node(`process.exit(${code})`));
  },
);

Given(
  'a native launcher whose process {string} is node killing itself with SIGTERM',
  function (name: string) {
    declare(this, name, node("process.kill(process.pid, 'SIGTERM'); setInterval(() => {}, 1000)"));
  },
);

Given(
  'a native launcher of grace {int} ms whose process {string} is node reading its stdin to the end',
  function (graceMs: number, name: string) {
    declare(this, name, node('process.stdin.resume()'), {}, graceMs);
  },
);

Given(
  'a native launcher of grace {int} ms whose process {string} is node writing {int} characters on its stderr, then reading its stdin to the end',
  function (graceMs: number, name: string, size: number) {
    declare(
      this,
      name,
      node(`process.stderr.write('\u20ac'.repeat(${size}));process.stdin.resume()`),
      {},
      graceMs,
    );
  },
);

Given(
  'a native launcher of grace {int} ms whose process {string} is node starting a grandchild, printing both pids, and ignoring the end of its input',
  function (graceMs: number, name: string) {
    declare(
      this,
      name,
      node(
        [
          "const { spawn } = require('node:child_process');",
          `const g = spawn(process.execPath, ['-e', ${JSON.stringify(`${BOUND}setInterval(() => {}, 1000)`)}], { stdio: 'ignore' });`,
          "g.once('spawn', () => console.log(process.pid + ' ' + g.pid));",
          'setInterval(() => {}, 1000);',
        ].join(' '),
      ),
      {},
      graceMs,
    );
  },
);

Given(
  'a native launcher whose process {string} is node closing its own input, saying so, then staying alive',
  function (name: string) {
    declare(
      this,
      name,
      node("require('node:fs').closeSync(0);console.log('closed');setInterval(()=>{},1000)"),
    );
  },
);

When('I try to start the native process {string}', async function (name: string) {
  await attempt(this, () => launcher(this).start(name));
});

When(
  'I build a native launcher declaring the process {string} in its own folder with the argv {string}',
  async function (name: string, argv: string) {
    const command = argv === '' ? [] : argv.split(' ');
    await attempt(this, () => launcherOf(this, { [name]: { cwd: folder(this), command, env: {} } }, 1000));
  },
);

When(
  'I build a native launcher declaring the process {string} in the folder {string} with node',
  async function (name: string, cwd: string) {
    await attempt(this, () => launcherOf(this, { [name]: { cwd, command: node('0'), env: {} } }, 1000));
  },
);

Then('the native launch is refused as {string} saying {string}', function (code: string, message: string) {
  const refusal = this.state['nativeRefusal'];
  assert.ok(refusal instanceof NativeLaunchError, String(refusal));
  assert.equal(refusal.name, 'NativeLaunchError');
  assert.equal(refusal.code, code);
  assert.equal(refusal.message, message);
});

Then('the native working directory holds no file {string}', function (name: string) {
  assert.equal(existsSync(join(cwdOf(this), name)), false);
});

When('I start the native process {string}', async function (name: string) {
  const child = await start(this, name);
  child.stdout.resume();
  // Whatever the scenario does next, the group of this child does not outlive it.
  this.cleanups.push(async () => {
    for (const kill of scheduledOf(this)) if (!kill.cancelled) kill.fire();
    await child.exited;
  });
});

When('I start the native process {string} and read its output', async function (name: string) {
  const child = await start(this, name);
  child.stdin.end();
  this.state['nativeRead'] = await readAll(child);
  await child.exited;
});

Then('the native output is the line {string}', function (line: string) {
  assert.equal(stored<string>(this, 'nativeRead'), `${line}\n`);
});

Then(
  'the native output is the line {string} followed by the folder declared at construction',
  function (line: string) {
    assert.equal(stored<string>(this, 'nativeRead'), `${line}${cwdOf(this)}\n`);
  },
);

Then('the native output is the line of the declared working directory', function () {
  assert.equal(stored<string>(this, 'nativeRead'), `${cwdOf(this)}\n`);
});

When('I start the native process {string} and wait for its exit', async function (name: string) {
  const child = await start(this, name);
  child.stdout.resume();
  this.state['nativeExit'] = await child.exited;
});

Then('the native exit is code {int} and no signal', function (code: number) {
  assert.deepEqual(stored<SandboxExit>(this, 'nativeExit'), { code, signal: null });
});

Then('the native exit is no code and the signal {string}', function (signal: string) {
  assert.deepEqual(stored<SandboxExit>(this, 'nativeExit'), { code: null, signal });
});

When('I close the native process', async function () {
  this.state['nativeClose'] = await childOf(this).close();
});

Then('the exit of the native close is code {int} and no signal', function (code: number) {
  assert.deepEqual(stored<SandboxExit>(this, 'nativeClose'), { code, signal: null });
});

Then('the exit of the native close is no code and the signal {string}', function (signal: string) {
  assert.deepEqual(stored<SandboxExit>(this, 'nativeClose'), { code: null, signal });
});

Then('one kill was scheduled after {int} ms, never fired, and cancelled', function (ms: number) {
  assert.deepEqual(
    scheduledOf(this).map(({ ms: after, fired, cancelled }) => ({ after, fired, cancelled })),
    [{ after: ms, fired: false, cancelled: true }],
  );
});

Then('the log received {int} characters, all under the name {string}', function (size: number, name: string) {
  const logged = stored<{ name: string; text: string }[]>(this, 'nativeLog');
  assert.deepEqual([...new Set(logged.map((entry) => entry.name))], [name]);
  // Three bytes a character: the chunks of the pipe cut some of them, and none comes out broken.
  assert.equal(logged.map((entry) => entry.text).join(''), '\u20ac'.repeat(size));
});

When('I start the native process {string} and read the two pids', async function (name: string) {
  const child = await start(this, name);
  let text = '';
  for await (const chunk of child.stdout) {
    text += String(chunk);
    if (text.includes('\n')) break;
  }
  const pids = text.trim().split(' ').map(Number);
  this.state['nativePids'] = pids;
  // The child leads its own group, outside the group of this run: whatever fails next, its group is killed.
  this.cleanups.push(() => killGroup(pids[0], 'SIGKILL'));
});

When('I ask the native process to close and fire the scheduled kill', async function () {
  const closed = childOf(this).close();
  const [kill] = scheduledOf(this);
  assert.ok(kill !== undefined);
  kill.fired = true;
  kill.fire();
  this.state['nativeClose'] = await closed;
});

Then('neither the native child nor its grandchild is alive', async function () {
  const pids = stored<number[]>(this, 'nativePids');
  assert.equal(pids.length, 2);
  assert.ok(pids.every((pid) => Number.isInteger(pid) && pid > 0));
  // Polled, never a fixed delay: the grandchild is reaped by init after the kill.
  const deadline = Date.now() + 30_000;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setImmediate(r));
  assert.deepEqual(pids.filter(alive), []);
});

When('I start the native process {string} and wait for the line it says', async function (name: string) {
  const child = await start(this, name);
  this.cleanups.push(async () => {
    child.stdout.resume();
    const closed = child.close();
    for (const kill of scheduledOf(this)) kill.fire();
    await closed;
  });
  await new Promise<void>((said) => child.stdout.once('data', () => said()));
});

Then('the input of the native process has one listener for its errors', function () {
  assert.equal(childOf(this).stdin.listenerCount('error'), 1);
});

Then(
  'a line written to its input fails with {string} and raises nothing in this process',
  async function (code: string) {
    const failure = await new Promise<Error | null | undefined>((done) =>
      childOf(this).stdin.write('late\n', done),
    );
    assert.equal((failure as NodeJS.ErrnoException | null | undefined)?.code, code);
  },
);
