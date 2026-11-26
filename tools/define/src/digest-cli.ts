import '@architect-os/sandbox/require-run';
const { runDigest } = await import('./digest.js');
process.exitCode = runDigest(process);
