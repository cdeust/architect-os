import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DockerSandboxRunner, dockerArgs, type DockerRunnerOptions } from '../../src/docker-runner.js';
import type { Sandbox, SandboxExit } from '../../src/port.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';

const OPTIONS: DockerRunnerOptions = {
  profile: 'memory-worker',
  image: 'worker:test',
  network: 'exec',
  memory: '256m',
  pidsLimit: 64,
  env: { INTERNAL_TOOLS_URL: 'http://memory:8083' },
};

/**
 * A fake docker client: appends its argv and its environment's names to calls.jsonl in DOCKER_CONFIG, then for
 * `run` echoes stdin to stdout and exits with 7, unless the image is `hang`: it prints `started` once its call is
 * recorded, then never ends.
 */
const FAKE_DOCKER = `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(join(process.env.DOCKER_CONFIG, 'calls.jsonl'), JSON.stringify({ args, env: Object.keys(process.env).sort() }) + '\\n');
if (args[0] !== 'run') process.exit(0);
if (args.includes('hang')) { process.stdout.write('started\\n'); setInterval(() => {}, 1000); }
else {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => { process.stdout.write(input); process.exitCode = 7; });
}
`;

function fakeClient(world: SandboxWorld): string {
  const dir = mkdtempSync(join(tmpdir(), 'aos-docker-'));
  world.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const client = join(dir, 'docker');
  writeFileSync(client, FAKE_DOCKER);
  chmodSync(client, 0o755);
  world.state['dockerDir'] = dir;
  return client;
}

const calls = (world: SandboxWorld): { args: string[]; env: string[] }[] =>
  readFileSync(join(stored<string>(world, 'dockerDir'), 'calls.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { args: string[]; env: string[] });

When(
  'I build the docker arguments of the test options for the container {string} and the argv {string}',
  function (name: string, argv: string) {
    this.state['dockerArgs'] = dockerArgs(OPTIONS, name, argv.split(' '));
  },
);

const args = (world: SandboxWorld) => stored<string[]>(world, 'dockerArgs');

Then('the docker arguments start with {string}', function (prefix: string) {
  const expected = prefix.split(' ');
  assert.deepEqual(args(this).slice(0, expected.length), expected);
});

Then('the docker argument after {string} is {string}', function (flag: string, value: string) {
  assert.equal(args(this)[args(this).indexOf(flag) + 1], value);
});

Then('the docker arguments forward only the environment {string}', function (pairs: string) {
  const all = args(this);
  assert.deepEqual(
    all.filter((_, i) => all[i - 1] === '--env'),
    pairs.split(', '),
  );
});

Then('the docker arguments end with {string}', function (suffix: string) {
  const expected = suffix.split(' ');
  assert.deepEqual(args(this).slice(-expected.length), expected);
});

Given('a Docker sandbox runner with the fake docker client', function () {
  const docker = fakeClient(this);
  this.state['docker'] = new DockerSandboxRunner(
    { ...OPTIONS, docker },
    {
      PATH: process.env['PATH'],
      HOME: process.env['HOME'],
      DOCKER_CONFIG: stored<string>(this, 'dockerDir'),
      SECRET: 's',
    },
  );
});

Given('a Docker sandbox runner whose docker client does not exist', function () {
  this.state['docker'] = new DockerSandboxRunner({
    ...OPTIONS,
    docker: join(tmpdir(), 'aos-no-such-docker'),
  });
});

const docker = (world: SandboxWorld) => stored<DockerSandboxRunner>(world, 'docker');

When('I try to start the Docker profile {string}', async function (profile: string) {
  this.state['refusal'] = await docker(this)
    .start({ profile, cwd: tmpdir(), command: [] })
    .then(
      () => null,
      (error: Error) => error,
    );
});

Then('the Docker start is refused with {string}', function (message: string) {
  assert.equal(stored<Error | null>(this, 'refusal')?.message, message);
});

Then('the Docker start is refused starting with {string}', function (prefix: string) {
  const message = stored<Error | null>(this, 'refusal')?.message ?? '';
  assert.ok(message.startsWith(prefix), message);
});

When(
  'I start the Docker profile {string}, send {string} and wait for the end',
  async function (profile: string, input: string) {
    const sandbox: Sandbox = await docker(this).start({ profile, cwd: tmpdir(), command: [] });
    let output = '';
    sandbox.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    sandbox.stdin.end(input);
    this.state['exit'] = await sandbox.exited;
    this.state['output'] = output;
  },
);

Then('the Docker sandbox printed {string} and exited with {int}', function (output: string, code: number) {
  assert.equal(stored<string>(this, 'output'), output);
  assert.equal(stored<SandboxExit>(this, 'exit').code, code);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Then('the fake docker client was run with a container named {string} and a UUID', function (prefix: string) {
  const run = calls(this).find((call) => call.args[0] === 'run');
  const name = run?.args[run.args.indexOf('--name') + 1] ?? '';
  assert.ok(name.startsWith(prefix) && UUID.test(name.slice(prefix.length)), name);
});

Then('the fake docker client saw only the environment {string}', function (names: string) {
  const run = calls(this).find((call) => call.args[0] === 'run');
  // The node runtime of the fake client may add its own variables: only the inherited ones are compared.
  assert.deepEqual(
    run?.env.filter((name) => !name.startsWith('__CF') && name !== 'XPC_SERVICE_NAME'),
    names.split(', '),
  );
});

When(
  'I start the Docker profile {string} with the image {string} and stop it',
  async function (profile: string, image: string) {
    const dir = stored<string>(this, 'dockerDir');
    const runner = new DockerSandboxRunner(
      { ...OPTIONS, image, docker: join(dir, 'docker') },
      { PATH: process.env['PATH'], HOME: process.env['HOME'], DOCKER_CONFIG: dir },
    );
    const sandbox = await runner.start({ profile, cwd: tmpdir(), command: [] });
    // Stopped once the client has recorded its run: before, the kill would race its first write.
    await new Promise((started) => sandbox.stdout.once('data', started));
    this.state['exit'] = await sandbox.stop();
  },
);

Then('the Docker sandbox exited by the signal {string}', function (signal: string) {
  assert.equal(stored<SandboxExit>(this, 'exit').signal, signal);
});

Then('the fake docker client was asked to remove the container it ran', function () {
  const all = calls(this);
  const run = all.find((call) => call.args[0] === 'run');
  const name = run?.args[run.args.indexOf('--name') + 1];
  assert.deepEqual(all.find((call) => call.args[0] === 'rm')?.args, ['rm', '-f', name]);
});
