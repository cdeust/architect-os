import '@architect-os/sandbox/require-run';
const { runProposal } = await import('./proposal.js');
process.exitCode = await runProposal(process);
