/** Explicit installation command. Step never imports this entry point. */
import '@architect-os/sandbox/require-run';
import { accountHost } from './sbx-step.js';
import { storedAccount } from './sbx-keychain.js';
import { privateStateDirectory } from './state-journal.js';
import { codexModelSchema } from './step-file.js';

try {
  const model = codexModelSchema.parse(process.argv[2]);
  if (process.argv.length !== 3) throw Error();
  const dir = privateStateDirectory(process.env.ARCHITECT_OS_RUNTIME_ROOT!, ['sbx']);
  const account = storedAccount(
    accountHost(dir, (url) => process.stderr.write('Continue with ChatGPT: ' + url + '\n')),
    model,
    dir,
  );
  try {
    await account.signIn(new AbortController().signal);
  } finally {
    account.close();
  }
  process.stdout.write('SBX account ready.\n');
} catch {
  process.stderr.write('SBX sign-in failed.\n');
  process.exitCode = 1;
}
