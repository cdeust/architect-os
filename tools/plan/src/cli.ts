import '@architect-os/sandbox/require-run';
const { runPlanCommand } = await import('./draft.js');
process.exitCode = await runPlanCommand(process);
