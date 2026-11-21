import { runPlan } from './main.js';
import { runDraft } from './draft.js';

process.exitCode = process.argv[2] === 'draft' ? await runDraft(process) : runPlan(process);
