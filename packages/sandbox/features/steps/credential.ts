import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandCredential, usageOf, type Credential, type CredentialSource } from '../../src/auth-proxy.js';
import { Given, Then, When, assertMatches, messageMatches, stored, type SandboxWorld } from './helpers.js';

When('I read the usage of an {string} body {string}', function (contentType: string, body: string) {
  this.state['usage'] = usageOf(contentType, body);
});

When('I read the usage of a server-sent-events body:', function (body: string) {
  this.state['usage'] = usageOf('text/event-stream', body);
});

Then('the usage is {string}', function (json: string) {
  assert.deepEqual(stored(this, 'usage'), JSON.parse(json));
});

/** The scenario's temporary folder, created on first use and removed by the After hook. */
function credentialDir(world: SandboxWorld): string {
  let dir = world.state['credentialDir'] as string | undefined;
  if (dir === undefined) {
    const made = realpathSync(mkdtempSync(join(tmpdir(), 'aos-cred-')));
    world.cleanups.push(() => rmSync(made, { recursive: true, force: true }));
    world.state['credentialDir'] = dir = made;
  }
  return dir;
}

/** Writes `body` as an executable node script in the scenario's folder and returns the argv that runs it. */
function script(world: SandboxWorld, body: string): string[] {
  const file = join(credentialDir(world), 'cred.mjs');
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o755);
  return [process.execPath, file];
}

Given(
  'a credential command that counts its runs and prints the access token {string} valid for one hour',
  function (token: string) {
    const counter = (this.state['counter'] = join(credentialDir(this), 'count'));
    const argv = script(
      this,
      `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(counter)}, 'x');` +
        `console.log(JSON.stringify({ claudeAiOauth: { accessToken: ${JSON.stringify(token)}, expiresAt: Date.now() + 3600e3 } }));`,
    );
    this.state['source'] = commandCredential(argv);
  },
);

Given(
  'a credential command that prints the access token {string} expired since the epoch plus {int} ms',
  function (token: string, expiresAt: number) {
    const argv = script(
      this,
      `console.log(JSON.stringify({ claudeAiOauth: { accessToken: ${JSON.stringify(token)}, expiresAt: ${expiresAt} } }));`,
    );
    this.state['source'] = commandCredential(argv);
  },
);

Given('a credential command that prints {string}', function (text: string) {
  this.state['source'] = commandCredential(script(this, `console.log(${JSON.stringify(text)});`));
});

Given(
  'a credential command that prints {string} and exits with code {int}',
  function (text: string, code: number) {
    this.state['source'] = commandCredential(
      script(this, `console.log(${JSON.stringify(text)}); process.exit(${code});`),
    );
  },
);

When('I read the credential twice', async function () {
  const source = stored<CredentialSource>(this, 'source');
  this.state['readings'] = [await source(), await source()];
});

Then('both readings give the access token {string}', function (token: string) {
  const readings = stored<Credential[]>(this, 'readings');
  assert.equal(readings.length, 2);
  for (const reading of readings) assertMatches(reading, { accessToken: token });
});

Then('the credential command ran {int} time(s)', function (times: number) {
  assert.equal(readFileSync(stored<string>(this, 'counter'), 'utf8'), 'x'.repeat(times));
});

Then('reading the credential is refused with {string}', async function (pattern: string) {
  await assert.rejects(stored<CredentialSource>(this, 'source')(), messageMatches(pattern));
});

Given('a credential command that prints the JSON {string}', function (json: string) {
  this.state['source'] = commandCredential(script(this, `console.log(${JSON.stringify(json)});`));
});

Then('reading the credential gives {string}', async function (json: string) {
  assert.deepEqual(await stored<CredentialSource>(this, 'source')(), JSON.parse(json));
});

Given('a credential command with no argv', function () {
  this.state['source'] = commandCredential([]);
});

Given('a credential command that prints a valid credential padded to {int} bytes', function (size: number) {
  const json = JSON.stringify({ claudeAiOauth: { accessToken: 'a' } });
  const padded = json + ' '.repeat(size - json.length);
  this.state['source'] = commandCredential(script(this, `process.stdout.write(${JSON.stringify(padded)});`));
});

Given(
  'a credential command that prints the access token {string} expiring at {int} ms, read with the clock at {int} ms',
  function (token: string, expiresAt: number, now: number) {
    const argv = script(
      this,
      `console.log(JSON.stringify({ claudeAiOauth: { accessToken: ${JSON.stringify(token)}, expiresAt: ${expiresAt} } }));`,
    );
    this.state['source'] = commandCredential(argv, 60_000, () => now);
  },
);

Then('reading the credential is refused', async function () {
  await assert.rejects(stored<CredentialSource>(this, 'source')(), messageMatches('expired'));
});

Then('reading the credential is accepted', async function () {
  await assert.doesNotReject(stored<CredentialSource>(this, 'source')());
});
