import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { requireAccountCatalog, verifyAccountExecResult } from './account-exec.mjs';
import { clientSha256, clientVersion } from './codex-client.mjs';
import { model } from './text-response.mjs';

test('the pinned app-server must announce disabled remote control before any command is sent', () => {
  const params = {
    status: 'disabled',
    serverName: 'private',
    installationId: 'private',
    environmentId: null,
  };
  const method = 'remoteControl/status/changed';
  const frames = [
    { method, params },
    ...['connecting', 'connected', 'errored', 'unknown'].map((status) => ({
      method,
      params: { ...params, status },
    })),
    { method, params: { ...params, environmentId: 'private' } },
    { method, params: { ...params, serverName: null } },
    { method, params: { ...params, extra: true } },
    { method, params, id: 1 },
    { method: 'other', params },
    { method, params: {} },
  ].map((frame) => ({ ...frame, emittedAtMs: 1234 }));
  frames.push({ method, params }, { method, params, emittedAtMs: true }, { method, params, emittedAtMs: -1 });
  const script = `import json,runpy,sys
verify = runpy.run_path(sys.argv[1])["require_disabled_remote"]
for index, frame in enumerate(json.load(sys.stdin)):
    try:
        verify(frame)
    except ValueError:
        if index == 0: raise
    else:
        if index != 0: sys.exit(1)
`;
  const path = fileURLToPath(new URL('./codex-guest.py', import.meta.url));
  const probe = spawnSync('python3', ['-I', '-B', '-c', script, path], { input: JSON.stringify(frames) });
  assert.equal(probe.status, 0);
});

test('catalogue gate accepts only the closed record of the selected account lookup', () => {
  const valid = { status: 200, outcome: 'visible', model };
  requireAccountCatalog(valid);
  const getter = Object.defineProperty({ ...valid }, 'model', {
    get() {
      assert.fail('read accessor');
    },
  });
  const proxy = new Proxy(valid, {
    ownKeys() {
      assert.fail('read proxy');
    },
  });
  for (const grant of [
    undefined,
    {},
    true,
    { ...valid, status: '200' },
    { ...valid, model: 'another' },
    { ...valid, outcome: 'unconfirmed' },
    { ...valid, token: 'private' },
    Object.create(valid),
    { ...valid, [Symbol('private')]: true },
    Object.defineProperty({ ...valid }, 'outcome', { enumerable: false }),
    getter,
    proxy,
  ])
    assert.throws(() => requireAccountCatalog(grant), { message: 'SBX_ACCOUNT_CATALOG_REQUIRED' });
});

test('host binds the pinned native command and process exit to this execution challenge', () => {
  const challenge = '587bbb6b-8918-47f6-9dfa-f0f3c5af393e';
  const digest = createHash('sha256')
    .update('architect-os account execution\n' + challenge + '\n')
    .digest('hex');
  const frame = {
    client_version: clientVersion,
    client_sha256: clientSha256,
    client_exit: 0,
    command_exit: 0,
    stdout: digest + '  challenge\n',
    stderr: '',
  };
  const processResult = { code: 0, stdout: JSON.stringify(frame) + '\n', stderr: '' };
  assert.equal(verifyAccountExecResult(processResult, challenge), digest);
  assert.throws(() => verifyAccountExecResult(processResult, 'another'));
  for (const result of [
    { ...processResult, code: 1 },
    { ...processResult, stderr: 'private diagnostic' },
    { ...processResult, stdout: processResult.stdout + processResult.stdout },
    {
      ...processResult,
      stdout: processResult.stdout.replace('"command_exit":0', '"command_exit":1,"command_exit":0'),
    },
    ...[
      { client_exit: 1 },
      { client_sha256: 'another' },
      { command_exit: 1 },
      { command_exit: '0' },
      { stderr: 'private' },
      { stdout: digest },
      { stdout: frame.stdout + '\n' },
      { request: 'model' },
    ].map((change) => ({ ...processResult, stdout: JSON.stringify({ ...frame, ...change }) })),
  ])
    assert.throws(() => verifyAccountExecResult(result, challenge), {
      message: 'SBX_ACCOUNT_EXEC_RECEIPT_MISMATCH',
    });
});
