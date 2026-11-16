import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { NativeProcess, SandboxMeans } from '@architect-os/sandbox';
import type { TopologyFiles } from './topology-files.js';

/** What the process entry needs of its environment (docs/design/platform-v3-srt.md, §8, 1b.6a). */
export interface NativeConfig {
  /** The clients: token to subject. */
  tokens: Map<string, string>;
  port: number;
  quotaPerMinute: number;
  /** The client profile of the tasks: the topology says whether it exists (composeNative). */
  profile: string;
  /** The port of the broker, read from the file the broker is given. */
  brokerPort: number;
  files: TopologyFiles;
  /** How the modules and the workers are isolated: chosen by the operator, never detected. */
  sandbox: SandboxMeans;
  /** The closed list of `NativeLauncher`. */
  processes: { data: NativeProcess; broker: NativeProcess };
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * A refusal names the variable and what is expected of it, and never its value: a token or a database URL must not
 * reach a log. A plain Error: a configuration that is refused never reaches a client.
 */
const refusal = (variable: string, expected: string): Error => new Error(`${variable} must be ${expected}`);

/** A variable that must be there; its text, whatever it holds. */
function required(env: Env, variable: string, expected: string): string {
  const value = env[variable];
  if (value === undefined || value === '') throw refusal(variable, expected);
  return value;
}

/** A positive integer in its one spelling (digits, no sign, no leading zero, no blank), or NaN. */
const whole = (text: string): number => (/^[1-9]\d*$/.test(text) ? Number(text) : NaN);

const DOCKER_VARIABLES = [
  'GATEWAY_DOCKER_IMAGE',
  'GATEWAY_DOCKER_NODE',
  'GATEWAY_DOCKER_MEMORY_MIB',
  'GATEWAY_DOCKER_PIDS',
  'GATEWAY_DOCKER_CHECK_MS',
] as const;

/** A required whole number of at least 1, a safe integer: one that a number holds exactly, and its neighbours too. */
function count(env: Env, variable: string): number {
  const expected = 'an integer of at least 1';
  const value = whole(required(env, variable, expected));
  if (!Number.isSafeInteger(value)) throw refusal(variable, expected);
  return value;
}

/**
 * The means of isolation, written by the operator: `srt`, or `docker` with its image and its bounds. What is asked and
 * cannot be given is refused: a Docker variable beside `srt` is not left out in silence. The rules of the Docker options
 * (digest, least memory, path of node) are those of the adapter, which refuses them in its own words.
 */
function sandboxOf(env: Env): SandboxMeans {
  const means = env['GATEWAY_SANDBOX'];
  if (means === 'srt') {
    for (const variable of DOCKER_VARIABLES)
      if (env[variable] !== undefined) throw refusal(variable, 'absent when GATEWAY_SANDBOX is srt');
    return { means };
  }
  if (means !== 'docker') throw refusal('GATEWAY_SANDBOX', 'srt or docker');
  return {
    means,
    image: required(env, 'GATEWAY_DOCKER_IMAGE', 'the image of the sandboxes, name@sha256:<digest>'),
    node: required(env, 'GATEWAY_DOCKER_NODE', 'the absolute path of node in the image'),
    memoryMiB: count(env, 'GATEWAY_DOCKER_MEMORY_MIB'),
    pidsLimit: count(env, 'GATEWAY_DOCKER_PIDS'),
    checkTimeoutMs: count(env, 'GATEWAY_DOCKER_CHECK_MS'),
  };
}

/**
 * One client: a bearer token as RFC 6750 writes it (letters, digits and `-._~+/`, then `=` only at its end, as
 * base64 pads), `=`, a subject without blank or `=`. The pair is cut at its last `=`.
 */
const PAIR = /^([A-Za-z0-9._~+/-]+=*)=([^\s=]+)$/;

/** A token a client presents on every call is a secret: a short one is guessed. */
const TOKEN_LENGTH = 32;

function tokensOf(env: Env): Map<string, string> {
  const expected =
    "token=subject pairs separated by ';': a token of at least 32 characters among letters, digits and -._~+/ " +
    'with = only at its end, a subject without blank or =, no token twice';
  const tokens = new Map<string, string>();
  for (const pair of required(env, 'GATEWAY_TOKENS', expected).split(';')) {
    const found = PAIR.exec(pair);
    if (found === null || found[1]!.length < TOKEN_LENGTH || tokens.has(found[1]!))
      throw refusal('GATEWAY_TOKENS', expected);
    tokens.set(found[1]!, found[2]!);
  }
  return tokens;
}

/**
 * The `port` of the JSON file the broker is given, within the bounds the broker itself accepts
 * (modules/broker/src/infrastructure/config.ts): the broker validates the rest of its file.
 */
function brokerPortOf(env: Env): number {
  const expected = 'the absolute path of a JSON file with a port, an integer from 1024 to 65535';
  const path = required(env, 'BROKER_CONFIG', expected);
  if (!isAbsolute(path)) throw refusal('BROKER_CONFIG', expected);
  try {
    const port = (JSON.parse(readFileSync(path, 'utf8')) as { port?: unknown }).port;
    if (Number.isInteger(port) && (port as number) >= 1024 && (port as number) <= 65535)
      return port as number;
  } catch {
    // A file that cannot be read or parsed is refused below, in the same words: nothing of it reaches a message.
  }
  throw refusal('BROKER_CONFIG', expected);
}

/**
 * What data is given: its `DATABASE_URL`, or nothing when the operator chose `memory`, the store that keeps nothing
 * across a restart. The choice is explicit: data falls back to that store on its own when it gets no URL.
 */
function dataEnvOf(env: Env): Record<string, string> {
  const expected = 'a postgres:// or postgresql:// URL, or memory for a store that keeps nothing';
  const url = required(env, 'DATABASE_URL', expected);
  if (url === 'memory') return {};
  if (!/^postgres(ql)?:\/\//.test(url)) throw refusal('DATABASE_URL', expected);
  return { DATABASE_URL: url };
}

/** What the broker is given: its configuration, and the authority file of the operator when there is one. */
function brokerEnvOf(env: Env): Record<string, string> {
  const authority = env['NODE_EXTRA_CA_CERTS'];
  const config = { BROKER_CONFIG: env['BROKER_CONFIG']! };
  if (authority === undefined) return config;
  if (!isAbsolute(authority))
    throw refusal('NODE_EXTRA_CA_CERTS', 'the absolute path of a certificate file, or absent');
  return { ...config, NODE_EXTRA_CA_CERTS: authority };
}

/**
 * Reads the configuration of the native gateway from its environment; launches nothing. `root` is the absolute
 * platform root, `node` the absolute path of the interpreter of the children (the entry passes `process.execPath`).
 * No default: every variable is required but `NODE_EXTRA_CA_CERTS`. A child is given its own variables, nothing else.
 * One refusal is thrown, the first met: when several variables are refused, which one is named is not part of the
 * contract.
 */
export function readNativeConfig(env: Env, root: string, node: string): NativeConfig {
  const tokens = tokensOf(env);
  const port = whole(required(env, 'GATEWAY_PORT', 'an integer from 1 to 65535'));
  if (!(port <= 65535)) throw refusal('GATEWAY_PORT', 'an integer from 1 to 65535');
  const quotaPerMinute = count(env, 'GATEWAY_QUOTA_PER_MINUTE');
  const profile = required(env, 'GATEWAY_PROFILE', 'the name of a client profile');
  const sandbox = sandboxOf(env);
  const brokerPort = brokerPortOf(env);
  return {
    tokens,
    port,
    quotaPerMinute,
    profile,
    brokerPort,
    sandbox,
    files: {
      catalog: join(root, 'topology', 'catalog.json'),
      servers: join(root, 'topology', 'modules.mcp.json'),
      clients: join(root, 'topology', 'clients.json'),
    },
    processes: {
      data: {
        cwd: root,
        command: [node, join(root, 'data', 'dist', 'src', 'serve-mcp.js')],
        env: dataEnvOf(env),
      },
      broker: {
        cwd: root,
        command: [node, join(root, 'modules', 'broker', 'dist', 'src', 'serve.js')],
        env: brokerEnvOf(env),
      },
    },
  };
}
