import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AuthProxyOptions, CredentialSource } from '../../src/auth-proxy.js';
import { authProxyOptions, loadTool, parseTool, type Tool } from '../../src/tool.js';
import { PKG, Then, When, stored } from './helpers.js';

const committed = (): Record<string, any> =>
  JSON.parse(readFileSync(join(PKG, 'code.json'), 'utf8')) as Record<string, any>;

// Named defects of the committed file, one per row of the "rejects a broken copy" Examples.
const DEFECTS: Record<string, (t: Record<string, any>) => unknown> = {
  'a misspelt key': (t) => (t['plugins'] = []),
  'an empty command': (t) => (t['command'] = []),
  'a plain-http upstream': (t) => (t['authProxy']['upstream'] = 'http://api.anthropic.com'),
  'an xhttps upstream': (t) => (t['authProxy']['upstream'] = 'xhttps://api.anthropic.com'),
  'an httpsx upstream': (t) => (t['authProxy']['upstream'] = 'httpsx://api.anthropic.com'),
  'an unanchored route': (t) => (t['authProxy']['routes'] = ['/v1/messages']),
  'no body field': (t) => (t['authProxy']['policy']['bodyFields'] = []),
  'a zero body size limit': (t) => (t['authProxy']['policy']['maxBodyBytes'] = 0),
  'a fractional body size': (t) => (t['authProxy']['policy']['maxBodyBytes'] = 1.5),
  'an absolute system prompt file': (t) => (t['systemPromptFile'] = '/etc/CLAUDE.md'),
  'a system prompt file outside the worktree': (t) => (t['systemPromptFile'] = 'docs/../../CLAUDE.md'),
  'an empty system prompt file': (t) => (t['systemPromptFile'] = ''),
};

const credentialSource: CredentialSource = async () => ({ accessToken: 'unused' });

When('I build the auth proxy options with the session token {string}', function (sessionToken: string) {
  this.state['options'] = authProxyOptions(stored<Tool>(this, 'tool'), sessionToken, credentialSource);
});

Then('the auth proxy options carry the upstream, routes, betas and policy of code.json', function () {
  const { upstream, routes, betas, policy } = stored<AuthProxyOptions>(this, 'options');
  const { authProxy } = committed();
  assert.deepEqual(
    { upstream, routes, betas, policy },
    {
      upstream: authProxy['upstream'],
      routes: authProxy['routes'],
      betas: authProxy['betas'],
      policy: authProxy['policy'],
    },
  );
});

Then(
  'the auth proxy options carry the session token {string} and the given credential source',
  function (token: string) {
    const options = stored<AuthProxyOptions>(this, 'options');
    assert.equal(options.sessionToken, token);
    assert.equal(options.credential, credentialSource);
  },
);

Then('the auth proxy usage log is {string} under the home directory', function (path: string) {
  assert.equal(stored<AuthProxyOptions>(this, 'options').usageLog, join(homedir(), path));
});

When('I load the committed code.json', function () {
  this.state['tool'] = loadTool(join(PKG, 'code.json'));
});

Then('the tool profile is {string}', function (profile: string) {
  assert.equal(stored<Tool>(this, 'tool').profile, profile);
});

Then('the tool command is exactly {string}', function (command: string) {
  assert.deepEqual(stored<Tool>(this, 'tool').command, command.split(' '));
});

Then('the tool system prompt file is {string}', function (file: string) {
  assert.equal(stored<Tool>(this, 'tool').systemPromptFile, file);
});

Then('the tool auth proxy upstream is {string}', function (upstream: string) {
  assert.equal(stored<Tool>(this, 'tool').authProxy.upstream, upstream);
});

When('I break a copy of the committed code.json with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const broken = committed();
  breakIt(broken);
  this.state['broken'] = broken;
});

When('I change a copy of the committed code.json to have two routes', function () {
  const changed = committed();
  changed['authProxy']['routes'] = ['^/v1/messages$', '^/v1/messages/count_tokens$'];
  this.state['changed'] = changed;
});

Then('parsing the changed code.json succeeds', function () {
  assert.doesNotThrow(() => parseTool(stored(this, 'changed')));
});

Then('parsing the broken code.json fails', function () {
  assert.throws(() => parseTool(stored(this, 'broken')));
});
