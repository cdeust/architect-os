// `npm run evidence -- ask|verify ...` (docs/design/evidence-desk.md §7). Entry point only: the command is `main.ts`.
import { evidenceDependencies, runEvidence } from './main.js';

process.exitCode = await runEvidence(evidenceDependencies(process));
