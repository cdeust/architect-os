import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { accountSessionTransport } from './subscription-account.mjs';
import { openSubscriptionSession } from './subscription-session.mjs';
import { fixtureResponse, model } from './text-response.mjs';

const signal = new AbortController().signal;
const accountHash = 'a'.repeat(64);
const challenge = 'AOS-8ec061f1-6e29-4968-a070-21c072110c57';
const prompt = 'Reply with exactly this value: ' + challenge;
const visible = { status: 200, outcome: 'visible', model };

function grant(receivedAt = 0, version = 1) {
  return {
    clientId: 'oaiapp_fixture',
    accountHash,
    receivedAt,
    tokens: {
      token_type: 'Bearer',
      scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct',
      access_token: 'access-fixture-' + version,
      refresh_token: 'refresh-fixture-' + version,
      expires_in: 1,
      id_token: 'private-id-token',
    },
  };
}

function response(events = []) {
  return {
    statusCode: 200,
    headersDistinct: {},
    destroy() {},
    async *[Symbol.asyncIterator]() {
      for (const frame of [
        { type: 'response.created', response: { id: 'r', model, status: 'in_progress' } },
        ...events,
        { type: 'response.completed', response: { id: 'r', ...fixtureResponse(challenge) } },
      ])
        yield Buffer.from('data: ' + JSON.stringify(frame) + '\n\n');
    },
  };
}

function options(overrides = {}) {
  return {
    grant: grant(),
    now: () => 0,
    refresh: async () => grant(0, 2),
    readCatalog: async () => ({ models: [{ slug: model, visibility: 'list', private: 'secret-detail' }] }),
    dispatch: async () => response(),
    ...overrides,
  };
}

test('the broker projects only account-visible model and admitted text, with a fresh capability for each run', async () => {
  const authorizations = [];
  const session = openSubscriptionSession(
    options({
      dispatch(access, body, id, active) {
        authorizations.push(access);
        assert.equal(JSON.parse(body).model, model);
        assert.equal(active.aborted, false);
        return response();
      },
    }),
  );
  assert.deepEqual(Object.keys(session).sort(), ['close', 'openRun', 'renew']);
  for (let i = 0; i < 2; i++) {
    const run = session.openRun('text');
    assert.deepEqual(Object.keys(run).sort(), ['catalog', 'close', 'requestText']);
    assert.deepEqual(await run.catalog(signal), visible);
    const receipt = { provider_requests: 0 };
    await assert.rejects(run.requestText('invalid', signal, receipt), /CHALLENGE/);
    assert.equal(receipt.provider_requests, 0);
    const first = run.requestText(prompt, signal, receipt);
    const otherReceipt = { provider_requests: 0 };
    await assert.rejects(run.requestText(prompt, signal, otherReceipt), /TURN_NOT_ADMITTED/);
    assert.equal(otherReceipt.provider_requests, 0);
    const answer = await first;
    assert.equal(answer.output[0].content[0].text, challenge);
    assert.equal(receipt.provider_requests, 1);
    assert.doesNotMatch(
      JSON.stringify([answer, receipt, run, session]),
      /access-fixture|refresh-fixture|private-id-token/,
    );
    run.close();
    await assert.rejects(run.catalog(signal), /CANCELLED/);
  }
  assert.deepEqual(authorizations, ['access-fixture-1', 'access-fixture-1']);
  session.close();
  assert.throws(() => session.openRun(), /CANCELLED/);
});

test('server expiry, concurrent runs and an operator renewal share exactly one rotation', async () => {
  let clock = 900;
  let version = 1;
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const seen = [];
  const session = openSubscriptionSession(
    options({
      now: () => clock,
      async refresh(binding) {
        assert.equal(binding.clientId, 'oaiapp_fixture');
        assert.equal(binding.accountHash, accountHash);
        assert.equal(binding.refreshToken, 'refresh-fixture-' + version);
        assert.equal(binding.signal.aborted, false);
        version++;
        started.resolve();
        await finish.promise;
        return grant(clock, version);
      },
      readCatalog(access) {
        seen.push(access);
        return { models: [{ slug: model, visibility: 'list' }] };
      },
    }),
  );
  const first = session.openRun();
  const second = session.openRun();
  assert.deepEqual(Object.keys(first).sort(), ['catalog', 'close']);
  assert.throws(() => session.openRun('other'), /RUN_MODE/);
  clock = 999;
  await first.catalog(signal);
  assert.equal(version, 1);
  clock = 1000;
  const closing = first.catalog(signal);
  await started.promise;
  const other = second.catalog(signal);
  const renewing = session.renew(signal);
  first.close();
  await assert.rejects(closing, /CANCELLED/);
  finish.resolve();
  assert.deepEqual(await other, visible);
  assert.equal(await renewing, undefined);
  assert.equal(version, 2);
  await session.renew(signal);
  await second.catalog(signal);
  assert.deepEqual(seen, ['access-fixture-1', 'access-fixture-2', 'access-fixture-3']);
  session.close();
});

