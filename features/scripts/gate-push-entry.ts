import '../../scripts/require-run.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePushEntry } from '../support/gate-push-entry.js';

// `npm run workflow:gate-push`: writes .github/workflows/gate-push.yml whole, from .github/workflows/gate.yml, when it
// differs (features/descriptive/gate-concurrency.feature requires the committed file to equal it).

writePushEntry(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
