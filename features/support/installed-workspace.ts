import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Git history and the compiled child-process programs belong to the installed checkout.
// Stryker copies sources into a separate directory and links the installed workspace dependencies.
const sandbox = createRequire(import.meta.url).resolve('@architect-os/sandbox/require-run');
export const installedWorkspace = realpathSync(join(dirname(sandbox), '../..'));
