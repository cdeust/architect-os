import '../../scripts/require-run.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeProfilesImage } from '../support/isolation-rows.js';

// `npm run diagram:isolation`, after a build (it imports the built @architect-os/sandbox): writes
// docs/diagrams/isolation-profiles.svg whole, from the five files of packages/sandbox/profiles, when it differs
// (features/arch/isolation-diagram.feature runs writeProfilesImage on a copy of them).

writeProfilesImage(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