test('bad lifetimes, credentials, binding and missing required scopes are refused at bootstrap', () => {
  for (const alter of [
    (g) => {
      g.clientId = 'other';
    },
    (g) => {
      g.accountHash = 'unknown';
    },
    (g) => {
      delete g.receivedAt;
    },
    (g) => {
      g.receivedAt = 1;
    },
    (g) => {
      g.tokens.expires_in = 0;
    },
    (g) => {
      g.tokens.expires_in = '3600';
    },
    (g) => {
      g.tokens.expires_in = Number.MAX_SAFE_INTEGER;
    },
    (g) => {
      g.tokens.access_token += '\nInjection: forbidden';
    },
    (g) => {
      delete g.tokens.refresh_token;
    },
    (g) => {
      delete g.tokens.scope;
    },
    (g) => {
      g.tokens.token_type = 'other';
    },
    ...['offline_access', 'chatgpt.tokens.use.direct', 'resource.invoke'].map((needed) => (g) => {
      g.tokens.scope = g.tokens.scope.replace(needed, 'other');
    }),
  ]) {
    const g = grant();
    alter(g);
    assert.throws(() => openSubscriptionSession(options({ grant: g })), /SBX_SUBSCRIPTION_GRANT/);
  }
  assert.throws(() => openSubscriptionSession(options({ now: () => 1000 })), /SBX_SUBSCRIPTION_GRANT/);
});

test('invalidated, misbound or unrotated replacement terminates all live capabilities', async () => {
  for (const replace of [
    () => null,
    () => ({ ...grant(0, 2), clientId: 'oaiapp_other' }),
    () => ({ ...grant(0, 2), accountHash: 'b'.repeat(64) }),
    () => grant(0, 1),
    ...[
      undefined,
      null,
      '',
      'openid',
      grant().tokens.scope.replace('openid ', ''),
      grant().tokens.scope + ' unrelated',
      grant().tokens.scope.replace('openid', 'invalid"scope'),
    ].map((scope) => () => ({ ...grant(0, 2), tokens: { ...grant(0, 2).tokens, scope } })),
  ]) {
    const session = openSubscriptionSession(options({ refresh: replace }));
    const run = session.openRun();
    await assert.rejects(session.renew(signal), /REAUTH/);
    await assert.rejects(run.catalog(signal), /REAUTH/);
    assert.throws(() => session.openRun(), /REAUTH/);
  }
});

test('an omitted refresh scope retains only this session’s verified scope set across rotations', async () => {
  const initial = grant();
  initial.tokens.scope += ' email';
  let version = 1;
  const session = openSubscriptionSession(
    options({
      grant: initial,
      refresh() {
        const next = grant(0, ++version);
        if (version === 2) delete next.tokens.scope;
        if (version === 3) next.tokens.scope = initial.tokens.scope.split(' ').reverse().join(' ');
        return next;
      },
    }),
  );
  await session.renew(signal);
  await session.renew(signal);
  assert.deepEqual(await session.openRun().catalog(signal), visible);
  // The fourth grant drops email while retaining the three required API permissions.
  await assert.rejects(session.renew(signal), /REAUTH/);
  assert.throws(() => session.openRun(), /REAUTH/);
});

test('after a successful rotation only identity verification resumes; temporary pre-rotation failure leaves the current grant usable', async () => {
  let exchanges = 0;
  let validations = 0;
  const gets = [];
  const sends = [];
  const initial = grant();
  initial.accountHash = createHash('sha256').update('fixture-subject').digest('hex');
  const transport = accountSessionTransport({
    now: () => 0,
    fetchImpl: async (_url, request) => {
      if (request.method === 'POST') {
        exchanges++;
        return exchanges === 1 ? new Response(null, { status: 503 }) : Response.json(grant(0, 2).tokens);
      }
      gets.push(request.headers.Authorization);
      return Response.json({ models: [{ slug: model, visibility: 'list' }] });
    },
    verifyRefreshId: async () => {
      if (++validations < 3) throw Error('temporary private JWKS diagnostics');
      return { sub: 'fixture-subject' };
    },
  });
  const session = openSubscriptionSession(
    options({
      ...transport,
      grant: initial,
      dispatch: (access) => {
        sends.push(access);
        return response();
      },
    }),
  );
  const run = session.openRun('text');
  const unavailable = { message: 'SBX_SUBSCRIPTION_REFRESH_UNAVAILABLE' };
  await assert.rejects(session.renew(signal), unavailable);
  assert.deepEqual(await run.catalog(signal), visible);
  assert.deepEqual(gets, ['Bearer access-fixture-1']);
  await assert.rejects(session.renew(signal), unavailable);
  const receipt = { provider_requests: 0 };
  await assert.rejects(run.requestText(prompt, signal, receipt), unavailable);
  assert.equal(receipt.provider_requests, 0);
  assert.deepEqual(sends, []);
  assert.deepEqual(await session.openRun().catalog(signal), visible);
  assert.deepEqual(gets, ['Bearer access-fixture-1', 'Bearer access-fixture-2']);
  assert.equal((await run.requestText(prompt, signal, receipt)).model, model);
  assert.deepEqual(sends, ['access-fixture-2']);
  assert.equal(validations, 3);
  assert.equal(exchanges, 2); // one 503 and one 200; neither JWKS retry sent a refresh POST
  session.close();
});

