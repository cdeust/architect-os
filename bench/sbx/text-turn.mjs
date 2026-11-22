import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';
import { clientSha256, clientVersion, codexGuest, installCodex, verifyArchive } from './codex-client.mjs';
import { parseResponse } from './subscription-stream.mjs';
import { withOfflineSbx } from './runtime.mjs';
import { fixtureResponse, model, nativeTextStream, verifiedText } from './text-response.mjs';

async function turn(archive, route, respond) {
  const challenge = 'AOS-' + randomUUID();
  const prompt = 'Reply with exactly this value: ' + challenge;
  let calls = 0;
  let usage;
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
          usage = verifiedText(await respond({ prompt, challenge, signal }), challenge);
          return { kind: 'response', body: nativeTextStream(challenge, usage) };
        },
      );
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
        usage,
        cost_usd: route === 'fixture' ? 0 : null,
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

export async function runFixtureTurn(archive) {
  requireAdmittedRun();
  await verifyArchive(archive);
  return turn(archive, 'fixture', ({ prompt, challenge }) => {
    const id = 'resp_fixture';
    const events = [
      { type: 'response.created', response: { id, model, status: 'in_progress' } },
      { type: 'response.metadata', response_id: id, headers: { 'openai-model': model } },
      { type: 'response.completed', response: { id, ...fixtureResponse(challenge) } },
    ];
    const wire = events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
    return parseResponse(wire, challenge, Buffer.byteLength(prompt));
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw Error('usage: text-turn.mjs <pinned Codex Linux ARM64 archive>');
  console.log(JSON.stringify(await runFixtureTurn(resolve(process.argv[2]))));
}
