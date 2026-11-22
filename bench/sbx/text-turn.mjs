import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';
import { clientSha256, clientVersion, codexGuest, installCodex, verifyArchive } from './codex-client.mjs';
import { decodeUpstream } from './subscription-stream.mjs';
import { withOfflineSbx } from './runtime.mjs';
import {
  challengeDigest,
  fixtureResponse,
  fixtureUsage,
  model,
  nativeTextStream,
  verifiedBrokerText,
} from './text-response.mjs';

async function turn(archive, route, respond) {
  const challenge = 'AOS-' + randomUUID();
  const prompt = 'Reply with exactly this value: ' + challenge;
  let calls = 0;
  let usage;
  let presentation;
  let reasoningIncluded;
  return withOfflineSbx(
    {
      limitMs: 180_000,
      async verify(workspace, result) {
        if ((await readdir(workspace)).length !== 0) throw Error('SBX_TEXT_WORKSPACE_CHANGED');
        return { ...result, workspace_empty_after_shutdown: true };
      },
    },
    async (sandbox) => {
      await installCodex(sandbox, archive);
      const receipt = await sandbox.execExchange(
        codexGuest('text-probe'),
        { model, prompt },
        async (request, signal) => {
          if (++calls !== 1 || !isDeepStrictEqual(request, { kind: 'request', model }))
            throw Error('SBX_TEXT_REQUEST_REFUSED');
          const result = await respond({ prompt, challenge, signal });
          usage = verifiedBrokerText(result, challenge, Buffer.byteLength(prompt));
          presentation = result.moderation_presentation;
          reasoningIncluded = result.reasoning_included;
          return {
            kind: 'response',
            body: nativeTextStream(challenge, usage, presentation),
            ...(reasoningIncluded === true ? { reasoning_included: true } : {}),
          };
        },
      );
      // The guest relay confirms which notice it served to Codex. The exec JSONL interface
      // independently reports the completed text and metering.
      const served = {
        ...(presentation === 'inline' ? { served_moderation_presentation: 'inline' } : {}),
        ...(reasoningIncluded === true ? { served_reasoning_included: true } : {}),
      };
      if (
        !usage ||
        !isDeepStrictEqual(receipt, {
          kind: 'receipt',
          model,
          text: challenge,
          usage,
          client_sha256: clientSha256,
          client_version: clientVersion,
          exit_code: 0,
          ...served,
        })
      ) {
        throw Error('SBX_NATIVE_TEXT_RECEIPT_MISMATCH');
      }
      return {
        route,
        model,
        client_version: clientVersion,
        client_sha256: clientSha256,
        native_exit: 0,
        terminal: 'completed',
        requests: calls,
        provider_requests: route === 'fixture' ? 0 : null,
        ...(route === 'host_broker' ? { challenge_sha256: challengeDigest(receipt.text) } : {}),
        usage,
        cost_usd: route === 'fixture' ? 0 : null,
        ...served,
      };
    },
  );
}

// The independent host account broker owns consent, model eligibility, upstream IO and billing evidence.
// This port accepts model output only. It has no credential, URL, filesystem or subprocess options.
export async function runHostedTurn(archive, requestText) {
  requireAdmittedRun();
  await verifyArchive(archive);
  if (typeof requestText !== 'function') throw Error('SBX_HOST_TEXT_BROKER_REQUIRED');
  return turn(archive, 'host_broker', ({ prompt, signal }) => requestText({ model, prompt }, signal));
}

function fixtureReply(challenge, metadata) {
  const id = 'resp_fixture';
  const routing = 'opaque-single-turn-fixture';
  const events = [
    { type: 'response.created', response: { id, model, status: 'in_progress' }, safety_buffering: false },
    {
      type: 'response.metadata',
      response_id: id,
      metadata,
      headers: { 'openai-model': model, 'x-codex-turn-state': routing },
    },
    { type: 'response.completed', response: { id, ...fixtureResponse(challenge) } },
  ];
  const wire = events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
  const reply = {
    statusCode: 200,
    headersDistinct: {
      'content-type': ['text/event-stream'],
      'openai-model': [model],
      'x-codex-turn-state': [routing],
      'x-openai-proxy-wasm': ['v0.1'],
      'x-codex-safety-buffering-enabled': ['true'],
      'x-reasoning-included': ['fixture-private-value'],
      'x-models-etag': ['W/"fixture-catalog"'],
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(wire);
    },
  };
  return reply;
}

export async function runFixtureTurn(archive, mode = 'complete') {
  requireAdmittedRun();
  await verifyArchive(archive);
  if (mode !== 'complete' && mode !== 'moderation') throw Error('SBX_FIXTURE_MODE');
  const metadata =
    mode === 'moderation'
      ? {
          openai_chatgpt_moderation_metadata: {
            safety_block: { schema_version: 1, domain: 'cyber', status: 'loading' },
          },
        }
      : {
          openai_verification_recommendation: [],
          openai_chatgpt_moderation_metadata: { presentation: 'inline' },
        };
  const receipt = { route: 'fixture', provider_requests: 0, cost_usd: 0 };
  const refreshCatalog = async () => ({ status: 200, outcome: 'visible', model });
  try {
    const result = await turn(archive, 'fixture', ({ prompt, challenge }) =>
      decodeUpstream(
        fixtureReply(challenge, metadata),
        challenge,
        Buffer.byteLength(prompt),
        receipt,
        refreshCatalog,
      ),
    );
    if (mode === 'moderation') throw Error('SBX_FIXTURE_UNEXPECTED_NATIVE_COMPLETION');
    if (result.served_moderation_presentation !== 'inline') throw Error('SBX_FIXTURE_MISSING_PRESENTATION');
    if (result.served_reasoning_included !== true) throw Error('SBX_FIXTURE_MISSING_REASONING_HEADER');
    if (receipt.catalog_refresh !== 'confirmed') throw Error('SBX_FIXTURE_CATALOG_UNCONFIRMED');
    return result;
  } catch (error) {
    if (
      mode !== 'moderation' ||
      error.message !== 'SBX_EXCHANGE_REPLY' ||
      receipt.stream_refusal?.disposition !== 'turn_moderation' ||
      Object.hasOwn(receipt, 'catalog_refresh') ||
      receipt.provider_observation?.terminal !== 'completed' ||
      !isDeepStrictEqual(receipt.provider_observation.usage, fixtureUsage)
    )
      throw error;
    return { ...receipt, native_completed: false };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [, , archive, flag] = process.argv;
  if (!archive || process.argv.length > 4 || (flag !== undefined && flag !== '--moderation-fixture')) {
    throw Error('usage: text-turn.mjs <pinned Codex Linux ARM64 archive> [--moderation-fixture]');
  }
  console.log(JSON.stringify(await runFixtureTurn(resolve(archive), flag ? 'moderation' : 'complete')));
}
