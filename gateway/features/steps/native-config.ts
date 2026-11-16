import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNativeConfig, type NativeConfig } from '../../src/infrastructure/native-config.js';
import { Given, Then, When, attempt, type Attempt, type GatewayWorld } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface Scene {
  env: Record<string, string | undefined>;
  read?: Attempt;
}
const scene = (world: GatewayWorld): Scene => world.state['native-config'] as Scene;

/** A file of the scenario, removed at its end. */
function written(world: GatewayWorld, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'native-config-'));
  world.cleanups.push(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'broker.json');
  writeFileSync(path, content);
  return path;
}

Given('a complete environment of the native gateway', function () {
  this.state['native-config'] = {
    env: {
      GATEWAY_TOKENS: '0123456789abcdef0123456789abcdef=alice;fedcba9876543210fedcba9876543210=bob',
      GATEWAY_PORT: '8080',
      GATEWAY_QUOTA_PER_MINUTE: '30',
      GATEWAY_PROFILE: 'owner',
      GATEWAY_SANDBOX: 'srt',
      BROKER_CONFIG: written(this, '{"port":8084,"upstream":"https://api.anthropic.com"}'),
      DATABASE_URL: 'postgres://app@db/platform',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/inspection.pem',
    },
  } satisfies Scene;
});

// A table cell loses the blanks at its ends: a scenario writes a blank as `[blank]`.
Given('the variable {string} is {string}', function (variable: string, value: string) {
  scene(this).env[variable] = value.replaceAll('[blank]', ' ');
});

Given('the variable {string} is absent', function (variable: string) {
  delete scene(this).env[variable];
});

Given('the variable {string} names a file holding {string}', function (variable: string, content: string) {
  scene(this).env[variable] = written(this, content);
});

Given('the variable {string} names the committed broker configuration', function (variable: string) {
  scene(this).env[variable] = join(ROOT, 'modules', 'broker', 'broker.json');
});

When(
  'the native configuration is read for the root {string} and the node {string}',
  async function (root: string, node: string) {
    const current = scene(this);
    current.read = await attempt(async () => readNativeConfig(current.env, root, node));
  },
);

const config = (world: GatewayWorld): NativeConfig => {
  const { read } = scene(world);
  assert.ok(read !== undefined && !read.failed, `the configuration was refused: ${String(read?.error)}`);
  return read.value as NativeConfig;
};

Then(
  'the native configuration is the complete one for the root {string} and the node {string}',
  function (root: string, node: string) {
    const { env } = scene(this);
    assert.deepEqual(config(this), {
      tokens: new Map([
        ['0123456789abcdef0123456789abcdef', 'alice'],
        ['fedcba9876543210fedcba9876543210', 'bob'],
      ]),
      port: 8080,
      quotaPerMinute: 30,
      profile: 'owner',
      brokerPort: 8084,
      sandbox: { means: 'srt' },
      files: {
        catalog: `${root}/topology/catalog.json`,
        servers: `${root}/topology/modules.mcp.json`,
        clients: `${root}/topology/clients.json`,
      },
      processes: {
        data: {
          cwd: root,
          command: [node, `${root}/data/dist/src/serve-mcp.js`],
          env: { DATABASE_URL: 'postgres://app@db/platform' },
        },
        broker: {
          cwd: root,
          command: [node, `${root}/modules/broker/dist/src/serve.js`],
          env: { BROKER_CONFIG: env['BROKER_CONFIG'], NODE_EXTRA_CA_CERTS: '/etc/ssl/inspection.pem' },
        },
      },
    });
  },
);

Then('the environment of the process {string} is {string}', function (name: string, expected: string) {
  const { processes } = config(this);
  const wanted = expected.replace('${BROKER_CONFIG}', scene(this).env['BROKER_CONFIG']!);
  assert.deepEqual(processes[name as 'data' | 'broker'].env, JSON.parse(wanted));
});

Then('the native configuration field {string} is {int}', function (field: string, value: number) {
  assert.equal((config(this) as unknown as Record<string, unknown>)[field], value);
});

Then('the sandbox of the native configuration is {string}', function (expected: string) {
  assert.deepEqual(config(this).sandbox, JSON.parse(expected));
});

Given('the environment of the native gateway chooses Docker with good values', function () {
  Object.assign(scene(this).env, {
    GATEWAY_SANDBOX: 'docker',
    GATEWAY_DOCKER_IMAGE: `node@sha256:${'0'.repeat(64)}`,
    GATEWAY_DOCKER_NODE: '/usr/local/bin/node',
    GATEWAY_DOCKER_MEMORY_MIB: '512',
    GATEWAY_DOCKER_PIDS: '64',
    GATEWAY_DOCKER_CHECK_MS: '20000',
  });
});

Then('the tokens of the native configuration are {string}', function (tokens: string) {
  assert.deepEqual(Object.fromEntries(config(this).tokens), JSON.parse(tokens));
});

/** The refusal of the configuration: a plain Error, not a GatewayError. */
const refusal = (world: GatewayWorld): Error => {
  const { read } = scene(world);
  assert.ok(read?.failed, 'the configuration was not refused');
  assert.ok(read.error instanceof Error);
  assert.equal(read.error.constructor, Error);
  return read.error;
};

Then('the native configuration is refused with {string}', function (message: string) {
  assert.equal(refusal(this).message, message);
});

Then('the native configuration is refused without the text {string}', function (text: string) {
  assert.ok(!refusal(this).message.includes(text), refusal(this).message);
});
