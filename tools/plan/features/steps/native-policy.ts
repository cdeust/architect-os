import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, delimiter, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { Then } from '@cucumber/cucumber';
import {
  requestDraft,
  trustedMetadata,
  installationPolicy,
  type DraftRequest,
} from '../../src/infrastructure/plan-cli.js';

const request: DraftRequest = {
  provider: 'gemini',
  model: 'gemini-test',
  step: 'audit',
  handoff: {
    version: 1,
    run_id: 'r',
    requirements: [{ id: 'FR-1', text: 'Keep records.' }],
    acceptance: [{ id: 'AC-1', text: 'Read.', requirement_ids: ['FR-1'] }],
  },
  timeoutMs: 1500,
};

Then('native drafts reject redirected executables and active Google integrations', async function () {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'plan-trust-')));
  try {
    const home = join(root, 'home'),
      dir = join(home, '.local', 'bin'),
      exe = join(dir, 'agy');
    const profile = join(root, 'profile'),
      config = join(profile, '.gemini', 'config');
    mkdirSync(config, { recursive: true });
    mkdirSync(dir, { recursive: true });
    const env: NodeJS.ProcessEnv = { HOME: home, AOS_PLAN_GEMINI_HOME: profile };
    const result = { conversation_id: 'r', num_turns: 1, status: 'SUCCESS', response: 'ok', usage: {} };
    const stream = [
      { event: 'init', conversation_id: 'r', init: { model: 'gemini-test', permission_mode: 'strict' } },
      { event: 'result', result },
    ]
      .map((v) => JSON.stringify(v))
      .join('\n');
    const marker = join(root, 'called');
    const shim = () =>
      writeFileSync(
        exe,
        '#!' +
          process.execPath +
          '\nconst fs=require("node:fs");fs.readFileSync(0);fs.writeFileSync(' +
          JSON.stringify(marker) +
          ',process.env.HOME);console.log(' +
          JSON.stringify(stream) +
          ');',
        { mode: 0o700 },
      );
    shim();
    const run = (overrides: NodeJS.ProcessEnv = {}) => requestDraft(request, { ...env, ...overrides });
    const ok = async () => {
      assert.equal((await run()).text, 'ok');
      assert.equal(readFileSync(marker, 'utf8'), profile);
      rmSync(marker);
    };
    const refuse = async (overrides: NodeJS.ProcessEnv = {}, why = /./) => {
      await assert.rejects(() => run(overrides), why);
      assert.equal(existsSync(marker), false);
    };
    const roots = [
      join(home, '.local'),
      join(home, '.codex'),
      join(home, '.gemini'),
      '/opt/homebrew',
      '/usr/local',
      '/usr',
    ];
    for (const name of ['claude', 'agy', 'codex']) {
      const choices =
        name === 'codex'
          ? ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(dir, 'codex')]
          : [join(dir, name)];
      assert.deepEqual(installationPolicy(home, name), { roots, choices });
    }
    for (const owner of [0, 1001, 1002])
      for (const mode of [0o700, 0o755, 0o757, 0o775]) {
        assert.equal(
          trustedMetadata(mode, owner, 1001),
          (owner === 0 || owner === 1001) && [0o700, 0o755].includes(mode),
        );
      }
    await ok();
    await refuse({ HOME: undefined }, /invalid profile path/);
    await refuse({ HOME: 'relative' }, /invalid profile path/);
    const checkout = join(root, 'checkout');
    mkdirSync(checkout);
    writeFileSync(join(checkout, '.git'), 'gitdir: fake');
    const original = process.env.TMPDIR;
    try {
      process.env.TMPDIR = checkout;
      await refuse();
    } finally {
      if (original === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = original;
    }
    await refuse({ AOS_PLAN_GEMINI_HOME: checkout });
    await refuse({ AOS_PLAN_GEMINI_HOME: 'relative' });
    await refuse({ AOS_PLAN_GEMINI_BIN: 'relative/agy' }, /invalid CLI path/);
    await refuse({ AOS_PLAN_GEMINI_BIN: join(dir, 'other') }, /invalid CLI path/);
    const outside = join(root, 'agy');
    writeFileSync(outside, '', { mode: 0o700 });
    await refuse({ AOS_PLAN_GEMINI_BIN: outside }, /outside trusted installation roots/);
    rmSync(exe);
    symlinkSync(outside, exe);
    await refuse();
    rmSync(exe);
    mkdirSync(exe);
    await refuse();
    rmSync(exe, { recursive: true });
    shim();
    chmodSync(exe, 0o777);
    await refuse();
    chmodSync(exe, 0o700);
    chmodSync(dir, 0o777);
    await refuse();
    chmodSync(dir, 0o700);
    writeFileSync(join(dir, '.git'), 'gitdir: fake');
    await refuse();
    rmSync(join(dir, '.git'));
    for (const key of ['hooks.json', 'mcp_config.json']) {
      const f = join(config, key);
      writeFileSync(f, 'hooks');
      await refuse();
      rmSync(f);
      symlinkSync(outside, f);
      await refuse();
      rmSync(f);
      writeFileSync(f, '');
      await ok();
    }
    const plugins = join(config, 'plugins');
    mkdirSync(join(plugins, 'enabled'), { recursive: true });
    await refuse();
    rmSync(join(plugins, 'enabled'), { recursive: true });
    await ok();
    const settings = join(config, 'config.json');
    writeFileSync(outside, '{}');
    linkSync(outside, settings);
    await refuse({}, /unsafe Google preferences path/);
    rmSync(settings);
    symlinkSync(outside, settings);
    await refuse();
    rmSync(settings);
    for (const enableAdc of [true, 'true', null]) {
      writeFileSync(settings, JSON.stringify({ userSettings: { enableAdc } }));
      await refuse();
    }
    writeFileSync(settings, JSON.stringify({ userSettings: { enableAdc: false } }));
    await ok();
    writeFileSync(settings, Buffer.concat([Buffer.from('{"name":"'), Buffer.from([255]), Buffer.from('"}')]));
    await refuse();
    writeFileSync(settings, '{}');
    await ok();
    const moved = join(profile, 'original');
    renameSync(config, moved);
    symlinkSync(moved, config);
    await refuse({}, /unsafe Google preferences path/);
    rmSync(config);
    renameSync(moved, config);
    rmSync(exe);
    await refuse({}, /CLI not installed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

Then('a controlled provider respects its environment, output bound and timeout', async function () {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'plan-limit-')));
  try {
    const dir = join(root, '.local', 'bin');
    mkdirSync(dir, { recursive: true });
    const exe = join(dir, 'claude'),
      trace = join(root, 'trace');
    const start = (code: string) =>
      writeFileSync(exe, '#!' + process.execPath + '\n' + code, { mode: 0o700 });
    const env = {
      HOME: root,
      AOS_PLAN_CLAUDE_BIN: exe,
      AOS_PLAN_GEMINI_HOME: 'not-for-claude',
      NODE_OPTIONS: 'irrelevant',
    };
    const r = { ...request, provider: 'claude' as const };
    const googleConfig = join(root, '.gemini', 'config');
    mkdirSync(googleConfig, { recursive: true });
    writeFileSync(join(googleConfig, 'hooks.json'), 'active');

    start(
      'const fs=require("node:fs");fs.readFileSync(0);fs.writeFileSync(' +
        JSON.stringify(trace) +
        ',JSON.stringify({cwd:process.cwd(),home:process.env.HOME,path:process.env.PATH,lang:process.env.LANG,tmp:process.env.TMPDIR}));process.stdout.write("x".repeat(1024*1024+1));',
    );
    const refused = await requestDraft(r, env);
    assert.equal(refused.text, null);
    assert.equal(refused.usage, null);
    assert.equal(refused.failure, 'output_unavailable');
    const seen = JSON.parse(readFileSync(trace, 'utf8'));
    assert.equal(seen.home, root);
    assert.equal(seen.path, [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter));
    assert.equal(seen.lang, 'C');
    assert.equal(seen.tmp, seen.cwd);
    assert.match(basename(seen.cwd), /^aos-plan-cli-/);
    assert.equal(existsSync(seen.cwd), false);
    start('process.stdin.resume();setInterval(()=>{},60000);');
    const timed = await requestDraft({ ...r, timeoutMs: 100 }, env);
    assert.equal(timed.exit_code, null);
    assert.equal(timed.signal, 'SIGKILL');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
