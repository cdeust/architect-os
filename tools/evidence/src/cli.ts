// `npm run evidence -- ask|verify ...` (docs/design/evidence-desk.md §7). Entry point only: the command is `main.ts`.
import '@architect-os/sandbox/require-run';
const { evidenceDependencies, runEvidence } = await import('./main.js');

process.exitCode = await runEvidence(evidenceDependencies(process));
