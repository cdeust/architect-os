import '@architect-os/sandbox/require-run';
const { runGateWithLease } = await import('./infrastructure/tree-lease.js');
process.exitCode = runGateWithLease('hosted', process.argv.slice(2));