test('an in-flight turn cannot reconcile its catalogue with a retired bearer', async () => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let gets = 0;
  const session = openSubscriptionSession(
    options({
      dispatch: async () => {
        started.resolve();
        await finish.promise;
        return { ...response(), headersDistinct: { 'x-models-etag': ['"fixture"'] } };
      },
      readCatalog: async () => {
        gets++;
        return { models: [{ slug: model, visibility: 'list' }] };
      },
    }),
  );
  const receipt = { provider_requests: 0 };
  const result = session.openRun('text').requestText(prompt, signal, receipt);
  await started.promise;
  await session.renew(signal);
  finish.resolve();
  await assert.rejects(result, /UPSTREAM_REFUSED/);
  assert.equal(receipt.catalog_refresh, 'failed');
  assert.equal(gets, 0);
  session.close();
});

test('a closed session cannot install a late refresh or dispatch a delayed turn', async () => {
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  let clock = 0;
  let called = 0;
  const session = openSubscriptionSession(
    options({
      now: () => clock,
      refresh: ({ signal: linked }) => {
        started.resolve(linked);
        return late.promise;
      },
      dispatch: () => {
        called++;
        return response();
      },
    }),
  );
  const run = session.openRun('text');
  clock = 1000;
  const receipt = { provider_requests: 0 };
  const attempt = run.requestText(prompt, signal, receipt);
  const linked = await started.promise;
  session.close();
  assert.equal(linked.aborted, true);
  await assert.rejects(attempt, /CANCELLED/);
  late.resolve(grant(clock, 2));
  await assert.rejects(session.renew(signal), /CANCELLED/);
  assert.equal(called, 0);
  assert.equal(receipt.provider_requests, 0);
});

test('transport failures, body errors and an arbitrary caller abort reason do not expose credentials', async () => {
  const secret = 'a transport exception containing private credentials';
  const fail = () => {
    throw Error(secret);
  };
  const brokenBody = {
    ...response(),
    async *[Symbol.asyncIterator]() {
      fail();
    },
  };
  for (const dispatch of [fail, () => brokenBody]) {
    const session = openSubscriptionSession(options({ refresh: fail, readCatalog: fail, dispatch }));
    const run = session.openRun('text');
    await assert.rejects(session.renew(signal), { message: 'SBX_SUBSCRIPTION_REFRESH_UNAVAILABLE' });
    await assert.rejects(run.catalog(signal), { message: 'SBX_SUBSCRIPTION_CATALOG' });
    await assert.rejects(run.catalog(AbortSignal.abort(Error(secret))), {
      message: 'SBX_SUBSCRIPTION_CANCELLED',
    });
    await assert.rejects(run.requestText(prompt, signal, { provider_requests: 0 }), {
      message: 'SBX_SUBSCRIPTION_TRANSPORT',
    });
    await assert.rejects(run.requestText(prompt, signal, { provider_requests: 0 }), /TURN_NOT_ADMITTED/);
    session.close();
  }
});

test('the native admission still withholds text and keeps audited moderation data on the host', async () => {
  const session = openSubscriptionSession(
    options({
      dispatch: () =>
        response([
          {
            type: 'response.metadata',
            response_id: 'r',
            metadata: { openai_chatgpt_moderation_metadata: { private: 'private-control' } },
          },
        ]),
    }),
  );
  const receipt = { provider_requests: 0 };
  const result = await session.openRun('text').requestText(prompt, signal, receipt);
  assert.deepEqual(result, { kind: 'withheld' });
  assert.equal(receipt.stream_refusal.disposition, 'turn_moderation');
  assert.doesNotMatch(JSON.stringify(receipt), /private-control/);
  session.close();
});

test('revocation destroys a late HTTP response and interrupts an open response before it can release text', async () => {
  for (const timing of ['before_headers', 'during_body']) {
    const waiting = Promise.withResolvers();
    const finish = Promise.withResolvers();
    const disposed = Promise.withResolvers();
    let destructionCount = 0;
    const reply = {
      ...response(),
      destroy() {
        destructionCount++;
        disposed.resolve();
      },
      async *[Symbol.asyncIterator]() {
        waiting.resolve();
        await finish.promise;
        yield* response();
      },
    };
    const session = openSubscriptionSession(
      options({
        async dispatch() {
          if (timing === 'before_headers') {
            waiting.resolve();
            await finish.promise;
          }
          return reply;
        },
      }),
    );
    const receipt = { provider_requests: 0 };
    const run = session.openRun('text');
    const result = run.requestText(prompt, signal, receipt);
    await waiting.promise;
    run.close();
    await assert.rejects(result, /CANCELLED/);
    if (timing === 'during_body') await disposed.promise;
    finish.resolve();
    await disposed.promise;
    assert.equal(destructionCount, 1);
    assert.equal(receipt.provider_requests, 1);
    assert.notEqual(receipt.provider_observation?.terminal, 'completed');
    assert.deepEqual(await session.openRun().catalog(signal), visible);
    session.close();
  }
});
