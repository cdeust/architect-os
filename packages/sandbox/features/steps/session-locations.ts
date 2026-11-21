import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import type { SandboxRunner } from '../../src/port.js';
import { When, Then, ROOT, stored } from './helpers.js';
import { usePlatform, useSrt } from './runner.js';

const pinnedCli = createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js');
const command = `
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const [specText] = process.argv.slice(1);
  const spec = JSON.parse(specText);
  const denied = (operation) => {
    try { operation(); return false; }
    catch (e) { if (!['EACCES','EPERM','EROFS','ENOENT'].includes(e.code)) throw e; return true; }
  };
  const tmp = os.tmpdir();
  fs.writeFileSync(path.join(tmp, 'session-positive'), 'own');
  const cache = process.env.npm_config_cache;
  fs.mkdirSync(cache,{recursive:true}); fs.writeFileSync(path.join(cache,'private-cache-entry'),'own');
  const writes = spec.write.map(p => denied(() => fs.closeSync(fs.openSync(p,'a'))));
  const reads = spec.read.map(p => denied(() => fs.readFileSync(p)));
  const global = spec.global.map(p => denied(() => {
    fs.mkdirSync(path.dirname(p),{recursive:true});
    const fd = fs.openSync(p,'wx'); fs.closeSync(fd); fs.unlinkSync(p);
  }));
  console.log(JSON.stringify({tmp,cache,writes,reads,global}));
`;

When(
  'the real {string} engine and its child exercise the session locations',
  { timeout: 120000 },
  async function (profile: string) {
    const root = process.env.ARCHITECT_OS_RUNTIME_ROOT!;
    const run = process.env.ARCHITECT_OS_RUN_DIR!;
    const control = mkdtempSync(join(root, 'session-control-'));
    this.cleanups.push(() => rmSync(control, { recursive: true, force: true }));
    // A second actual admission, to the same marked root. The host owns and removes this run alone.
    const sibling = execFileSync(
      join(ROOT, 'aos'),
      ['--', process.execPath, '-p', 'process.env.ARCHITECT_OS_RUN_DIR'],
      { encoding: 'utf8', env: { ARCHITECT_OS_RUNTIME_ROOT: root, PATH: process.env.PATH } },
    ).trim();
    assert.equal(dirname(sibling), join(root, 'run'));
    assert.notEqual(sibling, run);
    assert.equal(JSON.parse(readFileSync(join(sibling, 'admission.json'), 'utf8')).run, basename(sibling));
    this.cleanups.push(() => rmSync(sibling, { recursive: true, force: true }));
    const token = randomUUID();
    const home = join(control, 'home');
    const write = [
      join(home, 'control'),
      join(home, '.cache', token),
      join(home, '.npm', '_logs', token),
      join(home, '.claude', 'debug', token),
      join(root, 'cache', 'npm', token),
      join(root, 'state', token),
      join(sibling, 'tmp', token),
    ];
    for (const file of write) {
      if (file.startsWith(home + sep)) mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'host', { flag: 'wx', mode: 0o600 });
      appendFileSync(file, '-control');
      this.cleanups.push(() => rmSync(file, { force: true }));
    }
    const wrapper = join(control, 'engine.mjs'),
      witness = join(control, 'engine.jsonl');
    // Observe the actual canary and payload engine environment before invoking the same pinned CLI.
    writeFileSync(
      wrapper,
      "import { appendFileSync, statSync } from 'node:fs';\nappendFileSync(" +
        JSON.stringify(witness) +
        ",JSON.stringify({tmp:process.env.TMPDIR,mode:statSync(process.argv[3]).mode & 0o777})+'\\n');\nawait import(" +
        JSON.stringify(pathToFileURL(pinnedCli).href) +
        ');\n',
    );
    const extra = {
      tmpRoot: tmpdir(),
      home,
      srtCli: wrapper,
      hostEnv: { PATH: process.env.PATH, HOME: home },
      variables: {
        authProxyPort: '9',
        callbackPort: '9',
        brokerPort: '9',
        sessionToken: 'fixture',
        taskToken: 'fixture',
      },
    };
    if (profile === 'worker' || profile === 'module') usePlatform(this, extra);
    else useSrt(this, () => extra);
    const global = [join('/tmp', token), join('/tmp/claude', token)];
    this.cleanups.push(() => {
      for (const file of global) if (existsSync(file)) rmSync(file);
    });
    const read = [write[5]!, write[6]!];
    const sandbox = await stored<SandboxRunner>(this, 'runner').start({
      profile,
      cwd: stored<string>(this, 'cwd'),
      command: [process.execPath, '-e', command, JSON.stringify({ write, read, global })],
    });
    sandbox.stdin.end();
    const collect = async (stream: NodeJS.ReadableStream) => {
      let out = '';
      for await (const chunk of stream) out += String(chunk);
      return out;
    };
    const [out, error, exit] = await Promise.all([
      collect(sandbox.stdout),
      collect(sandbox.stderr),
      sandbox.exited,
    ]);
    assert.equal(exit.code, 0, error);
    this.state['sessionLocations'] = {
      run,
      write,
      read,
      global,
      reported: JSON.parse(out),
      engine: readFileSync(witness, 'utf8')
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s)),
    };
  },
);
Then('both processes used the assigned temp and the protected paths kept their contents', function () {
  const { run, write, read, global, reported, engine } = stored<{
    run: string;
    write: string[];
    read: string[];
    global: string[];
    reported: { tmp: string; cache: string; writes: boolean[]; reads: boolean[]; global: boolean[] };
    engine: { tmp: string; mode: number }[];
  }>(this, 'sessionLocations');
  assert.ok(reported.tmp.startsWith(join(run, 'tmp', 'aos-sb') + sep));
  assert.deepEqual(engine, [
    { tmp: reported.tmp, mode: 0o400 },
    { tmp: reported.tmp, mode: 0o400 },
  ]);
  assert.equal(reported.cache, join(reported.tmp, 'npm'));
  assert.deepEqual(
    reported.writes,
    write.map(() => true),
    write.join(' '),
  );
  assert.deepEqual(
    reported.reads,
    read.map(() => true),
  );
  assert.deepEqual(
    reported.global,
    global.map(() => true),
  );
  for (const file of write) assert.equal(readFileSync(file, 'utf8'), 'host-control');
});
