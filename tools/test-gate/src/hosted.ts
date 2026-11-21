import { runHostedGate } from './infrastructure/hosted-gate.js';

process.exitCode = await runHostedGate(process.argv.slice(2), process.cwd(), process.stdout);
