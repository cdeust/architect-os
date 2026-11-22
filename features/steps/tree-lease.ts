import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readGateReceipt } from '@architect-os/sandbox/gate-receipt';
import { publishCheckedGate } from '../../tools/test-gate/src/infrastructure/locked-command.js';
import { GateConfigSchema } from '../../tools/test-gate/src/infrastructure/config.js';
import { Workspace } from '../../tools/test-gate/src/infrastructure/workspace.js';
import {
  changeReplayFile,
  clearGateReceipt,
  requireCheckedCommit,
  restoreReplayFile,
  runGateWithLease,
} from '../../tools/test-gate/src/infrastructure/tree-lease.js';
import { Then } from './helpers.js';

const sha = 'a'.repeat(40);
const adapters: Record<string, () => unknown> = {
  local: () => runGateWithLease('local', ['check', '--job', 'linux']),
  hosted: () => runGateWithLease('hosted', ['verify', '7']),
  begin: () => changeReplayFile('src/file', 'before', 'after'),
  restore: restoreReplayFile,
  discard: clearGateReceipt,
  verify: () => requireCheckedCommit(sha),
};
type Call = {
  program: string;
  args: string[];
  options: { env: NodeJS.ProcessEnv; stdio: unknown[]; input?: string };
};
function withNative(result: unknown, action: (calls: Call[]) => void) {
  const calls: Call[] = [];
  const mocked = mock.method(
    childProcess,
    'spawnSync',
    (program: string, args: string[], options: Call['options']) => {
      calls.push({ program, args, options });
      return result;
    },
  );
  syncBuiltinESMExports();
  try {
    action(calls);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
}
function withDescriptor(value: string | undefined, action: () => void) {
  const saved = process.env.AOS_GATE_LEASE_FD;
  try {
    if (value === undefined) delete process.env.AOS_GATE_LEASE_FD;
    else process.env.AOS_GATE_LEASE_FD = value;
    action();
  } finally {
    if (saved === undefined) delete process.env.AOS_GATE_LEASE_FD;
    else process.env.AOS_GATE_LEASE_FD = saved;
  }
}
Then('the native Gate adapter performs {string} through the fixed interpreter', function (kind: string) {
  const fd = openSync(tmpdir(), 'r');
  try {
    for (const inherited of [false, true])
      withDescriptor(inherited ? String(fd) : undefined, () =>
        withNative({ status: 0 }, (calls) => {
          const result = adapters[kind]!();
          assert.equal(calls.length, 1);
          const { program, args, options } = calls[0]!;
          assert.equal(program, '/usr/bin/python3');
          assert.equal(args[0], '-I');
          assert.ok(args[1]!.endsWith('/tools/test-gate/with-tree-lock.py'));
          assert.equal(options.env.AOS_GATE_LEASE_FD, inherited ? '3' : undefined);
          assert.equal(options.env.PATH, process.env.PATH);
          assert.deepEqual(options.stdio, [
            kind === 'begin' ? 'pipe' : 'inherit',
            'inherit',
            'inherit',
            ...(inherited ? [fd] : []),
          ]);
          assert.equal(
            options.input,
            kind === 'begin'
              ? JSON.stringify({ file: 'src/file', source: 'before', mutated: 'after' })
              : undefined,
          );
          if (kind === 'hosted' || kind === 'local') {
            assert.equal(result, 0);
            const entry = new URL('../../tools/test-gate/src/infrastructure/locked-command.ts', import.meta.url).href;
            assert.deepEqual(args.slice(2), [
              'exec',
              process.execPath,
              '--import',
              import.meta.resolve('tsx'),
              '--input-type=module',
              '-e',
              'import {runLocked} from ' +
                JSON.stringify(entry) +
                ';process.exitCode = await runLocked(' +
                JSON.stringify(kind) +
                ', process.argv.slice(1));',
              '--',
              ...(kind === 'hosted' ? ['verify', '7'] : ['check', '--job', 'linux']),
            ]);
          } else assert.deepEqual(args.slice(2), kind === 'verify' ? ['verify', sha] : [kind]);
        }),
      );
  } finally {
    closeSync(fd);
  }
});
Then('the native Gate adapter refuses {string}', function (kind: string) {
  if (kind === 'invalid descriptor') {
    withDescriptor('bogus', () =>
      withNative({ status: 0 }, () => assert.throws(() => adapters.local!(), /GATE_ACTIVE_LEASE_REQUIRED/)),
    );
    return;
  }
  if (kind === 'non-directory') {
    const fd = openSync(fileURLToPath(import.meta.url), 'r');
    try {
      withDescriptor(String(fd), () =>
        withNative({ status: 0 }, (calls) => {
          assert.throws(() => adapters.local!(), /GATE_ACTIVE_LEASE_REQUIRED/);
          assert.equal(calls.length, 0);
        }),
      );
    } finally {
      closeSync(fd);
    }
    return;
  }
  withDescriptor(undefined, () =>
    withNative(
      kind === 'spawn' ? { error: new Error('SPAWN_DENIED') } : { status: kind === 'signal' ? null : 17 },
      () => {
        if (kind === 'signal') {
          assert.equal(adapters.local!(), 1);
          return;
        }
        if (kind === 'spawn') {
          assert.throws(() => adapters.local!(), /SPAWN_DENIED/);
          return;
        }
        const codes: Record<string, string> = {
          begin: 'GATE_MUTATION_REFUSED',
          restore: 'GATE_RESTORATION_REFUSED',
          discard: 'GATE_RECEIPT_INVALIDATION_FAILED',
          verify: 'GATE_RECEIPT_TREE_CHANGED',
        };
        assert.throws(adapters[kind]!, new RegExp(codes[kind]!));
      },
    ),
  );
});
Then('the receipt publisher exercises {string} in a private Git checkout', function (kind: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'publish-'))),
    tree = join(root, 'checkout'),
    run = join(root, 'run', 'r123AbC');
  for (const path of [tree, run, join(root, 'state')]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const config = GateConfigSchema.parse(
    JSON.parse(readFileSync(new URL('../../tools/test-gate/gate.json', import.meta.url), 'utf8')),
  );
  if (kind === 'no linux job') delete config.jobs.linux;
  if (kind === 'mutation off') config.jobs.linux!.mutation = false;
  if (kind === 'no canary') delete config.canary;
  if (kind === 'no replay') delete config.replay;
  const work = new Workspace(tree);
  if (kind !== 'no plan')
    work.write(
      config.reports.plan,
      JSON.stringify({
        job: kind === 'macos plan' ? 'macos' : 'linux',
        head: kind === 'wrong type' ? 123 : kind === 'missing head' ? undefined : sha,
      }),
    );
  if (kind !== 'no markdown')
    work.write(config.reports.report, '# Porte de test, job linux : VERTE\n- tête : ' + sha + '\n');
  if (kind !== 'no base')
    work.write(config.reports.baseOut, JSON.stringify({ job: 'linux', sha, count: 1, pickles: ['one'] }));
  const previous = process.cwd(),
    oldRoot = process.env.ARCHITECT_OS_RUNTIME_ROOT,
    oldRun = process.env.ARCHITECT_OS_RUN_DIR;
  try {
    process.chdir(tree);
    process.env.ARCHITECT_OS_RUNTIME_ROOT = root;
    process.env.ARCHITECT_OS_RUN_DIR = run;
    withDescriptor(undefined, () =>
      withNative({ status: kind === 'wrong HEAD' ? 1 : 0 }, (calls) => {
        if (kind === 'linux') {
          publishCheckedGate(config, work);
          assert.equal(readGateReceipt(root, tree), sha);
          assert.equal(calls.length, 1);
          assert.deepEqual(calls[0]!.args.slice(2), ['verify', sha]);
        } else {
          const policy = ['mutation off', 'no linux job', 'no replay', 'no canary'].includes(kind),
            plan = ['no plan', 'macos plan', 'missing head', 'wrong type'].includes(kind);
          assert.throws(
            () => publishCheckedGate(config, work),
            policy
              ? /GATE_RECEIPT_POLICY_INVALID/
              : plan
                ? /GATE_RECEIPT_PLAN_REQUIRED/
                : kind === 'wrong HEAD'
                  ? /GATE_RECEIPT_TREE_CHANGED/
                  : kind === 'no markdown'
                    ? /GATE_RECEIPT_PROOF_INVALID/
                    : /JSON/,
          );
          assert.equal(calls.length, policy || plan ? 0 : 1);
          assert.equal(readGateReceipt(root, tree), undefined);
        }
      }),
    );
  } finally {
    process.chdir(previous);
    process.env.ARCHITECT_OS_RUNTIME_ROOT = oldRoot;
    process.env.ARCHITECT_OS_RUN_DIR = oldRun;
    rmSync(root, { recursive: true, force: true });
  }
});
