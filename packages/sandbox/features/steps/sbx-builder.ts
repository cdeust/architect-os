import assert from 'node:assert/strict';
import childProcess, { type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { linkSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { SbxBuilder } from '../../src/sbx-builder.js';
import { sbxPolicySchema } from '../../src/sbx-vm.js';
import { PKG } from '../../src/code-tool.js';
import type { ResponseReceipt } from '../../src/responses-proxy.js';

Then(
  'the isolated production client writes its file and leaves the protected witnesses intact',
  { timeout: 240000 },
  async function () {
    const root = mkdtempSync(join(tmpdir(), 'sbx-build-'));
    const work = join(root, 'work');
    mkdirSync(work);
    for (const path of ['steps', '.claude', '.codex']) mkdirSync(join(work, path));
    writeFileSync(join(work, '.git'), 'fixture');
    writeFileSync(join(work, 'steps', 'protected'), 'unchanged');
    writeFileSync(join(root, 'outside'), 'unchanged');
    const policy = sbxPolicySchema.parse(JSON.parse(readFileSync(join(PKG, 'sbx/isolation.json'), 'utf8')));
    const archive =
      process.env.ARCHITECT_OS_TEST_CODEX_ARCHIVE ??
      join(process.env.ARCHITECT_OS_RUNTIME_ROOT!, 'cache', 'sbx', policy.archive);
    let requests = 0;
    let toolDiagnostic = 'no second request';
    const log: ResponseReceipt[] = [];
    const evidence: Buffer[] = [];
    const model = 'gpt-6.2-astra';
    const upstream: typeof fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(Buffer.from(init!.body as Uint8Array).toString());
      assert.equal(body.model, model);
      assert.equal(body.reasoning?.effort, 'medium');
      assert.ok(body.stream);
      assert.equal(body.store, false);
      requests++;
      const response = { id: 'resp_fixture_' + requests, object: 'response', model };
      const cmd =
        "printf 'built by client' > patch.txt && if printf 'changed' > steps/protected || printf 'changed' > ../outside || printf 'changed' > /tmp/aos-tool-witness; then exit 1; else printf 'writes refused'; fi";
      const item =
        requests === 1
          ? {
              type: 'function_call',
              name: 'exec_command',
              call_id: 'c1',
              id: 'fc_1',
              arguments: JSON.stringify({ cmd }),
            }
          : {
              type: 'message',
              role: 'assistant',
              id: 'm1',
              content: [{ type: 'output_text', text: 'Finished.', annotations: [] }],
            };
      if (requests === 2) {
        const reply = body.input.find(
          (i: { type: string; call_id: string }) => i.type === 'function_call_output' && i.call_id === 'c1',
        );
        const output = JSON.stringify(reply?.output ?? '');
        toolDiagnostic = output.includes('writes refused') ? 'writes refused' : 'unexpected tool reply';
      }
      const events = [
        { type: 'response.created', response: { ...response, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            ...response,
            status: 'completed',
            output: [item],
            usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
          },
        },
      ];
      return new Response(
        events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    };
    const builder = new SbxBuilder({
      allowRegistry: true,
      policy,
      archive,
      guestSource: join(PKG, 'sbx/codex-guest.py'),
      budget: { requests: 2, tokens: 12, bytes: 1048576 },
      access: async () => 'fixture',
      record: (r) => log.push(r),
      upstream,
    });
    try {
      const result = await builder.build({
        config: { provider: 'openai', model, effort: 'medium', limitSeconds: 180 },
        worktree: work,
        brief: 'Make the requested file.',
        systemPrompt: 'Work inside this project.',
        maxBytes: 1048576,
        onOutput: (b) => evidence.push(Buffer.from(b)),
      });
      assert.equal(
        result.measure.completed,
        true,
        'guest ' + JSON.stringify(evidence.map((b) => b.toString())) + ' calls ' + requests,
      );
      assert.ok(toolDiagnostic.includes('writes refused'), toolDiagnostic);
      assert.equal(result.measure.report, 'Finished.');
      assert.equal(readFileSync(join(work, 'patch.txt'), 'utf8'), 'built by client');
      assert.equal(readFileSync(join(work, 'steps/protected'), 'utf8'), 'unchanged');
      assert.equal(readFileSync(join(root, 'outside'), 'utf8'), 'unchanged');
      const attestation = JSON.parse(Buffer.concat(evidence).toString());
      assert.equal(attestation.removed, true);
      assert.equal(attestation.guest.uid, 65534);
      assert.equal(Object.hasOwn(attestation.guest, 'report'), false);
      assert.equal(attestation.guest.exitCode, 0);
      assert.deepEqual(
        [requests, log.length, result.measure.inputTokens, result.measure.outputTokens],
        [2, 2, 8, 4],
      );
    } catch (e) {
      if (e instanceof Error && /SBX_(CLEANUP|CREATE_UNCONFIRMED|RM_FAILED|LS_FAILED)/.test(e.message))
        throw Error('VM removal unconfirmed, retained fixture ' + root, { cause: e });
      rmSync(root, { recursive: true, force: true });
      throw Error('requests=' + requests + ' tool=' + toolDiagnostic, { cause: e });
    }
    rmSync(root, { recursive: true, force: true });
  },
);

import { checkSbxWorktree, withSbxVm, type SbxCommand } from '../../src/sbx-vm.js';
const committed = () => JSON.parse(readFileSync(join(PKG, 'sbx/isolation.json'), 'utf8'));
Then('the committed SBX builder pins pass their schema and a broken digest is rejected', function () {
  const p = committed();
  assert.deepEqual(sbxPolicySchema.parse(p), p);
  for (const field of ['shellKit', 'shellTemplate', 'archive', 'clientSha256'])
    for (const value of ['!' + p[field], p[field] + '!', 'invalid']) {
      assert.equal(sbxPolicySchema.safeParse({ ...p, [field]: value }).success, false);
    }
  assert.equal(sbxPolicySchema.safeParse({ ...p, archiveSha512: 'wrong length' }).success, false);
});
// Exercise the actual host subprocess adapter with an injected OS boundary.
async function cliFixture(kind: string, command: SbxCommand, scenario: () => Promise<void>) {
  const choices = ['/opt/homebrew/bin/sbx', '/usr/local/bin/sbx', '/usr/bin/sbx'];
  const expected = kind === 'local CLI' ? choices[1] : kind === 'system CLI' ? choices[2] : choices[0];
  const exists = fs.existsSync,
    exec = childProcess.execFile;
  const probes: string[] = [];
  const stat = mock.method(fs, 'existsSync', (path: fs.PathLike) => {
    if (typeof path === 'string' && path.endsWith('/sbx')) {
      probes.push(path);
      return kind !== 'missing CLI' && path === expected;
    }
    return exists(path);
  });
  const env = {
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
  };
  function verify(path: string, args: string[], opts: Record<string, unknown>) {
    assert.equal(path, expected);
    assert.equal(args[0], '--no-input');
    assert.equal(opts['cwd'], '/');
    assert.deepEqual(opts['env'], env);
    assert.equal(opts['killSignal'], 'SIGKILL');
    assert.ok(opts['signal'] instanceof AbortSignal);
  }
  const fixture = async (path: string, args: string[], opts: Record<string, unknown>) => {
    verify(path, args, opts);
    assert.equal(opts['maxBuffer'], 1048576);
    if (kind === 'invalid CLI code') throw { code: 'ENOENT', stdout: '' };
    if (kind === 'cancelled CLI') {
      process.emit('SIGHUP');
      throw { code: 1, stdout: '' };
    }
    if (kind === 'invalid CLI failure') throw { code: 1, stdout: null };
    const r = await command(args.slice(1), opts['signal'] as AbortSignal);
    if (r.code !== 0) throw r;
    return { stdout: r.stdout };
  };
  childProcess.execFile = Object.assign(() => assert.fail('fixture expected promise interface'), {
    [promisify.custom]: fixture,
  }) as unknown as typeof exec;
  const spawn = mock.method(
    childProcess,
    'spawn',
    (path: string, args: string[], opts: Record<string, unknown>) => {
      verify(path, args, opts);
      assert.equal(opts['stdio'], 'pipe');
      assert.deepEqual(args.slice(1), [
        'exec',
        '-i',
        '--user',
        '65534:65534',
        '-w',
        '/fixture',
        '--',
        args[8],
        '/fixture/guest',
      ]);
      assert.match(args[8]!, /^aos-build-/);
      return { pid: 123 };
    },
  );
  syncBuiltinESMExports();
  try {
    await scenario();
    assert.deepEqual(
      probes.slice(0, kind === 'missing CLI' ? 3 : choices.indexOf(expected!) + 1),
      choices.slice(0, kind === 'missing CLI' ? 3 : choices.indexOf(expected!) + 1),
    );
  } finally {
    stat.mock.restore();
    spawn.mock.restore();
    childProcess.execFile = exec;
    syncBuiltinESMExports();
  }
}
Then(
  'the SBX host receives {string} and stages the client {int} times',
  async function (kind: string, times: number) {
    const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
    const before = signals.map((sig) => process.listenerCount(sig));
    let useSignal: AbortSignal | undefined;
    let setups = 0,
      abortedCalls = 0,
      allowedRegistry = 0,
      allowedHost = 0;
    const p = sbxPolicySchema.parse(committed()),
      workspace = '/fixture';
    const [repository, digest] = p.shellTemplate.split('@');
    let vmName = '',
      name = '',
      removed = 0,
      staged = 0;
    const command: SbxCommand = async (args, signal) => {
      if (signal.aborted) abortedCalls++;
      assert.equal(signal.aborted, false);
      let code = 0,
        value: unknown;
      switch (args[0]) {
        case '--version':
          assert.deepEqual(args, ['--version']);
          return { code, stdout: kind === 'wrong CLI version' ? 'invalid' : ' ' + p.cliVersion + '\n' };
        case 'template':
          assert.deepEqual(args, ['template', 'ls', '--all', '--json']);
          value = [
            {
              flavor: kind === 'template flavor' ? 'other' : 'shell',
              repository: kind === 'template repo' ? 'elsewhere' : repository,
              id: kind === 'template id' ? 'other' : digest,
              digest: kind === 'template digest' ? 'other' : digest,
            },
          ];
          break;
        case 'ls':
          assert.deepEqual(args, ['ls', '--json']);
          value = name ? [{ name }] : [];
          if (kind === 'name in use' && !name)
            value = [{ name: 'aos-build-00000000-0000-4000-8000-000000000001' }];
          if (kind === 'unconfirmed create' || kind === 'already removed') value = [];
          break;
        case 'create':
          vmName = name = args[args.indexOf('--name') + 1]!;
          assert.match(name, /^aos-build-[0-9a-f-]{36}$/);
          assert.deepEqual(args, [
            'create',
            '--name',
            name,
            '--skills',
            'off',
            '--static-mcp',
            'none',
            '--pull',
            'never',
            '--template',
            p.shellTemplate,
            p.shellKit,
            workspace,
          ]);
          if (kind === 'ambiguous creation' || kind === 'unconfirmed create') code = 1;
          break;
        case 'inspect':
          assert.deepEqual(args, ['inspect', '--json', name]);
          value = {
            name: kind === 'wrong name' ? 'other' : name,
            workspace: kind === 'other workspace' ? 'other' : workspace,
            agent: kind === 'other agent' ? 'other' : 'shell',
            image_digest: kind === 'wrong image' ? 'another' : digest,
            mcp_mode: kind === 'MCP mode' ? 'dynamic' : 'static',
            mcp_servers: kind === 'MCP server' ? ['one'] : [],
            published_ports: kind === 'published port' ? ['123'] : [],
            runtime_mounts: kind === 'runtime mount' ? ['/x'] : [],
            kits: [kind === 'wrong kit' ? 'other' : p.shellKit],
            host_mounts: [
              {
                host_path: kind === 'mount source' ? '/other' : workspace,
                container_target: kind === 'mount target' ? '/other' : workspace,
                read_only: kind === 'readonly worktree',
              },
              ...(kind === 'extra mount' ? [{}] : []),
            ],
          };
          break;
        case 'policy': {
          const scope = 'sandbox:' + name,
            host = 'localhost:33451',
            registry = 'registry.npmjs.org:443';
          if (args[1] === 'allow') {
            if (args.includes('--method')) allowedHost++;
            else allowedRegistry++;
            if (!args.includes('--method'))
              assert.ok(!['registry disabled', 'unexpected registry'].includes(kind));
            assert.deepEqual(
              args,
              args.includes('--method')
                ? [
                    'policy',
                    'allow',
                    'network',
                    '--sandbox',
                    name,
                    host,
                    '--method',
                    'POST',
                    '--path',
                    '/v1/responses',
                  ]
                : ['policy', 'allow', 'network', '--sandbox', name, registry],
            );
          } else if (args[1] === 'ls') {
            assert.deepEqual(args.slice(0, -1), ['policy', 'ls', name, '--json', '--type']);
            assert.ok(['network', 'http'].includes(args.at(-1)!));
            const npm = {
              decision: 'allow',
              scope,
              status: 'active',
              resource_type: 'network',
              resources: [registry],
              actions: ['net:connect:tcp'],
              id: 'npm',
            };
            const post = {
              decision: 'allow',
              scope,
              status: 'active',
              resource_type: 'http',
              resources: [host],
              actions: ['http:request:post'],
              id: 'post',
              methods: ['POST'],
              http_targets: [{ host, path: '/v1/responses' }],
            };
            const fallback = {
              decision: 'deny',
              scope: 'global',
              status: 'active',
              resource_type: 'network',
              resources: ['**'],
              actions: ['net:connect:tcp', 'net:connect:udp'],
              id: 'default-deny-all',
            };
            if (kind === 'rule scope') npm.scope = 'global';
            if (kind === 'rule inactive') npm.status = 'disabled';
            if (kind === 'rule resource') fallback.resource_type = 'volume';
            if (kind === 'rule destination') post.resources = ['localhost'];
            if (kind === 'missing UDP') fallback.actions = ['net:connect:tcp'];
            if (kind === 'missing TCP') fallback.actions = ['net:connect:udp'];
            if (kind === 'wrong method') post.methods = ['GET', 'POST'];
            if (kind === 'wider path') post.http_targets = [{ host, path: '/**' }];
            if (kind === 'global HTTP') post.scope = 'global';
            if (kind === 'registry wildcard' || (kind === 'changed policy' && staged)) npm.resources = ['**'];
            if (kind === 'fallback id') fallback.id = 'custom';
            if (kind === 'fallback disposition') fallback.decision = 'allow';
            if (kind === 'fallback scope') fallback.scope = scope;
            if (kind === 'fallback inactive') fallback.status = 'disabled';
            if (kind === 'fallback destination') fallback.resources = ['example.com'];
            if (kind === 'registry UDP') npm.actions.push('net:connect:udp');
            if (kind === 'registry type') npm.resource_type = 'http';
            if (kind === 'inactive HTTP') post.status = 'disabled';
            if (kind === 'other HTTP type') post.resource_type = 'network';
            if (kind === 'any HTTP action') post.actions = ['http:request:*'];
            if (kind === 'other HTTP authority') post.http_targets[0]!.host = 'elsewhere';
            if (kind === 'extra HTTP target') post.http_targets.push({ host, path: '/other' });
            if (kind === 'unknown decision') post.decision = 'unknown';
            const netRules = ['missing registry', 'registry disabled'].includes(kind)
              ? [fallback]
              : [fallback, npm, ...(kind === 'extra allow' ? [npm] : [])];
            const httpRules =
              kind === 'missing HTTP' ? [] : [post, ...(kind === 'extra HTTP allow' ? [post] : [])];
            value = {
              rules:
                args.at(-1) === 'network'
                  ? netRules
                  : [...httpRules, { decision: kind === 'unexpected HTTP decision' ? 'surprise' : 'deny' }],
            };
          } else {
            assert.deepEqual(args.slice(0, -2), [
              'policy',
              'check',
              'network',
              '--sandbox',
              name,
              '--json',
              '--protocol',
            ]);
            const proto = args.at(-2)!;
            assert.ok(['example.com:443', 'localhost:33452'].includes(args.at(-1)!));
            code = kind === 'live ' + proto.toUpperCase() + ' route' ? 0 : 1;
            value = {
              allowed: code === 0 || kind === 'check allowed',
              context: kind === 'check scope' ? 'global' : scope,
              deny_kind: kind === 'check implicit' ? 'unknown' : proto === 'udp' ? 'explicit' : 'implicit',
              action: kind === 'check action' ? 'other' : 'net:connect:' + proto,
            };
          }
          break;
        }
        case 'exec':
          if (args[2] === '0:0') {
            setups++;
            assert.deepEqual(args, ['exec', '--user', '0:0', '-w', '/', '--', name, '/host/setup']);
          } else if (args.includes('-c')) {
            assert.deepEqual(args.slice(-2), ['33451', '33452']);
            assert.deepEqual(args.slice(0, -3), [
              'exec',
              '--user',
              '65534:65534',
              '-w',
              workspace,
              '--',
              name,
              '/usr/bin/python3',
              '-I',
              '-c',
            ]);
            const source = args.at(-3)!;
            for (const required of [
              'shutil.which("sbx")',
              'urllib.request.urlopen',
              'ProxyHandler({})',
              'status!=expected',
              '/unlisted',
              'example.com',
            ])
              assert.ok(source.includes(required));
            if (kind === 'canary accepts') {
              code = 1;
              break;
            }
          } else
            assert.deepEqual(args, [
              'exec',
              '--user',
              '65534:65534',
              '-w',
              workspace,
              '--',
              name,
              '/usr/bin/test',
              '!',
              '-w',
              p.forbiddenHostSocket,
            ]);
          code = kind === 'writable socket' ? 1 : 0;
          break;
        case 'cp':
          assert.deepEqual(args, ['cp', '--', 'source', name + ':target']);
          staged++;
          break;
        case 'rm':
          assert.deepEqual(args, ['rm', '--force', name]);
          removed++;
          if (kind !== 'incomplete removal') name = '';
          break;
        default:
          assert.fail();
      }
      return { code, stdout: JSON.stringify(value ?? null) };
    };
    const throughCli = [
      'verified',
      'local CLI',
      'system CLI',
      'missing CLI',
      'invalid CLI code',
      'cancelled CLI',
      'invalid CLI failure',
    ].includes(kind);
    const execute = async () => {
      const work = withSbxVm(
        workspace,
        p,
        10,
        {
          port: 33451,
          deniedPort: 33452,
          allowRegistry: !['registry disabled', 'unexpected registry'].includes(kind),
        },
        async (vm) => {
          assert.equal(vm.name, name);
          assert.equal(vm.signal.aborted, false);
          useSignal = vm.signal;
          assert.deepEqual(
            signals.map((sig) => process.listenerCount(sig)),
            before.map((n) => n + 1),
          );
          assert.equal(allowedHost, 1);
          assert.equal(allowedRegistry, kind === 'registry disabled' ? 0 : 1);
          await vm.copy('source', 'target');
          await vm.setup(['/host/setup']);
          if (throughCli) assert.equal(vm.pipes(['/fixture/guest']).pid, 123);
          if (kind === 'interrupted') process.emit('SIGHUP');
          return 'executed';
        },
        throughCli ? undefined : command,
      );
      if (['verified', 'local CLI', 'system CLI', 'already removed', 'registry disabled'].includes(kind))
        assert.deepEqual(await work, { name: vmName, result: 'executed' });
      else if (kind === 'interrupted') await assert.rejects(work, { message: 'SBX_INTERRUPTED' });
      else if (['invalid CLI failure', 'invalid CLI code', 'cancelled CLI'].includes(kind))
        await assert.rejects(work, { message: 'SBX_COMMAND_FAILED' });
      else if (kind === 'missing CLI') await assert.rejects(work, { message: 'SBX_CLI_REQUIRED' });
      else if (kind === 'wrong CLI version') await assert.rejects(work, { message: 'SBX_VERSION' });
      else if (kind.startsWith('template ')) await assert.rejects(work, { message: 'SBX_TEMPLATE' });
      else if (kind.startsWith('live ')) await assert.rejects(work, { message: 'SBX_NETWORK_ROUTE' });
      else if (kind.startsWith('rule ') || kind.startsWith('missing UDP') || kind.startsWith('missing TCP'))
        await assert.rejects(work, { message: 'SBX_NETWORK_POLICY' });
      else if (kind === 'name in use') await assert.rejects(work, { message: 'SBX_NAME_IN_USE' });
      else if (kind === 'unconfirmed create')
        await assert.rejects(work, (e: Error) => e.message === 'SBX_CREATE_UNCONFIRMED ' + vmName);
      else if (kind === 'ambiguous creation') await assert.rejects(work, { message: 'SBX_CREATE_FAILED' });
      else if (kind === 'incomplete removal')
        await assert.rejects(work, (e: Error) => e.message === 'SBX_CLEANUP_INCOMPLETE ' + vmName);
      else await assert.rejects(work);
    };
    if (throughCli) await cliFixture(kind, command, execute);
    else if (kind === 'name in use') {
      const id = mock.method(crypto, 'randomUUID', () => '00000000-0000-4000-8000-000000000001');
      syncBuiltinESMExports();
      try {
        await execute();
      } finally {
        id.mock.restore();
        syncBuiltinESMExports();
      }
    } else await execute();
    assert.equal(abortedCalls, 0);
    assert.equal(staged, times);
    assert.equal(setups, times);
    assert.deepEqual(
      signals.map((sig) => process.listenerCount(sig)),
      before,
    );
    if (useSignal) assert.equal(useSignal.aborted, true);
    assert.equal(
      removed,
      kind.startsWith('template ') ||
        [
          'wrong CLI version',
          'missing CLI',
          'invalid CLI failure',
          'invalid CLI code',
          'cancelled CLI',
          'name in use',
          'unconfirmed create',
          'already removed',
        ].includes(kind)
        ? 0
        : 1,
    );
  },
);

Then('SBX checks the workspace tree and path before any CLI call', async function () {
  for (const bad of ['relative', '/a:b'])
    await assert.rejects(
      withSbxVm(
        bad,
        committed(),
        1,
        { port: 33451, deniedPort: 33452, allowRegistry: true },
        async () => assert.fail(),
        async () => assert.fail(),
      ),
      { message: 'SBX_WORKTREE' },
    );
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sbx-tree-')));
  try {
    const tree = join(dir, 'work');
    mkdirSync(tree);
    fs.symlinkSync(tree, join(dir, 'alias'));
    assert.throws(() => checkSbxWorktree(join(dir, 'alias')), { message: 'SBX_WORKTREE' });
    fs.symlinkSync(join(dir, 'outside'), join(tree, 'link'));
    checkSbxWorktree(tree);
    const sub = join(tree, 'directory');
    mkdirSync(sub);
    writeFileSync(join(sub, 'ordinary'), 'safe');
    checkSbxWorktree(tree);
    assert.equal(childProcess.spawnSync('mkfifo', [join(sub, 'special')]).status, 0);
    assert.throws(() => checkSbxWorktree(tree), { message: 'SBX_WORKTREE_ENTRY' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
Then('SBX refuses a worktree with a hard link to an outside witness', function () {
  const root = mkdtempSync(join(tmpdir(), 'sbx-links-'));
  try {
    const work = join(root, 'work');
    mkdirSync(work);
    writeFileSync(join(root, 'outside'), 'fixed');
    checkSbxWorktree(work);
    linkSync(join(root, 'outside'), join(work, 'inside'));
    assert.throws(() => checkSbxWorktree(work), { message: 'SBX_WORKTREE_ENTRY' });
    assert.equal(readFileSync(join(root, 'outside'), 'utf8'), 'fixed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { copyFileSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { git } from './tree-fingerprint.js';
import { fingerprintTree } from '../../src/tree-fingerprint.js';
import { launcherFiles } from '../../src/step-tool.js';
import { randomUUID } from 'node:crypto';
import { keychainEntry } from '../../src/sbx-keychain.js';
import { parseStepFile } from '../../src/step-file.js';
import { admittedFixture } from './admission-fixture.js';
Then(
  'the production Step command publishes a native {string} patch against an offline provider',
  { timeout: 240000 },
  async function (model: string) {
    const launcher = resolve(PKG, '../..');
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'sbx-step-cli-')));
    // Keep the synthetic admitted root short enough for SRT's macOS Unix socket; reserve it exclusively.
    let runtime: string;
    for (;;) {
      runtime = join(process.env.ARCHITECT_OS_RUNTIME_ROOT!, randomBytes(1).toString('hex'));
      try {
        mkdirSync(runtime, { mode: 0o700 });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    const repo = join(fixture, 'repo'),
      work = join(repo, '.claude/worktrees/native');
    const intake = join(fixture, 'intake', 'native'),
      auth = join(runtime, 'fixture-home/.config/architect-os/step-admission');
    const privateDir = (p: string) => mkdirSync(p, { mode: 0o700, recursive: true });
    for (const p of [
      runtime,
      auth,
      work,
      intake,
      join(runtime, 'cache/sbx'),
      join(runtime, 'state/sbx'),
      join(work, '.claude'),
      join(work, '.codex'),
    ])
      privateDir(p);
    const archive = committed().archive;
    copyFileSync(
      process.env.ARCHITECT_OS_TEST_CODEX_ARCHIVE ??
        join(process.env.ARCHITECT_OS_RUNTIME_ROOT!, 'cache', 'sbx', archive),
      join(runtime, 'cache/sbx', archive),
    );
    const hostId = 'urn:uuid:' + randomUUID();
    // An exclusively named synthetic item is the only keychain item this test owns.
    const item = keychainEntry(hostId);
    assert.equal(item.getPassword(), null);
    writeFileSync(join(runtime, 'state/sbx/host-id'), hostId, { mode: 0o600 });
    const keychainCheck = `const {Entry}=require(${JSON.stringify(join(launcher, 'node_modules/@napi-rs/keyring'))}); let found;try{found=new Entry('architect-os.siwc',${JSON.stringify(hostId)},{linux:{store:'secret-service'}}).getPassword()}catch{} if(found)process.exit(1)`;
    const checkScript = join(fixture, 'check-private-account.cjs');
    writeFileSync(checkScript, keychainCheck);
    const raw = JSON.stringify({
      build: { provider: 'openai', model, effort: 'medium', limitSeconds: 180 },
      checks: [
        { name: 'patch', command: ['test', '-f', 'result.txt'], limitSeconds: 30 },
        { name: 'private-account', command: [process.execPath, checkScript], limitSeconds: 30 },
      ],
      reviews: [
        {
          name: 'correctness',
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          effort: 'medium',
          limitSeconds: 30,
        },
      ],
    });
    // A synthetic repository with linked-worktree metadata, all inside the disposable test directory.
    git(repo, 'init', '-q');
    git(repo, 'commit', '--allow-empty', '-qm', 'offline');
    const metadata = join(repo, '.git/worktrees/native');
    privateDir(metadata);
    writeFileSync(join(work, '.git'), 'gitdir: ' + metadata + '\n');
    writeFileSync(join(metadata, 'commondir'), '../..\n');
    writeFileSync(join(metadata, 'gitdir'), join(work, '.git') + '\n');
    writeFileSync(join(metadata, 'HEAD'), git(repo, 'rev-parse', 'HEAD') + '\n');
    copyFileSync(
      join(process.env.ARCHITECT_OS_RUNTIME_ROOT!, '.architect-os-runtime-root'),
      join(runtime, '.architect-os-runtime-root'),
    );
    writeFileSync(
      join(runtime, 'state/sbx/limits.json'),
      JSON.stringify({ requests: 2, tokens: 16, bytes: 1048576 }),
      { mode: 0o600 },
    );
    const inputs = { 'step.json': raw, 'brief.md': 'Write the requested file.\n' };
    for (const [name, text] of Object.entries(inputs)) writeFileSync(join(intake, name), text);
    const step = parseStepFile(JSON.parse(raw));
    const subject = {
      name: 'native',
      worktree: work,
      tree: fingerprintTree(work),
      inputs,
      step,
      launcher: launcherFiles((f) => readFileSync(join(PKG, f), 'utf8'), step),
    };
    const receipt = join(auth, 'grant.json');
    writeFileSync(receipt, JSON.stringify(admittedFixture(subject)), { mode: 0o600 });
    const bin = join(fixture, 'bin');
    privateDir(bin);
    const reviewFixture = join(PKG, 'fixtures/review-accept-proposal.jsonl');
    copyFileSync(reviewFixture, join(bin, 'review.jsonl'));
    writeFileSync(
      join(bin, 'claude'),
      '#!/bin/sh\n/bin/cat >/dev/null\nexec /bin/cat "${0%/*}/review.jsonl"\n',
      { mode: 0o700 },
    );
    const env = {
      AOS_FIXTURE_MODEL: model,
      PATH: bin + ':' + process.env.PATH,
      HOME: process.env.HOME,
      ARCHITECT_OS_RUNTIME_ROOT: runtime,
      ARCHITECT_OS_STEP_EVIDENCE: receipt,
    };
    try {
      const setup = await promisify(execFile)(
        join(launcher, 'aos'),
        [
          '--',
          'npm',
          '--prefix',
          launcher,
          '--node-options=--import=' + join(launcher, 'bench/sbx/step-fixture-preload.mjs'),
          'run',
          'sbx:sign-in',
          '--',
          model,
        ],
        { cwd: work, env, timeout: 30000 },
      );
      assert.match(setup.stdout, /SBX account ready/);
      assert.ok(item.getPassword());
      const { stdout } = await promisify(execFile)(
        join(launcher, 'aos'),
        [
          '--',
          'npm',
          '--prefix',
          launcher,
          '--node-options=--import=' + join(launcher, 'bench/sbx/step-fixture-preload.mjs'),
          'run',
          'step',
          '--',
          intake,
        ],
        { cwd: work, env, timeout: 225000 },
      );
      assert.equal(JSON.parse(stdout.trim().split('\n').at(-1)!).outcome, 'passed');
      assert.equal(readFileSync(join(work, 'result.txt'), 'utf8'), 'native step patch');
      const record = JSON.parse(readFileSync(join(work, 'steps/native/record.json'), 'utf8'));
      assert.equal(record.checks[0].passed, true);
      assert.equal(record.checks[1].passed, true);
      assert.equal(record.sessions[0].provider, 'openai');
      assert.equal(record.sessions[0].model, model);
      assert.equal(record.sessions[0].effort, 'medium');
      assert.equal(record.sessions[0].client.sha256, committed().clientSha256);
      assert.equal(record.sessions[0].costUsd, null);
      assert.equal(record.reviews[0].verdict, 'accept');
      assert.equal(record.sessions[1].role, 'review');
      assert.equal(record.sessions[0].client.version, committed().clientVersion);
      assert.deepEqual(record.sessions[0].usage, { inputTokens: 10, outputTokens: 6 });
      assert.equal(record.sessions[0].responses.length, 2);
    } finally {
      item.deletePassword();
      rmSync(runtime, { recursive: true, force: true });
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

Then('a direct SBX host without a run binding refuses before CLI access', async function () {
  const saved = process.env.ARCHITECT_OS_RUN_DIR,
    lines: string[] = [];
  let calls = 0;
  const exit = mock.method(process, 'exit', (code: number) => {
    throw Error('exit ' + code);
  });
  const stderr = mock.method(process.stderr, 'write', (chunk: string) => {
    lines.push(chunk);
    return true;
  });
  try {
    delete process.env.ARCHITECT_OS_RUN_DIR;
    await assert.rejects(
      withSbxVm(
        '/fixture',
        committed(),
        1,
        { port: 33451, deniedPort: 33452, allowRegistry: true },
        async () => assert.fail(),
        async () => {
          calls++;
          throw Error('cli');
        },
      ),
      { message: 'exit 2' },
    );
    assert.deepEqual(lines, ['aos: RUNTIME_ENTRY_REQUIRED\n']);
    assert.equal(calls, 0);
  } finally {
    process.env.ARCHITECT_OS_RUN_DIR = saved;
    exit.mock.restore();
    stderr.mock.restore();
  }
});
