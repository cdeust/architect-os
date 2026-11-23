import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { accountSessionTransport, readAccountJson } from './subscription-account.mjs';
import { frameByteLimit } from './json-frame.mjs';
const clientId = 'oaiapp_fixture';
const accountHash = createHash('sha256').update('account').digest('hex');
const grant = () => ({
  clientId,
  accountHash,
  refreshToken: 'fixture-old',
  signal: new AbortController().signal,
});
const tokens = { access_token: 'fixture-access', refresh_token: 'fixture-new', id_token: 'fixture-id' };

test('refresh uses the issued client and exact SIWC resource; the catalogue uses only the access token', async () => {
  const calls = [];
  const port = accountSessionTransport({
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return Response.json(opts.method === 'POST' ? tokens : { models: [] });
    },
    verifyRefreshId: async (id, client) => {
      assert.equal(id, tokens.id_token);
      assert.equal(client, clientId);
      return { sub: 'account' };
    },
    now: () => 43,
  });
  const input = grant();
  assert.deepEqual(await port.refresh(input), { clientId, accountHash, tokens, receivedAt: 43 });
  assert.deepEqual(await port.readCatalog(tokens.access_token, input.signal), { models: [] });
  assert.deepEqual(
    calls.map((x) => [x.url, x.opts.method, x.opts.redirect, x.opts.cache]),
    [
      ['https://auth.openai.com/api/accounts/oauth/token', 'POST', 'error', 'no-store'],
      ['https://api.openai.com/v1/models', 'GET', 'error', 'no-store'],
    ],
  );
  assert.deepEqual(Object.fromEntries(calls[0].opts.body), {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: 'fixture-old',
    resource: 'https://api.openai.com/v1',
  });
  assert.deepEqual(calls[1].opts.headers, { Authorization: 'Bearer fixture-access' });
});

test('after rotation a transient identity check resumes without another token exchange', async () => {
  let exchanges = 0;
  let checks = 0;
  const port = accountSessionTransport({
    fetchImpl: async () => {
      exchanges++;
      return Response.json(tokens);
    },
    verifyRefreshId: async () => {
      if (++checks === 1) throw Error('temporary');
      return { sub: 'account' };
    },
  });
  const input = grant();
  await assert.rejects(port.refresh(input), /IDENTITY_UNAVAILABLE/);
  await assert.rejects(port.refresh({ ...input, clientId: 'oaiapp_other' }), /SESSION_MISMATCH/);
  assert.deepEqual((await port.refresh(input)).tokens, tokens);
  assert.equal(exchanges, 1);
  assert.equal(checks, 2);
});

test('invalid replacement identities and terminal token errors cannot renew; temporary failures surface', async () => {
  for (const identity of [null, {}, { sub: 'other' }]) {
    const port = accountSessionTransport({
      fetchImpl: async () => Response.json(tokens),
      verifyRefreshId: async () => identity,
    });
    assert.equal(await port.refresh(grant()), null);
  }
  for (const status of [400, 401, 503]) {
    const port = accountSessionTransport({
      fetchImpl: async () => Response.json({ error: { code: 'invalid_grant' } }, { status }),
      verifyRefreshId: () => {
        throw Error('unexpected verification');
      },
    });
    if (status === 503) await assert.rejects(port.refresh(grant()), /REFRESH_UNAVAILABLE/);
    else assert.equal(await port.refresh(grant()), null);
  }
});

test('host JSON rejects duplicates, malformed UTF-8 and oversized bodies', async () => {
  for (const bytes of [
    Buffer.from('{"field":1,"field":2}'),
    Buffer.from([255]),
    Buffer.alloc(frameByteLimit + 1),
  ]) {
    await assert.rejects(readAccountJson([bytes]));
  }
});
