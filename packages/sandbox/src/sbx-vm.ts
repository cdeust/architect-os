import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { SbxNetwork } from './responses-http.js';
import { requireAdmittedRun } from './runtime-context.js';

export const sbxPolicySchema = z.strictObject({
  shellKit: z.string().regex(/^docker\.io\/sbx\/shell@sha256:[0-9a-f]{64}$/),
  shellTemplate: z.string().regex(/^docker\.io\/library\/sandbox-kit-assembled@sha256:[0-9a-f]{64}$/),
  forbiddenHostSocket: z.literal('/var/run/docker.sock'),
  cliVersion: z.string().min(1),
  archive: z.string().regex(/^codex-[\d.]+-linux-arm64\.tgz$/),
  archiveSha512: z.string().length(88),
  clientVersion: z.string().min(1),
  clientSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SbxPolicy = z.infer<typeof sbxPolicySchema>;
export type SbxCommand = (args: string[], signal: AbortSignal) => Promise<{ code: number; stdout: string }>;
const maxBuffer = 1024 * 1024; // SBX bench limit on a CLI reply.
function executable() {
  const path = ['/opt/homebrew/bin/sbx', '/usr/local/bin/sbx', '/usr/bin/sbx'].find(existsSync);
  if (!path) throw Error('SBX_CLI_REQUIRED');
  return path;
}
function environment() {
  const { HOME, TMPDIR } = process.env;
  return { HOME, TMPDIR, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' };
}
const nativeCommand: SbxCommand = async (args, signal) => {
  const binary = executable();
  try {
    const { stdout } = await promisify(execFile)(binary, ['--no-input', ...args], {
      cwd: '/',
      env: environment(),
      signal,
      killSignal: 'SIGKILL',
      maxBuffer,
    });
    return { code: 0, stdout };
  } catch (e) {
    const failure = e as { code: unknown; stdout: unknown };
    if (!signal.aborted && typeof failure.code === 'number' && typeof failure.stdout === 'string')
      return { code: failure.code, stdout: failure.stdout };
    throw Error('SBX_COMMAND_FAILED');
  }
};
// A host hard link can make an apparently local write modify a second pathname outside the mount.
export function checkSbxWorktree(root: string) {
  if (realpathSync(root) !== root) throw Error('SBX_WORKTREE');
  function visit(dir: string) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      const stat = lstatSync(file);
      if (stat.isDirectory()) visit(file);
      else if (!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink !== 1))
        throw Error('SBX_WORKTREE_ENTRY');
    }
  }
  visit(root);
}
export const guestEndpoints = { host: 'host.docker.internal', gateway: 'gateway.docker.internal' } as const;
// A 401 comes from our live proxy on the permitted route. The other requests must be refused by the VM policy.
const networkCanary = `import os, shutil, sys, urllib.error, urllib.request
if shutil.which("sbx") or os.access("/var/run/docker.sock", os.W_OK): sys.exit(1)
for method, url, expected in [
 ("POST", "http://${guestEndpoints.host}:"+sys.argv[1]+"/v1/responses", 401),
 ("GET", "http://${guestEndpoints.host}:"+sys.argv[1]+"/v1/responses", 403),
 ("POST", "http://${guestEndpoints.host}:"+sys.argv[1]+"/unlisted", 403),
 ("POST", "http://${guestEndpoints.host}:"+sys.argv[2]+"/v1/responses", 403),
 ("GET", "http://example.com/", 403)]:
 try:
  with urllib.request.urlopen(urllib.request.Request(url, method=method)) as r: status=r.status
 except urllib.error.HTTPError as e: status=e.code
 if status!=expected: sys.exit(1)
`;
export interface SbxVm {
  name: string;
  signal: AbortSignal;
  copy(from: string, to: string): Promise<void>;
  setup(args: string[]): Promise<void>;
  pipes(args: string[]): ChildProcessWithoutNullStreams;
}
export class SbxInterrupted extends Error {
  constructor(readonly vm: string) {
    super('SBX_INTERRUPTED');
  }
}
export async function withSbxVm<T>(
  workspace: string,
  policy: SbxPolicy,
  seconds: number,
  network: SbxNetwork & { allowRegistry: boolean },
  use: (vm: SbxVm) => Promise<T>,
  command: SbxCommand = nativeCommand,
) {
  requireAdmittedRun();
  if (workspace !== resolve(workspace) || workspace.includes(':')) throw Error('SBX_WORKTREE');
  const limit = seconds * 1000;
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(limit)]);
  const interrupt = () => stop.abort();
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
  const checked = async (args: string[], s = signal) => {
    const r = await command(args, s);
    if (r.code !== 0) throw Error('SBX_' + args[0]!.toUpperCase() + '_FAILED');
    return r.stdout;
  };
  const name = 'aos-build-' + randomUUID();
  const names = async (s: AbortSignal) =>
    z
      .array(z.object({ name: z.string() }))
      .parse(JSON.parse(await checked(['ls', '--json'], s)))
      .map((v) => v.name);
  let requested = false,
    created = false;
  for (const sig of signals) process.on(sig, interrupt);
  try {
    if ((await checked(['--version'])).trim() !== policy.cliVersion) throw Error('SBX_VERSION');
    const image = policy.shellTemplate.split('@')[1];
    const templates = z
      .array(z.object({ repository: z.string(), flavor: z.string(), digest: z.string(), id: z.string() }))
      .parse(JSON.parse(await checked(['template', 'ls', '--all', '--json'])));
    const template = templates.find(
      (t) =>
        t.flavor === 'shell' &&
        t.digest === image &&
        t.id === image &&
        [policy.shellKit, policy.shellTemplate].includes(t.repository + '@' + image),
    );
    if (!template) throw Error('SBX_TEMPLATE');
    if ((await names(signal)).includes(name)) throw Error('SBX_NAME_IN_USE');
    requested = true;
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
        '--template',
        template.repository + '@' + image,
        policy.shellKit,
        workspace,
      ],
      AbortSignal.timeout(limit),
    );
    created = true;
    const spec = JSON.parse(await checked(['inspect', '--json', name]));
    const mount = z.object({
      host_path: z.literal(workspace),
      container_target: z.literal(workspace),
      read_only: z.literal(false),
    });
    z.object({
      name: z.literal(name),
      workspace: z.literal(workspace),
      agent: z.literal('shell'),
      image_digest: z.literal(image!),
      mcp_mode: z.literal('static'),
      mcp_servers: z.tuple([]),
      published_ports: z.tuple([]).optional(),
      runtime_mounts: z.tuple([]),
      kits: z.tuple([z.literal(policy.shellKit)]),
      host_mounts: z.tuple([mount]),
    }).parse(spec);
    const scope = 'sandbox:' + name;
    const host = 'localhost:' + network.port,
      registry = 'registry.npmjs.org:443';
    await checked([
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
    ]);
    if (network.allowRegistry) await checked(['policy', 'allow', 'network', '--sandbox', name, registry]);
    async function rules(type: string) {
      const raw = await checked(['policy', 'ls', name, '--json', '--type', type]);
      return z
        .object({ rules: z.array(z.looseObject({ decision: z.enum(['allow', 'deny']) })) })
        .parse(JSON.parse(raw)).rules;
    }
    async function attestRules() {
      const net = await rules('network');
      const http = await rules('http');
      const fallback = z.object({
        id: z.literal('default-deny-all'),
        scope: z.literal('global'),
        decision: z.literal('deny'),
        status: z.literal('active'),
        resource_type: z.literal('network'),
        resources: z.tuple([z.literal('**')]),
        actions: z
          .array(z.string())
          .refine((actions) => actions.includes('net:connect:tcp') && actions.includes('net:connect:udp')),
      });
      const scoped = { scope: z.literal(scope), status: z.literal('active') };
      const npm = z.object({
        ...scoped,
        resource_type: z.literal('network'),
        resources: z.tuple([z.literal(registry)]),
        actions: z.tuple([z.literal('net:connect:tcp')]),
      });
      const post = z.object({
        ...scoped,
        resource_type: z.literal('http'),
        resources: z.tuple([z.literal(host)]),
        methods: z.tuple([z.literal('POST')]),
        actions: z.tuple([z.literal('http:request:post')]),
        http_targets: z.tuple([z.strictObject({ host: z.literal(host), path: z.literal('/v1/responses') })]),
      });
      if (
        !net.some((rule) => fallback.safeParse(rule).success) ||
        !(network.allowRegistry ? z.tuple([npm]) : z.tuple([])).safeParse(
          net.filter((r) => r.decision === 'allow'),
        ).success ||
        !z.tuple([post]).safeParse(http.filter((r) => r.decision === 'allow')).success
      )
        throw Error('SBX_NETWORK_POLICY');
    }
    await attestRules();
    for (const [proto, target] of [
      ['tcp', 'example.com:443'],
      ['udp', 'example.com:443'],
      ['tcp', 'localhost:' + network.deniedPort],
    ] as const) {
      const r = await command(
        ['policy', 'check', 'network', '--sandbox', name, '--json', '--protocol', proto, target],
        signal,
      );
      if (r.code !== 1) throw Error('SBX_NETWORK_ROUTE');
      z.object({
        allowed: z.literal(false),
        context: z.literal(scope),
        deny_kind: z.enum(['implicit', 'explicit']),
        action: z.literal('net:connect:' + proto),
      }).parse(JSON.parse(r.stdout));
    }
    const guest = ['--user', '65534:65534', '-w', workspace, '--', name];
    await checked(['exec', ...guest, '/usr/bin/test', '!', '-w', policy.forbiddenHostSocket]);
    await checked([
      'exec',
      ...guest,
      '/usr/bin/python3',
      '-I',
      '-c',
      networkCanary,
      String(network.port),
      String(network.deniedPort),
    ]);
    const result = await use({
      name,
      signal,
      copy: async (from, to) => {
        await checked(['cp', '--', from, name + ':' + to]);
      },
      setup: async (args) => {
        await checked(['exec', '--user', '0:0', '-w', '/', '--', name, ...args]);
      },
      pipes: (args) =>
        spawn(executable(), ['--no-input', 'exec', '-i', ...guest, ...args], {
          cwd: '/',
          env: environment(),
          signal,
          killSignal: 'SIGKILL',
          stdio: 'pipe',
        }),
    });
    signal.throwIfAborted();
    await attestRules();
    return { name, result };
  } catch (error) {
    if (created && signal.aborted) throw new SbxInterrupted(name);
    throw error;
  } finally {
    try {
      stop.abort();
      if (requested) {
        const cleanup = AbortSignal.timeout(limit);
        if ((await names(cleanup)).includes(name)) await checked(['rm', '--force', name], cleanup);
        else if (!created) throw Error('SBX_CREATE_UNCONFIRMED ' + name);
        if ((await names(cleanup)).includes(name)) throw Error('SBX_CLEANUP_INCOMPLETE ' + name);
      }
    } finally {
      for (const sig of signals) process.off(sig, interrupt);
    }
  }
}
