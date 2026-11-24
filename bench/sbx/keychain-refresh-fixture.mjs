// Two independently admitted host consumers share the test installation. No external IO.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { accountHost } from '../../packages/sandbox/src/sbx-step.ts';
import { keychainEntry, storedAccount } from '../../packages/sandbox/src/sbx-keychain.ts';
const [dir] = process.argv.slice(2);
const host = accountHost(dir);
const client = storedAccount(host, 'gpt-6.2-astra', dir, keychainEntry, async (url, options) => {
  if (url === 'https://auth.openai.com/api/accounts/oauth/token') {
    if (options.body.get('grant_type') !== 'refresh_token') throw Error('unexpected authorization');
    writeFileSync(join(dir, 'refresh-observed'), '', { flag: 'wx', mode: 0o600 });
    await setTimeout(250);
    return Response.json({
      token_type: 'bearer',
      access_token: 'fixture-renewed',
      refresh_token: 'fixture-replacement',
      expires_in: 3600,
    });
  }
  if (url !== 'https://api.openai.com/v1/models') throw Error('unexpected destination');
  return Response.json({ models: [{ slug: 'gpt-6.2-astra', visibility: 'list' }] });
});
try {
  if ((await client.access(AbortSignal.timeout(10000))) !== 'fixture-renewed')
    throw Error('credential mismatch');
} finally {
  client.close();
}
