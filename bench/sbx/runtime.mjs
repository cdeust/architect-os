import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';

import isolation from './isolation.json' with { type: 'json' };
import { exchangeFrames } from './exchange.mjs';
import { frameByteLimit as pipeLimit } from './json-frame.mjs';
import { runOfflineProbe, stopOwnedVm, useUntilInterrupted, withProbeSignals } from './lifecycle.mjs';

const kit = isolation.shellImage;
const digest = kit.split('@')[1];

// The terminal can signal an entire foreground process group. Only the host owns
// cancellation of CLI operations; in particular create, stop and confirmation must settle.
function spawnSbx(args) {
  const { HOME, PATH, TMPDIR } = process.env;
  return spawn('sbx', ['--no-input', ...args], {
    detached: true,
    env: { HOME, PATH, TMPDIR },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function readPipe(stream) {
  const chunks = [];
  let length = 0;
  for await (const bytes of stream) {
    length += bytes.length;
    if (length > pipeLimit) throw Error('SBX_PROCESS_OUTPUT_LIMIT');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function command(args, timeout, input, signal) {
  signal?.throwIfAborted();
  const child = spawnSbx(args);
  const closed = new Promise((resolve) => child.once('close', resolve));
  const { promise: failed, reject: rejectProcess } = Promise.withResolvers();
  const interrupt = () => rejectProcess(signal.reason);
  signal?.addEventListener('abort', interrupt, { once: true });
  const deadline = setTimeout(() => rejectProcess(Error('SBX_PROCESS_FAILED')), timeout);
  child.once('error', () => rejectProcess(Error('SBX_PROCESS_FAILED')));
  child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') rejectProcess(Error('SBX_PROCESS_FAILED'));
  });
  try {
    child.stdin.end(input);
    const [code, stdout, stderr] = await Promise.race([
      failed,
      Promise.all([closed, readPipe(child.stdout), readPipe(child.stderr)]),
    ]);
    if (code === null) throw Error('SBX_PROCESS_FAILED');
    return { code, stdout, stderr };
  } catch (error) {
    child.kill('SIGKILL');
    for (const stream of child.stdio) stream.destroy();
    await closed;
    throw error;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', interrupt);
  }
}

async function checked(args, timeout, signal) {
  const result = await command(args, timeout, undefined, signal);
  if (result.code !== 0) throw Error('SBX_' + args[0].toUpperCase() + '_FAILED (' + result.code + ')');
  return result.stdout;
}

// Native 0.54.0 inspect and policy responses. Fail closed if the backend changes shape.
async function requireOfflinePolicy(name, limitMs, signal) {
  const scope = 'sandbox:' + name;
  const { rules } = JSON.parse(
    await checked(['policy', 'ls', name, '--json', '--type', 'network'], limitMs, signal),
  );
  if (!Array.isArray(rules) || rules.some((rule) => rule.decision !== 'deny')) {
    throw Error('SBX_NETWORK_POLICY_MISMATCH');
  }
  const deny = rules.find(
    (rule) =>
      rule.scope === scope &&
      rule.status === 'active' &&
      rule.resource_type === 'network' &&
      rule.resources.includes('**') &&
      ['net:connect:tcp', 'net:connect:udp'].every((action) => rule.actions.includes(action)),
  );
  if (!deny) throw Error('SBX_DENY_ALL_REQUIRED');
  for (const protocol of ['tcp', 'udp']) {
    const result = await command(
      ['policy', 'check', 'network', '--sandbox', name, '--json', '--protocol', protocol, 'example.com:443'],
      limitMs,
      undefined,
      signal,
    );
    if (result.code !== 1) throw Error('SBX_NETWORK_DECISION_MISMATCH');
    const decision = JSON.parse(result.stdout);
    if (
      decision.allowed !== false ||
      decision.context !== scope ||
      decision.deny_kind !== 'explicit' ||
      decision.rule !== 'local:' + deny.id ||
      decision.action !== 'net:connect:' + protocol
    ) {
      throw Error('SBX_NETWORK_DECISION_MISMATCH');
    }
  }
}

/** A disposable offline probe. Its only host mount is the synthetic workspace created here. */
export function withOfflineSbx(options, use) {
  return withProbeSignals((signal) => scopedProbe(options, use, signal));
}

async function scopedProbe({ limitMs, prepare, verify }, use, signal) {
  requireAdmittedRun();
  if (!Number.isSafeInteger(limitMs) || limitMs < 1) throw Error('SBX_LIMIT_REQUIRED');
  const cliVersion = (await checked(['--version'], limitMs, signal)).trim();
  if (cliVersion !== 'sbx version v0.54.0 4bec4a5ce093466e54b034146965b143d065dc09') {
    throw Error('SBX_PINNED_CLI_REQUIRED');
  }
  const templates = JSON.parse(await checked(['template', 'ls', '--json'], limitMs, signal));
  const template = templates.find(
    (item) => item.flavor === 'shell' && item.digest === digest && item.id === digest,
  );
  if (!template) throw Error('SBX_PINNED_SHELL_REQUIRED');
  const name = 'aos-b0-' + randomUUID();
  const workspace = await mkdtemp(join(await realpath(tmpdir()), 'sbx-witness-'));
  const names = async (signal) =>
    JSON.parse(await checked(['ls', '--json'], limitMs, signal)).map((item) => item.name);
  let creation = 'unused';
  async function run() {
    if (prepare) await prepare(workspace, signal);
    if ((await names(signal)).includes(name)) throw Error('SBX_NAME_IN_USE');
    signal.throwIfAborted();
    creation = 'requested';
    // Do not interrupt an in-flight creation. A prematurely cancelled RPC might create
    // the VM after the host has listed it as absent and unlinked its mount.
    await checked(
      [
        'create',
        '--name',
        name,
        '--skills',
        'off',
        '--static-mcp',
        'none',
        '--pull',
        'never',
        '--deny-network',
        '**',
        '--template',
        template.repository + ':' + template.tag,
        kit,
        workspace,
      ],
      limitMs,
    );
    creation = 'acknowledged';
    const observed = JSON.parse(await checked(['inspect', '--json', name], limitMs, signal));
    const mounts = observed.host_mounts;
    if (
      observed.name !== name ||
      observed.mcp_mode !== 'static' ||
      !Array.isArray(observed.mcp_servers) ||
      observed.mcp_servers.length !== 0 ||
      (observed.published_ports !== undefined &&
        (!Array.isArray(observed.published_ports) || observed.published_ports.length !== 0)) ||
      observed.kits.length !== 1 ||
      observed.kits[0] !== kit ||
      observed.workspace !== workspace ||
      mounts.length !== 1 ||
      mounts[0].host_path !== workspace ||
      mounts[0].container_target !== workspace ||
      mounts[0].read_only !== false ||
      !Array.isArray(observed.runtime_mounts) ||
      observed.runtime_mounts.length !== 0
    ) {
      throw Error('SBX_FIXTURE_BINDING_MISMATCH');
    }
    await requireOfflinePolicy(name, limitMs, signal);
    // Run the access check as the client identity before either pinned client is staged.
    await checked(
      [
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
        isolation.forbiddenHostSocket,
      ],
      limitMs,
      signal,
    );
    return useUntilInterrupted(signal, limitMs, (start, activeSignal) =>
      use({
        workspace,
        signal: activeSignal,
        copyIn(source, destination) {
          return start(() => checked(['cp', '--', source, name + ':' + destination], limitMs, activeSignal));
        },
        exec(args, { user = '65534:65534', cwd = workspace, input } = {}) {
          return start(() =>
            command(
              [
                'exec',
                ...(input === undefined ? [] : ['-i']),
                '--user',
                user,
                '-w',
                cwd,
                '--',
                name,
                ...args,
              ],
              limitMs,
              input,
              activeSignal,
            ),
          );
        },
        execExchange(args, initialObject, onRequest) {
          return start(() => {
            const child = spawnSbx([
              'exec',
              '-i',
              '--user',
              '65534:65534',
              '-w',
              workspace,
              '--',
              name,
              ...args,
            ]);
            return exchangeFrames(child, initialObject, onRequest, limitMs, activeSignal);
          });
        },
      }),
    );
  }
  function stop() {
    return stopOwnedVm(name, creation, names, (owned) => checked(['rm', '--force', owned], limitMs));
  }
  return runOfflineProbe({ name, workspace, run, stop, verify, signal });
}
