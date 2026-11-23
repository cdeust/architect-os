import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { isDeepStrictEqual, types } from 'node:util';
import { requireAdmittedRun } from '../../packages/sandbox/src/runtime-context.ts';
import { clientSha256, clientVersion, codexGuest, installCodex, verifyArchive } from './codex-client.mjs';
import { parseUniqueJson } from './json-frame.mjs';
import { withOfflineSbx } from './runtime.mjs';
import { model } from './text-response.mjs';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Only the account broker can observe an authenticated catalogue. Its response is never
// serialized into the VM. Reject getters, hidden fields and substituted model identities.
export function requireAccountCatalog(grant) {
  if (
    !grant ||
    typeof grant !== 'object' ||
    types.isProxy(grant) ||
    Object.getPrototypeOf(grant) !== Object.prototype
  )
    throw Error('SBX_ACCOUNT_CATALOG_REQUIRED');
  const fields = Object.getOwnPropertyDescriptors(grant);
  if (
    Reflect.ownKeys(fields).length !== 3 ||
    fields.status?.value !== 200 ||
    fields.outcome?.value !== 'visible' ||
    fields.model?.value !== model ||
    ![fields.status, fields.outcome, fields.model].every((field) => field.enumerable)
  )
    throw Error('SBX_ACCOUNT_CATALOG_REQUIRED');
}

// The Linux process hashes these exact bytes with sha256sum. Independently reconstruct them on the host.
export function verifyAccountExecResult(result, challenge) {
  const digest = sha256('architect-os account execution\n' + challenge + '\n');
  const expected = {
    client_version: clientVersion,
    client_sha256: clientSha256,
    client_exit: 0,
    command_exit: 0,
    stdout: digest + '  challenge\n',
    stderr: '',
  };
  try {
    if (
      result.code === 0 &&
      result.stderr === '' &&
      isDeepStrictEqual(parseUniqueJson(result.stdout), expected)
    )
      return digest;
  } catch {
    // Native diagnostics and arbitrary stdout never reach the account receipt.
  }
  throw Error('SBX_ACCOUNT_EXEC_RECEIPT_MISMATCH');
}

// validateAccount owns the fixed catalogue endpoint and selected SIWC session. command/exec runs a
// local command under the pinned client's sandbox without starting a turn, thread or model request.
// https://learn.chatgpt.com/docs/app-server#command-execution
// https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecParams.ts
export async function runAccountExec(archive, validateAccount) {
  requireAdmittedRun();
  if (typeof validateAccount !== 'function') throw Error('SBX_ACCOUNT_CATALOG_REQUIRED');
  await verifyArchive(archive);
  return withOfflineSbx(
    {
      limitMs: 180_000,
      async verify(workspace, receipt) {
        if ((await readdir(workspace)).length !== 0) throw Error('SBX_ACCOUNT_EXEC_WORKSPACE_CHANGED');
        return { ...receipt, workspace_empty_after_shutdown: true };
      },
    },
    async (sandbox) => {
      try {
        requireAccountCatalog(await validateAccount(sandbox.signal));
      } catch {
        sandbox.signal.throwIfAborted();
        throw Error('SBX_ACCOUNT_CATALOG_REQUIRED');
      }
      sandbox.signal.throwIfAborted();
      await installCodex(sandbox, archive);
      const challenge = randomUUID();
      const result = await sandbox.exec(codexGuest('account-exec'), {
        input: JSON.stringify({ challenge }) + '\n',
      });
      const digest = verifyAccountExecResult(result, challenge);
      return {
        kind: 'account_catalog_native_exec',
        model,
        catalog_visible: true,
        client_version: clientVersion,
        client_sha256: clientSha256,
        command_exit: 0,
        challenge_sha256: sha256(challenge),
        result_sha256: digest,
        provider_requests: 0,
      };
    },
  );
}
