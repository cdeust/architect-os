import assert from 'node:assert/strict';
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
      assert.equal(readFileSync(join(work, 'patch.txt'), 'utf8'), 'built by client');
      assert.equal(readFileSync(join(work, 'steps/protected'), 'utf8'), 'unchanged');
      assert.equal(readFileSync(join(root, 'outside'), 'utf8'), 'unchanged');
      const attestation = JSON.parse(Buffer.concat(evidence).toString());
      assert.equal(attestation.removed, true);
      assert.equal(attestation.guest.uid, 65534);
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
  assert.equal(sbxPolicySchema.safeParse({ ...p, clientSha256: 'invalid' }).success, false);
});
Then(
  'the SBX host receives {string} and stages the client {int} times',
  async function (kind: string, times: number) {
    const p = sbxPolicySchema.parse(committed()),
      workspace = '/fixture';
    const [repository, digest] = p.shellTemplate.split('@');
    let name = '',
      removed = 0,
      staged = 0;
    const command: SbxCommand = async (args) => {
      let code = 0,
        value: unknown;
      switch (args[0]) {
        case '--version':
          return { code, stdout: p.cliVersion };
        case 'template':
          value = [{ flavor: 'shell', repository, id: digest, digest }];
          break;
        case 'ls':
          value = name ? [{ name }] : [];
          break;
        case 'create':
          name = args[args.indexOf('--name') + 1]!;
          break;
        case 'inspect':
          value = {
            name,
            workspace,
            agent: 'shell',
            image_digest: kind === 'wrong image' ? 'another' : digest,
            mcp_mode: 'static',
            mcp_servers: kind === 'MCP server' ? ['one'] : [],
            published_ports: kind === 'published port' ? ['123'] : [],
            runtime_mounts: [],
            kits: [kind === 'wrong kit' ? 'other' : p.shellKit],
            host_mounts: [
              { host_path: workspace, container_target: workspace, read_only: false },
              ...(kind === 'extra mount' ? [{}] : []),
            ],
          };
          break;
        case 'policy':
          if (args[1] === 'ls')
            value = {
              rules: [
                {
                  decision: kind === 'extra allow' ? 'allow' : 'deny',
                  scope: 'sandbox:' + name,
                  status: 'active',
                  resource_type: 'network',
                  resources: ['**'],
                  actions: ['net:connect:tcp', 'net:connect:udp'],
                  id: 'deny',
                },
              ],
            };
          else {
            const proto = args.at(-2)!;
            code = kind === 'live ' + proto.toUpperCase() + ' route' ? 0 : 1;
            value = {
              allowed: code === 0,
              context: 'sandbox:' + name,
              deny_kind: 'explicit',
              rule: 'local:deny',
              action: 'net:connect:' + proto,
            };
          }
          break;
        case 'exec':
          code = kind === 'writable socket' ? 1 : 0;
          break;
        case 'cp':
          staged++;
          break;
        case 'rm':
          removed++;
          if (kind !== 'incomplete removal') name = '';
          break;
        default:
          assert.fail();
      }
      return { code, stdout: JSON.stringify(value ?? null) };
    };
    const work = withSbxVm(
      workspace,
      p,
      10,
      async (vm) => {
        await vm.copy('source', 'target');
      },
      command,
    );
    if (kind === 'verified') await work;
    else await assert.rejects(work);
    assert.equal(staged, times);
    assert.equal(removed, 1);
  },
);

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
    const raw = JSON.stringify({
      build: { provider: 'openai', model, effort: 'medium', limitSeconds: 180 },
      checks: [{ name: 'patch', command: ['test', '-f', 'result.txt'], limitSeconds: 30 }],
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
      assert.equal(record.sessions[0].provider, 'openai');
      assert.equal(record.sessions[0].model, model);
      assert.equal(record.sessions[0].costUsd, null);
      assert.equal(record.reviews[0].verdict, 'accept');
      assert.equal(record.sessions[1].role, 'review');
      assert.equal(record.sessions[0].client.version, committed().clientVersion);
      assert.deepEqual(record.sessions[0].usage, { inputTokens: 10, outputTokens: 6 });
      assert.equal(record.sessions[0].responses.length, 2);
    } finally {
      rmSync(runtime, { recursive: true, force: true });
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
