// `npm run deliver -- <name> [--until ci]` (docs/design/orchestration-fable-5-2.md §14). Entry point only: the command is `main.ts`.
import { deliverDependencies, runDeliver } from './main.js';

process.exitCode = await runDeliver(deliverDependencies(process));
