import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';

import isolation from './isolation.json' with { type: 'json' };

const kit = isolation.shellImage;
const digest = kit.split('@')[1];

function command(args, timeout, input) {
  const { HOME, PATH, TMPDIR } = process.env;
  return new Promise((resolve, reject) => {
    const child = execFile(
      'sbx',
      ['--no-input', ...args],
      {
        env: { HOME, PATH, TMPDIR },
        timeout,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number')
          reject(new Error('SBX_PROCESS_FAILED', { cause: new Error(String(error.code ?? error.signal)) }));
        else resolve({ code: error?.code ?? 0, stdout, stderr });
      },
    );
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
  });
}

async function checked(args, timeout) {
  const result = await command(args, timeout);
  if (result.code !== 0) throw Error('SBX_' + args[0].toUpperCase() + '_FAILED (' + result.code + ')');
  return result.stdout;
}

// Native 0.54.0 inspect and policy responses. Fail closed if the backend changes shape.
async function requireOfflinePolicy(name, limitMs) {
  const scope = 'sandbox:' + name;
  const { rules } = JSON.parse(await checked(['policy', 'ls', name, '--json', '--type', 'network'], limitMs));
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
export async function withOfflineSbx({ limitMs, prepare }, use) {
  requireAdmittedRun();
  if (!Number.isSafeInteger(limitMs) || limitMs < 1) throw Error('SBX_LIMIT_REQUIRED');
  const cliVersion = (await checked(['--version'], limitMs)).trim();
  if (cliVersion !== 'sbx version v0.54.0 4bec4a5ce093466e54b034146965b143d065dc09') {
    throw Error('SBX_PINNED_CLI_REQUIRED');
  }
  const templates = JSON.parse(await checked(['template', 'ls', '--json'], limitMs));
  const template = templates.find(
    (item) => item.flavor === 'shell' && item.digest === digest && item.id === digest,
  );
  if (!template) throw Error('SBX_PINNED_SHELL_REQUIRED');
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'sbx-witness-')));
  const name = 'aos-b0-' + randomUUID();
  const names = async () => JSON.parse(await checked(['ls', '--json'], limitMs)).map((item) => item.name);
  let creating = false;
  try {
    if (prepare) await prepare(workspace);
    if ((await names()).includes(name)) throw Error('SBX_NAME_IN_USE');
    creating = true;
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
    const observed = JSON.parse(await checked(['inspect', '--json', name], limitMs));
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
    await requireOfflinePolicy(name, limitMs);
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
    );
    return await use({
      workspace,
      copyIn(source, destination) {
        return checked(['cp', '--', source, name + ':' + destination], limitMs);
      },
      exec(args, { user = '65534:65534', cwd = workspace, input } = {}) {
        return command(
          ['exec', ...(input === undefined ? [] : ['-i']), '--user', user, '-w', cwd, '--', name, ...args],
          limitMs,
          input,
        );
      },
    });
  } finally {
    if (creating && (await names()).includes(name)) {
      await checked(['rm', '--force', name], limitMs);
      if ((await names()).includes(name)) throw Error('SBX_CLEANUP_INCOMPLETE: ' + name);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}
